import { ArrowDown, ArrowUp, GitBranch, PanelLeft, PanelRight, Square, SquarePen, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { AttachmentItem } from '@/components/AttachmentItem'
import { AttachmentMenu } from '@/components/AttachmentMenu'
import { ModelSelector } from '@/components/ModelSelector'
import { MessageBlockItem } from '@/components/MessageBlockItem'
import { SourceContextBanner } from '@/components/SourceContextBanner'
import { WebSearchToggle } from '@/components/WebSearchToggle'
import { ReasoningEffortSelector } from '@/components/ReasoningEffortSelector'
import { useChatStore } from '@/store/chatStore'

interface Props {
  sidebarOpen: boolean
  onToggleSidebar: () => void
  panelOpen: boolean
  onTogglePanel: () => void
  onCreateBranch: () => void
}

// 중앙 채팅 영역 — 메시지 블록 목록과 입력창
export function ChatArea({ sidebarOpen, onToggleSidebar, panelOpen, onTogglePanel, onCreateBranch }: Props) {
  const chatTitle = useChatStore((s) => s.chatTitle)
  const chatId = useChatStore((s) => s.chatId)
  const blocks = useChatStore((s) => s.blocks)
  const refineJob = useChatStore((s) => s.refineJob)
  const selectedCount = useChatStore((s) => s.selectedBlockIds.length)
  const isSending = useChatStore((s) => s.isSending)
  const branchId = useChatStore((s) => s.branchId)
  const addFiles = useChatStore((s) => s.addFiles)
  const newChat = useChatStore((s) => s.newChat)
  const renameChat = useChatStore((s) => s.renameChat)

  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const titleInputRef = useRef<HTMLInputElement>(null)
  const ignoreTitleBlur = useRef(false)

  // 마지막 블록 내용(스트리밍 중이면 계속 늘어난다)이 바뀔 때마다 따라 내려간다.
  const lastBlockContent = blocks.length ? blocks[blocks.length - 1].content : ''
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // 사용자가 위로 스크롤하면 자동으로 따라 내려가지 않는다 (문서 C7).
  const [autoFollow, setAutoFollow] = useState(true)
  const NEAR_BOTTOM_PX = 80

  useEffect(() => {
    if (autoFollow) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [blocks.length, isSending, lastBlockContent, autoFollow])

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
      <header className="flex items-center justify-between px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-1">
          <div
            className={`grid transition-[grid-template-columns,opacity] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none ${
              sidebarOpen ? 'grid-cols-[0fr] opacity-0' : 'grid-cols-[1fr] opacity-100'
            }`}
            aria-hidden={sidebarOpen}
          >
            <div className="flex min-w-0 items-center gap-1 overflow-hidden">
              <button
                type="button"
                onClick={onToggleSidebar}
                title="사이드바 열기"
                aria-label="사이드바 열기"
                aria-expanded={sidebarOpen}
                aria-controls="sidebar"
                tabIndex={sidebarOpen ? -1 : 0}
                className="rounded-md p-1.5 text-txt-2 transition hover:bg-bg-3 hover:text-txt-0"
              >
                <PanelLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => void newChat()}
                title="새 채팅"
                tabIndex={sidebarOpen ? -1 : 0}
                className="rounded-md p-1.5 text-txt-2 transition hover:bg-bg-3 hover:text-txt-0"
              >
                <SquarePen className="h-4 w-4" />
              </button>
            </div>
          </div>
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
        {chatId && (
          <button
            type="button"
            onClick={onCreateBranch}
            className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-[12px] text-txt-2 transition hover:text-txt-0"
          >
            <GitBranch className="h-3.5 w-3.5" />
            브랜치 생성
          </button>
        )}
        <button
          type="button"
          onClick={onTogglePanel}
          className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] transition ${
            panelOpen
              ? 'border-blue-line bg-blue-dim text-blue'
              : 'border-line text-txt-2 hover:text-txt-0'
          }`}
        >
          <PanelRight className="h-3.5 w-3.5" />
          Context 패널
          {selectedCount > 0 && (
            <span className="rounded bg-blue px-1.5 text-[10px] font-bold text-white">
              {selectedCount}
            </span>
          )}
        </button>
        </div>
      </header>

      <SourceContextBanner />

      <div ref={scrollRef} onScroll={handleScroll} className="relative flex-1 overflow-y-auto pb-4">
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
  const focusSignal = useChatStore((s) => s.focusSignal)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [focusSignal])

  useEffect(() => { void loadInputAssist() }, [loadInputAssist])

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
          <div className="flex items-center gap-1">
            <AttachmentMenu disabled={!chatId || isSending || selectedModel?.supportsAttachment === false} onSelect={(files) => void addFiles(files)} />
            <WebSearchToggle mode={webSearchMode} disabled={!selectedModel?.supportsWebSearch} reason={selectedModel?.supportsWebSearch ? undefined : '선택한 모델은 웹 검색을 지원하지 않습니다.'} onChange={setWebSearchMode} />
            <ReasoningEffortSelector value={reasoningEffort} onChange={setReasoningEffort} />
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
