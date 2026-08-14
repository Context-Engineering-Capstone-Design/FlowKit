import { ArrowUp, PanelRight, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { MessageBlockItem } from '@/components/MessageBlockItem'
import { useChatStore } from '@/store/chatStore'

interface Props {
  panelOpen: boolean
  onTogglePanel: () => void
}

// 중앙 채팅 영역 — 메시지 블록 목록과 입력창
export function ChatArea({ panelOpen, onTogglePanel }: Props) {
  const chatTitle = useChatStore((s) => s.chatTitle)
  const chatId = useChatStore((s) => s.chatId)
  const blocks = useChatStore((s) => s.blocks)
  const refineJob = useChatStore((s) => s.refineJob)
  const selectedCount = useChatStore((s) => s.selectedBlockIds.length)
  const isSending = useChatStore((s) => s.isSending)

  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [blocks.length, isSending])

  const refineByBlock = new Map(
    (refineJob?.results ?? []).map((r) => [r.blockId, r]),
  )

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-bg-0">
      <header className="flex items-center justify-between px-5 py-3.5">
        <span className="truncate text-[13.5px] font-semibold">
          {chatId ? chatTitle : 'FlowKit'}
        </span>
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
      </header>

      <ErrorBanner />

      <div className="flex-1 overflow-y-auto pb-4">
        {!chatId && <EmptyState />}
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

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <p className="text-[15px] font-semibold text-txt-1">
        새 채팅을 시작해보세요
      </p>
      <p className="text-[12.5px] text-txt-3">
        왼쪽 위 버튼으로 새 대화를 만들 수 있습니다
      </p>
    </div>
  )
}

// 오류 배너 (REQ-064)
function ErrorBanner() {
  const error = useChatStore((s) => s.error)
  const dismiss = useChatStore((s) => s.dismissError)

  if (!error) return null

  return (
    <div className="mx-5 mb-2 flex items-center gap-2 rounded-lg border border-red/40 bg-red/10 px-3 py-2">
      <span className="flex-1 text-[12.5px] text-red">{error}</span>
      <button type="button" onClick={dismiss} className="text-red">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

// 입력창 — 적용 중인 Context 표시와 질문 전송
function Composer() {
  const [text, setText] = useState('')
  const chatId = useChatStore((s) => s.chatId)
  const isSending = useChatStore((s) => s.isSending)
  const appliedCount = useChatStore((s) => s.appliedBlockIds.length)
  const clearApplied = useChatStore((s) => s.clearAppliedContext)
  const sendMessage = useChatStore((s) => s.sendMessage)

  const disabled = !chatId || isSending || !text.trim()

  async function submit() {
    if (disabled) return
    const prompt = text
    setText('')
    await sendMessage(prompt)
  }

  return (
    <div className="px-5 pb-5">
      {appliedCount > 0 && (
        <div className="mb-2 flex w-fit items-center gap-1.5 rounded-full bg-blue-dim px-3 py-1 text-[11.5px] text-blue">
          Context 적용 중 · {appliedCount}개 블록
          <button type="button" onClick={clearApplied} title="적용 해제">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      <div className="rounded-2xl bg-bg-2 p-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void submit()
            }
          }}
          rows={1}
          placeholder={chatId ? '무엇이든 물어보세요' : '새 채팅을 먼저 만들어주세요'}
          disabled={!chatId}
          className="max-h-40 w-full resize-none bg-transparent text-[13.5px] text-txt-0 outline-none placeholder:text-txt-3"
        />
        <div className="mt-2 flex justify-end">
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
