import { Check, RotateCw, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { useChatStore } from '@/store/chatStore'
import type { MessageBlock, RefineResultItem } from '@/types/api'

interface Props {
  block: MessageBlock
  refine?: RefineResultItem
}

// 메시지 블록 하나 — 체크박스로 Context 선택, 정제 결과가 있으면 인라인으로 비교
export function MessageBlockItem({ block, refine }: Props) {
  const selected = useChatStore((s) => s.selectedBlockIds.includes(block.blockId))
  const applied = useChatStore((s) => s.appliedBlockIds.includes(block.blockId))
  const toggleBlock = useChatStore((s) => s.toggleBlock)
  const regenerate = useChatStore((s) => s.regenerate)
  const view = useChatStore((s) => s.inlineView[block.blockId] ?? 'refined')
  const highlighted = useChatStore(
    (s) => s.highlightedBlockId === block.blockId,
  )

  const isUser = block.role === 'user'
  const pending = refine?.status === 'pending'
  const shown = pending && view === 'refined' ? refine.refinedContent : block.content

  return (
    <div
      id={`block-${block.blockId}`}
      className={`group relative border-l-[3px] py-2.5 pl-11 pr-5 transition ${
        selected
          ? 'border-sel-line bg-sel-bg'
          : highlighted
            ? 'border-green bg-green-dim'
            : 'border-transparent hover:bg-white/[0.025]'
      }`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => toggleBlock(block.blockId)}
        aria-label="Context로 선택"
        className={`absolute left-4 top-3.5 h-3.5 w-3.5 cursor-pointer accent-blue transition ${
          selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
      />

      <div className="mb-1.5 flex items-center gap-2">
        <span
          className={`text-[11px] font-bold uppercase tracking-wide ${
            isUser ? 'text-blue' : 'text-green'
          }`}
        >
          {isUser ? 'User' : 'AI'}
        </span>
        {block.versionNo && block.versionNo > 1 && (
          <span className="rounded bg-bg-3 px-1.5 py-px text-[10px] text-txt-2">
            v{block.versionNo}
          </span>
        )}
        {applied && (
          <span className="rounded bg-blue-dim px-1.5 py-px text-[10px] text-blue">
            Context 적용 중
          </span>
        )}
      </div>

      <div className="markdown text-[13.5px] leading-relaxed text-txt-1">
        <ReactMarkdown>{shown}</ReactMarkdown>
      </div>

      {pending && <InlineRefineBar result={refine} />}

      {!isUser && !pending && (
        <div className="mt-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
          <button
            type="button"
            onClick={() => void regenerate(block.blockId)}
            title="답변 다시 시도"
            className="rounded p-1 text-txt-3 transition hover:bg-bg-3 hover:text-txt-1"
          >
            <RotateCw className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

// 정제 결과 검토 줄 — 원본/정제 전환과 승인·거절 (REQ-031, REQ-036)
function InlineRefineBar({ result }: { result: RefineResultItem }) {
  const view = useChatStore((s) => s.inlineView[result.blockId] ?? 'refined')
  const setInlineView = useChatStore((s) => s.setInlineView)
  const approve = useChatStore((s) => s.approveResult)
  const reject = useChatStore((s) => s.rejectResult)

  return (
    <div className="mt-2.5 flex items-center gap-2 rounded-lg bg-bg-2 px-2.5 py-1.5">
      <span className="text-[11px] font-semibold text-green">정제본</span>

      <div className="flex overflow-hidden rounded-md border border-line">
        {(['refined', 'original'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setInlineView(result.blockId, v)}
            className={`px-2 py-0.5 text-[11px] transition ${
              view === v ? 'bg-bg-4 text-txt-0' : 'text-txt-2 hover:text-txt-1'
            }`}
          >
            {v === 'refined' ? '정제' : '원본'}
          </button>
        ))}
      </div>

      <span className="flex-1" />

      <button
        type="button"
        onClick={() => void approve(result.resultId)}
        className="flex items-center gap-1 rounded-md bg-blue-dim px-2 py-1 text-[11px] font-semibold text-blue transition hover:bg-blue hover:text-white"
      >
        <Check className="h-3 w-3" /> 승인
      </button>
      <button
        type="button"
        onClick={() => void reject(result.resultId)}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-txt-2 transition hover:bg-bg-3 hover:text-txt-0"
      >
        <X className="h-3 w-3" /> 거절
      </button>
    </div>
  )
}
