import { ArrowUp, GitBranch, PanelRight, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { AttachmentItem } from '@/components/AttachmentItem'
import { AttachmentMenu } from '@/components/AttachmentMenu'
import { ModelSelector } from '@/components/ModelSelector'
import { MessageBlockItem } from '@/components/MessageBlockItem'
import { SourceContextBanner } from '@/components/SourceContextBanner'
import { WebSearchToggle } from '@/components/WebSearchToggle'
import { useChatStore } from '@/store/chatStore'

interface Props {
  panelOpen: boolean
  onTogglePanel: () => void
  onCreateBranch: () => void
}

// 중앙 채팅 영역 — 메시지 블록 목록과 입력창
export function ChatArea({ panelOpen, onTogglePanel, onCreateBranch }: Props) {
  const chatTitle = useChatStore((s) => s.chatTitle)
  const chatId = useChatStore((s) => s.chatId)
  const isOpeningDefaultChat = useChatStore((s) => s.isOpeningDefaultChat)
  const blocks = useChatStore((s) => s.blocks)
  const refineJob = useChatStore((s) => s.refineJob)
  const selectedCount = useChatStore((s) => s.selectedBlockIds.length)
  const isSending = useChatStore((s) => s.isSending)
  const branchId = useChatStore((s) => s.branchId)
  const addFiles = useChatStore((s) => s.addFiles)

  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [blocks.length, isSending])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [branchId])

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
        <span className="truncate text-[13.5px] font-semibold">
          {chatId ? chatTitle : 'FlowKit'}
        </span>
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

      <div ref={scrollRef} className="flex-1 overflow-y-auto pb-4">
        {!chatId && (
          <EmptyState isOpening={isOpeningDefaultChat} />
        )}
        {blocks.map((b) => (
          <MessageBlockItem
            key={b.blockId}
            block={b}
            refine={refineByBlock.get(b.blockId)}
          />
        ))}
        {isSending && (
          <p className="py-3 pl-11 text-[12.5px] text-txt-3">답변을 쓰는 중…</p>
        )}
        <div ref={bottomRef} />
      </div>

      <Composer />
    </main>
  )
}

function EmptyState({ isOpening }: { isOpening: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <p className="text-[15px] font-semibold text-txt-1">
        {isOpening ? '대화를 여는 중…' : '새 채팅을 시작해보세요'}
      </p>
      <p className="text-[12.5px] text-txt-3">
        {isOpening
          ? '잠시만 기다려 주세요'
          : '왼쪽 위 버튼으로 새 대화를 만들 수 있습니다'}
      </p>
    </div>
  )
}

// 입력창 — 적용 중인 Context 표시와 질문 전송
function Composer() {
  const text = useChatStore((s) => s.draftText)
  const setText = useChatStore((s) => s.setDraftText)
  const chatId = useChatStore((s) => s.chatId)
  const isSending = useChatStore((s) => s.isSending)
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
  const webSearchEnabled = useChatStore((s) => s.webSearchEnabled)
  const setWebSearchEnabled = useChatStore((s) => s.setWebSearchEnabled)
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
  const disabled = !chatId || isSending || !text.trim() || uploading

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
          placeholder={chatId ? '무엇이든 물어보세요' : '새 채팅을 먼저 만들어주세요'}
          disabled={!chatId}
          className="max-h-40 w-full resize-none bg-transparent text-[13.5px] text-txt-0 outline-none placeholder:text-txt-3"
        />
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <AttachmentMenu disabled={!chatId || isSending || selectedModel?.supportsAttachment === false} onSelect={(files) => void addFiles(files)} />
            <WebSearchToggle enabled={webSearchEnabled} disabled={!selectedModel?.supportsWebSearch} reason={selectedModel?.supportsWebSearch ? undefined : '선택한 모델은 웹 검색을 지원하지 않습니다.'} onChange={setWebSearchEnabled} />
            <ModelSelector models={models} selectedId={selectedModelId} loading={isModelListLoading} onChange={setSelectedModel} />
          </div>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={disabled}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-txt-0 text-bg-0 transition disabled:opacity-30"
          >
            <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  )
}
