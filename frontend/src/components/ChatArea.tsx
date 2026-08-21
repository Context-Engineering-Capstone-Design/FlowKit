import { ArrowDown, ArrowUp, BookOpen, PanelLeft, PanelRight, Square, Upload, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AttachmentItem } from '@/components/AttachmentItem'
import { AttachmentMenu } from '@/components/AttachmentMenu'
import { ComposerEditor, type ComposerEditorHandle } from '@/components/ComposerEditor'
import { ModelSelector } from '@/components/ModelSelector'
import { MessageBlockItem } from '@/components/MessageBlockItem'
import { ConversationOutline } from '@/components/ConversationOutline'
import { SourceContextBanner } from '@/components/SourceContextBanner'
import { WebSearchToggle } from '@/components/WebSearchToggle'
import { ReasoningEffortSelector } from '@/components/ReasoningEffortSelector'
import { useChatPaneStore } from '@/components/ChatPaneContext'
import { buildConversationOutline } from '@/lib/conversationOutline'
import * as projectApi from '@/api/project'
import type { ProjectLibraryResource } from '@/types/api'

interface Props {
  onOpenContextEditor?: () => void
  contextEditorButtonId?: string
  sidebarOpen: boolean
  onOpenSidebar: () => void
  /** 이전 호출부 호환용. Context 편집 탭 구조에서는 쓰지 않는다. */
  panelOpen?: boolean
  onTogglePanel?: () => void
}

// 중앙 채팅 영역 — 메시지 블록 목록과 입력창
export function ChatArea({ onOpenContextEditor = () => {}, contextEditorButtonId, sidebarOpen, onOpenSidebar }: Props) {
  const chatTitle = useChatPaneStore((s) => s.chatTitle)
  const chatId = useChatPaneStore((s) => s.chatId)
  const blocks = useChatPaneStore((s) => s.blocks)
  const refineJob = useChatPaneStore((s) => s.refineJob)
  const selectedCount = useChatPaneStore((s) => s.selectedBlockIds.length)
  const isSending = useChatPaneStore((s) => s.isSending)
  const branchId = useChatPaneStore((s) => s.branchId)
  const addFiles = useChatPaneStore((s) => s.addFiles)
  const renameChat = useChatPaneStore((s) => s.renameChat)

  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const titleInputRef = useRef<HTMLInputElement>(null)
  const ignoreTitleBlur = useRef(false)

  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const outlineTurns = useMemo(() => buildConversationOutline(blocks), [blocks])
  // 사용자가 위로 스크롤하면 자동으로 따라 내려가지 않는다 (문서 C7).
  const [autoFollow, setAutoFollow] = useState(true)
  const NEAR_BOTTOM_PX = 80

  // 새 메시지가 추가될 때만 맨 아래로 내린다. AI 답변이 스트리밍으로 길어지는
  // 동안(블록 내용만 계속 늘어날 때)에는 다시 내리지 않는다 — 답변이 길어질수록
  // 매 글자 조각마다 화면을 끌어내려 사용자가 위쪽을 읽지 못하게 되는 문제였다.
  useEffect(() => {
    if (autoFollow) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks.length, isSending, autoFollow])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
    setAutoFollow(true)
  }, [branchId])

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    setAutoFollow(distanceFromBottom <= NEAR_BOTTOM_PX)
  }

  function scrollToBottom() {
    setAutoFollow(true)
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    setEditingTitle(false)
  }, [chatId])

  useEffect(() => {
    if (editingTitle) titleInputRef.current?.select()
  }, [editingTitle])

  function startTitleEdit() {
    if (!chatId) return
    ignoreTitleBlur.current = false
    setTitleDraft(chatTitle)
    setEditingTitle(true)
  }

  async function commitTitleEdit() {
    if (!chatId) return
    if (ignoreTitleBlur.current) {
      ignoreTitleBlur.current = false
      return
    }
    const value = titleDraft
    setEditingTitle(false)
    await renameChat(chatId, value)
  }

  function cancelTitleEdit() {
    ignoreTitleBlur.current = true
    setEditingTitle(false)
  }

  const refineByBlock = new Map(
    (refineJob?.results ?? []).map((r) => [r.blockId, r]),
  )

  // 채팅 영역 어디에 놓아도 첨부되도록 드래그 진입 횟수를 센다 .
  const [isDragging, setIsDragging] = useState(false)
  const dragDepth = useRef(0)

  function hasFiles(e: React.DragEvent) {
    return Array.from(e.dataTransfer.types).includes('Files')
  }

  return (
    <main
      className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-bg-0"
      onDragEnter={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        dragDepth.current += 1
        setIsDragging(true)
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setIsDragging(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        dragDepth.current = 0
        setIsDragging(false)
        const files = Array.from(e.dataTransfer.files)
        if (files.length) void addFiles(files)
      }}
    >
      {isDragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 border-2 border-dashed border-blue bg-blue-dim/80">
          <Upload className="h-6 w-6 text-blue" />
          <p className="text-[13px] font-medium text-blue">여기에 파일을 놓으세요</p>
        </div>
      )}
      <header className="flex items-center justify-between px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-1">
          {/* 사이드바가 닫혀 있으면 항상 눌러서 열 수 있는 버튼을 둔다.
              좁은 화면에는 호버로 여는 방법이 없어 이 버튼이 유일한 진입로다 (0821_01 B1). */}
          {!sidebarOpen && (
            <button
              type="button"
              onClick={onOpenSidebar}
              title="사이드바 열기"
              aria-label="사이드바 열기"
              className="mr-1 shrink-0 rounded-md p-1.5 text-txt-2 transition hover:bg-bg-3 hover:text-txt-0"
            >
              <PanelLeft className="h-4 w-4" />
            </button>
          )}
          {chatId && editingTitle ? (
            <input
              ref={titleInputRef}
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => void commitTitleEdit()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); void commitTitleEdit() }
                if (e.key === 'Escape') { e.preventDefault(); cancelTitleEdit() }
              }}
              aria-label="대화 이름 변경"
              className="min-w-0 max-w-[240px] rounded-md bg-bg-1 px-2 py-0.5 text-[13.5px] font-semibold text-txt-0 outline-none ring-1 ring-blue-line"
            />
          ) : chatId ? (
            <button
              type="button"
              onClick={startTitleEdit}
              title="이름 변경"
              className="truncate rounded-md px-1.5 py-0.5 text-left text-[13.5px] font-semibold transition hover:bg-bg-2"
            >
              {chatTitle}
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
        <button
          id={contextEditorButtonId}
          type="button"
          onClick={onOpenContextEditor}
          title="Context 편집"
          aria-label="Context 편집"
          className="relative rounded-md p-1.5 text-txt-2 transition hover:bg-bg-3 hover:text-txt-0"
        >
          <PanelRight className="h-4 w-4" />
          {selectedCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 min-w-3.5 rounded-full bg-blue px-1 text-center text-[9px] font-bold leading-[14px] text-white">
              {selectedCount}
            </span>
          )}
        </button>
        </div>
      </header>

      <SourceContextBanner />

      <div className="relative flex-1 overflow-hidden">
        <div ref={scrollRef} onScroll={handleScroll} className="h-full overflow-y-auto pb-4">
          <div ref={contentRef}>
            {!chatId && <EmptyState />}
            {blocks.map((b) => (
              <MessageBlockItem
                key={b.blockId}
                block={b}
                refine={refineByBlock.get(b.blockId)}
              />
            ))}
            <div ref={bottomRef} />
          </div>
        </div>
        <ConversationOutline containerRef={scrollRef} contentRef={contentRef} turns={outlineTurns} />
      </div>

      {!autoFollow && (
        <button
          type="button"
          onClick={scrollToBottom}
          title="맨 아래로"
          aria-label="맨 아래로"
          className="absolute bottom-24 left-1/2 z-10 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-line bg-bg-2 text-txt-1 shadow-lg transition hover:bg-bg-3"
        >
          <ArrowDown className="h-4 w-4" />
        </button>
      )}

      <Composer />
    </main>
  )
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <p className="text-[15px] font-semibold text-txt-1">새 채팅을 시작해보세요</p>
      <p className="text-[12.5px] text-txt-3">아래 입력창에 메시지를 보내면 새 대화가 시작됩니다</p>
    </div>
  )
}

// 입력창 — 적용 중인 Context 표시와 질문 전송
function Composer() {
  const text = useChatPaneStore((s) => s.draftText)
  const setText = useChatPaneStore((s) => s.setDraftText)
  const projectId = useChatPaneStore((s) => s.projectId)
  const isSending = useChatPaneStore((s) => s.isSending)
  // 생성 중인 답변이 있으면 전송 버튼 자리를 중단 버튼으로 바꾼다 (문서 C5).
  const generatingBlockId = useChatPaneStore(
    (s) => s.blocks.find((b) => b.generationStatus === 'generating')?.blockId ?? null,
  )
  const cancelGeneration = useChatPaneStore((s) => s.cancelGeneration)
  const appliedCount = useChatPaneStore((s) => s.appliedBlockIds.length)
  const appliedContextLabel = useChatPaneStore((s) => s.appliedContextLabel)
  const clearApplied = useChatPaneStore((s) => s.clearAppliedContext)
  const sendMessage = useChatPaneStore((s) => s.sendMessage)
  const attachments = useChatPaneStore((s) => s.draftAttachments ?? [])
  const addFiles = useChatPaneStore((s) => s.addFiles)
  const removeAttachment = useChatPaneStore((s) => s.removeAttachment)
  const retryAttachment = useChatPaneStore((s) => s.retryAttachment)
  const models = useChatPaneStore((s) => s.models)
  const selectedModelId = useChatPaneStore((s) => s.selectedModelId)
  const setSelectedModel = useChatPaneStore((s) => s.setSelectedModel)
  const webSearchMode = useChatPaneStore((s) => s.webSearchMode)
  const setWebSearchMode = useChatPaneStore((s) => s.setWebSearchMode)
  const reasoningEffort = useChatPaneStore((s) => s.reasoningEffort)
  const setReasoningEffort = useChatPaneStore((s) => s.setReasoningEffort)
  const isModelListLoading = useChatPaneStore((s) => s.isModelListLoading)
  const loadInputAssist = useChatPaneStore((s) => s.loadInputAssist)
  const selectedLibraryResourceIds = useChatPaneStore((s) => s.selectedLibraryResourceIds)
  const setSelectedLibraryResourceIds = useChatPaneStore((s) => s.setSelectedLibraryResourceIds)
  const focusSignal = useChatPaneStore((s) => s.focusSignal)
  const tags = useChatPaneStore((s) => s.contextRangeTags)
  const removeContextRangeTag = useChatPaneStore((s) => s.removeContextRangeTag)
  const editorRef = useRef<ComposerEditorHandle>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [libraryResources, setLibraryResources] = useState<ProjectLibraryResource[]>([])

  useEffect(() => { void loadInputAssist() }, [loadInputAssist])
  useEffect(() => {
    if (!projectId) { setLibraryResources([]); setSelectedLibraryResourceIds([]); return }
    void projectApi.fetchProject(projectId).then((project) => setLibraryResources(project.libraryResources)).catch(() => setLibraryResources([]))
  }, [projectId, setSelectedLibraryResourceIds])

  const selectedModel = models.find((model) => model.modelId === selectedModelId)
  const uploading = attachments.some((item) => item.status === 'uploading')
  const disabled = isSending || !text.trim() || uploading || generatingBlockId !== null

  async function submit() {
    if (disabled) return
    const prompt = editorRef.current?.getText() ?? text
    editorRef.current?.resetHeight()
    await sendMessage(prompt)
  }

  return (
    <div className="px-5 pb-5">
      {appliedCount > 0 && (
        <div className="mb-2 flex w-fit items-center gap-1.5 rounded-full bg-blue-dim px-3 py-1 text-[11.5px] text-blue">
          {appliedContextLabel} · {appliedCount}개 블록
          <button type="button" onClick={clearApplied} title="적용 해제">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      <div className="rounded-2xl bg-bg-2 p-3">
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachments.map((attachment) => <AttachmentItem key={attachment.localId} attachment={attachment} onRemove={() => void removeAttachment(attachment.localId)} onRetry={() => void retryAttachment(attachment.localId)} />)}
          </div>
        )}
        <ComposerEditor
          ref={editorRef}
          text={text}
          tags={tags}
          focusSignal={focusSignal}
          onChangeText={setText}
          onRemoveTag={removeContextRangeTag}
          onSubmit={() => void submit()}
          onPasteFiles={(files) => void addFiles(files)}
        />
        <div className="mt-2 flex items-center justify-between">
          <div className="flex flex-wrap items-center gap-1">
            <AttachmentMenu disabled={isSending || selectedModel?.supportsAttachment === false} onSelect={(files) => void addFiles(files)} />
            <WebSearchToggle mode={webSearchMode} disabled={!selectedModel?.supportsWebSearch} reason={selectedModel?.supportsWebSearch ? undefined : '선택한 모델은 웹 검색을 지원하지 않습니다.'} onChange={setWebSearchMode} />
            <ReasoningEffortSelector value={reasoningEffort} onChange={setReasoningEffort} />
            {projectId && libraryResources.length > 0 && <div className="relative"><button type="button" onClick={() => setLibraryOpen((open) => !open)} title="Project 자료 선택" className={`rounded p-1.5 ${selectedLibraryResourceIds.length ? 'bg-blue-dim text-blue' : 'text-txt-2 hover:bg-bg-3'}`}><BookOpen className="h-3.5 w-3.5" /></button>{libraryOpen && <ProjectLibraryMenu resources={libraryResources} selectedIds={selectedLibraryResourceIds} onChange={setSelectedLibraryResourceIds} />}</div>}
            <ModelSelector models={models} selectedId={selectedModelId} loading={isModelListLoading} onChange={setSelectedModel} />
          </div>
          {generatingBlockId ? (
            <button
              type="button"
              onClick={() => void cancelGeneration(generatingBlockId)}
              title="생성 중단"
              aria-label="생성 중단"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-txt-0 text-bg-0 transition"
            >
              <Square className="h-3.5 w-3.5" fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void submit()}
              disabled={disabled}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-txt-0 text-bg-0 transition disabled:opacity-30"
            >
              <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function ProjectLibraryMenu({ resources, selectedIds, onChange }: { resources: ProjectLibraryResource[]; selectedIds: string[]; onChange: (ids: string[]) => void }) {
  function toggle(resourceId: string) { onChange(selectedIds.includes(resourceId) ? selectedIds.filter((id) => id !== resourceId) : [...selectedIds, resourceId]) }
  return <div className="absolute bottom-9 left-0 z-30 w-56 rounded-lg border border-line bg-bg-1 p-2 shadow-xl"><p className="px-1 pb-1 text-[11px] text-txt-3">이번 질문에 참고할 자료</p>{resources.map((resource) => <label key={resource.resourceId} className="flex cursor-pointer items-start gap-2 rounded p-1.5 text-[12px] hover:bg-bg-2"><input type="checkbox" checked={selectedIds.includes(resource.resourceId)} onChange={() => toggle(resource.resourceId)} /><span className="min-w-0"><b className="block truncate font-medium">{resource.title}</b><span className="line-clamp-1 text-txt-3">{resource.content}</span></span></label>)}</div>
}
