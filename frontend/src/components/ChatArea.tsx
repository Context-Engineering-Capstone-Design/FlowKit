import { ArrowDown, ArrowUp, BookOpen, PanelLeft, PanelRight, Square, Upload, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AttachmentItem } from '@/components/AttachmentItem'
import { AttachmentMenu } from '@/components/AttachmentMenu'
import { ChatTabBar } from '@/components/ChatTabBar'
import { ModelSelector } from '@/components/ModelSelector'
import { MessageBlockItem } from '@/components/MessageBlockItem'
import { ConversationOutline } from '@/components/ConversationOutline'
import { SourceContextBanner } from '@/components/SourceContextBanner'
import { WebSearchToggle } from '@/components/WebSearchToggle'
import { ReasoningEffortSelector } from '@/components/ReasoningEffortSelector'
import { useChatStore, type ContextRangeTag } from '@/store/chatStore'
import { buildConversationOutline } from '@/lib/conversationOutline'
import { toTagPreview } from '@/lib/textRangeSelection'
import * as projectApi from '@/api/project'
import type { ProjectLibraryResource } from '@/types/api'

interface Props {
  panelOpen: boolean
  onTogglePanel: () => void
  sidebarOpen: boolean
  onOpenSidebar: () => void
}

// 중앙 채팅 영역 — 메시지 블록 목록과 입력창
export function ChatArea({ panelOpen, onTogglePanel, sidebarOpen, onOpenSidebar }: Props) {
  const chatTitle = useChatStore((s) => s.chatTitle)
  const chatId = useChatStore((s) => s.chatId)
  const blocks = useChatStore((s) => s.blocks)
  const refineJob = useChatStore((s) => s.refineJob)
  const selectedCount = useChatStore((s) => s.selectedBlockIds.length)
  const isSending = useChatStore((s) => s.isSending)
  const branchId = useChatStore((s) => s.branchId)
  const addFiles = useChatStore((s) => s.addFiles)
  const renameChat = useChatStore((s) => s.renameChat)

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

  // 채팅 영역 어디에 놓아도 첨부되도록 드래그 진입 횟수를 센다 (FE-INPUT-008).
  const [isDragging, setIsDragging] = useState(false)
  const dragDepth = useRef(0)

  function hasFiles(e: React.DragEvent) {
    return Array.from(e.dataTransfer.types).includes('Files')
  }

  return (
    <main
      className="relative flex min-w-0 flex-1 flex-col bg-bg-0"
      onDragEnter={(e) => {
        if (!chatId || !hasFiles(e)) return
        e.preventDefault()
        dragDepth.current += 1
        setIsDragging(true)
      }}
      onDragOver={(e) => {
        if (!chatId || !hasFiles(e)) return
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
        if (!chatId) return
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
      <ChatTabBar />
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
          type="button"
          onClick={onTogglePanel}
          title="Context 패널"
          aria-label="Context 패널"
          aria-expanded={panelOpen}
          aria-controls="context-panel"
          className={`relative rounded-md p-1.5 transition hover:bg-bg-3 ${
            panelOpen ? 'text-blue' : 'text-txt-2 hover:text-txt-0'
          }`}
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
  const text = useChatStore((s) => s.draftText)
  const setText = useChatStore((s) => s.setDraftText)
  const chatId = useChatStore((s) => s.chatId)
  const projectId = useChatStore((s) => s.projectId)
  const isSending = useChatStore((s) => s.isSending)
  // 생성 중인 답변이 있으면 전송 버튼 자리를 중단 버튼으로 바꾼다 (문서 C5).
  const generatingBlockId = useChatStore(
    (s) => s.blocks.find((b) => b.generationStatus === 'generating')?.blockId ?? null,
  )
  const cancelGeneration = useChatStore((s) => s.cancelGeneration)
  const appliedCount = useChatStore((s) => s.appliedBlockIds.length)
  const appliedContextLabel = useChatStore((s) => s.appliedContextLabel)
  const clearApplied = useChatStore((s) => s.clearAppliedContext)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const attachments = useChatStore((s) => s.draftAttachments)
  const addFiles = useChatStore((s) => s.addFiles)
  const removeAttachment = useChatStore((s) => s.removeAttachment)
  const retryAttachment = useChatStore((s) => s.retryAttachment)
  const models = useChatStore((s) => s.models)
  const selectedModelId = useChatStore((s) => s.selectedModelId)
  const setSelectedModel = useChatStore((s) => s.setSelectedModel)
  const webSearchMode = useChatStore((s) => s.webSearchMode)
  const setWebSearchMode = useChatStore((s) => s.setWebSearchMode)
  const reasoningEffort = useChatStore((s) => s.reasoningEffort)
  const setReasoningEffort = useChatStore((s) => s.setReasoningEffort)
  const isModelListLoading = useChatStore((s) => s.isModelListLoading)
  const loadInputAssist = useChatStore((s) => s.loadInputAssist)
  const selectedLibraryResourceIds = useChatStore((s) => s.selectedLibraryResourceIds)
  const setSelectedLibraryResourceIds = useChatStore((s) => s.setSelectedLibraryResourceIds)
  const focusSignal = useChatStore((s) => s.focusSignal)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [libraryResources, setLibraryResources] = useState<ProjectLibraryResource[]>([])

  useEffect(() => {
    textareaRef.current?.focus()
  }, [focusSignal])

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
    const prompt = text
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
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
        <ContextRangeTagList />
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachments.map((attachment) => <AttachmentItem key={attachment.localId} attachment={attachment} onRemove={() => void removeAttachment(attachment.localId)} onRetry={() => void retryAttachment(attachment.localId)} />)}
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            const ta = e.target
            ta.style.height = 'auto'
            ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void submit()
            }
          }}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.items)
              .filter((item) => item.kind === 'file')
              .map((item) => item.getAsFile())
              .filter((file): file is File => file !== null)
            if (files.length) {
              e.preventDefault()
              void addFiles(files)
            }
          }}
          rows={1}
          placeholder="무엇이든 물어보세요"
          className="max-h-40 w-full resize-none bg-transparent text-[13.5px] text-txt-0 outline-none placeholder:text-txt-3"
        />
        <div className="mt-2 flex items-center justify-between">
          <div className="flex flex-wrap items-center gap-1">
            <AttachmentMenu disabled={!chatId || isSending || selectedModel?.supportsAttachment === false} onSelect={(files) => void addFiles(files)} />
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

// 드래그로 고른 부분 범위 태그 목록 — 다음 전송의 Context로 쓰인다 (0820_13 B1~B3)
function ContextRangeTagList() {
  const tags = useChatStore((s) => s.contextRangeTags)
  const removeContextRangeTag = useChatStore((s) => s.removeContextRangeTag)
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  if (tags.length === 0) return null

  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag.id}
          onMouseEnter={() => setHoveredId(tag.id)}
          onMouseLeave={() => setHoveredId((id) => (id === tag.id ? null : id))}
          className="relative flex items-center gap-1 rounded-full bg-blue-dim px-2.5 py-1 text-[11px] text-blue"
        >
          “{toTagPreview(tag.selectedText)}”
          <button
            type="button"
            onClick={() => removeContextRangeTag(tag.id)}
            title="태그 제거"
            aria-label="선택 범위 태그 제거"
          >
            <X className="h-3 w-3" />
          </button>
          {hoveredId === tag.id && <ContextRangeTagPreview tag={tag} />}
        </span>
      ))}
    </div>
  )
}

// 태그에 호버하면 선택 당시 스냅샷 기준으로 고른 범위를 강조해 보여준다 (0820_13 B2)
function ContextRangeTagPreview({ tag }: { tag: ContextRangeTag }) {
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute bottom-full left-0 z-30 mb-2 max-h-52 w-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-bg-2 p-2.5 text-left text-[11.5px] leading-relaxed text-txt-2 shadow-lg"
    >
      <span>{tag.snapshotText.slice(0, tag.startOffset)}</span>
      <mark className="ctx-range-mark">{tag.snapshotText.slice(tag.startOffset, tag.endOffset)}</mark>
      <span>{tag.snapshotText.slice(tag.endOffset)}</span>
    </div>
  )
}
