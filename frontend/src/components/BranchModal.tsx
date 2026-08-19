import { GitBranch, X } from 'lucide-react'
import { useState } from 'react'
import { useChatStore } from '@/store/chatStore'
import { toPreview } from '@/lib/preview'

const NAME_SUGGESTIONS = [
  '핵심 개념 중심 설명',
  '시험 대비 요약 중심',
  '발표 자료용 설명',
  '초보자용 쉬운 설명',
]

interface Props {
  onClose: () => void
  initialBaseBlockId?: string
  initialContextBlockIds?: string[]
  editedBaseContent?: string
}

// 브랜치 생성 모달 — 이름, 분기 지점, 포함할 Context 블록을 정한다 (REQ-009, REQ-010)
export function BranchModal({ onClose, initialBaseBlockId, initialContextBlockIds, editedBaseContent }: Props) {
  const blocks = useChatStore((s) => s.blocks)
  const selectedBlockIds = useChatStore((s) => s.selectedBlockIds)
  const createBranch = useChatStore((s) => s.createBranch)
  const isCreatingBranch = useChatStore((s) => s.isCreatingBranch)
  const branchError = useChatStore((s) => s.branchError)

  const [name, setName] = useState('')
  // 분기 지점 기본값은 마지막 블록 — 지금까지의 대화를 모두 이어받는다
  const [baseBlockId, setBaseBlockId] = useState(
    initialBaseBlockId ?? blocks.at(-1)?.blockId ?? '',
  )
  const [contextIds, setContextIds] = useState<string[]>(initialContextBlockIds ?? selectedBlockIds)

  const baseBlock = blocks.find((b) => b.blockId === baseBlockId)
  // 분기 지점 이후 블록은 새 브랜치에 없으므로 Context 로 고를 수 없다
  const selectable = baseBlock
    ? blocks.filter((b) => b.orderIndex <= baseBlock.orderIndex)
    : blocks

  function toggle(blockId: string) {
    setContextIds((prev) =>
      prev.includes(blockId)
        ? prev.filter((id) => id !== blockId)
        : [...prev, blockId],
    )
  }

  async function submit() {
    const valid = contextIds.filter((id) =>
      selectable.some((b) => b.blockId === id),
    )
    const ok = await createBranch(name, baseBlockId, valid, editedBaseContent)
    if (ok) onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-[80vh] w-[480px] flex-col rounded-2xl bg-bg-1">
        <header className="flex items-center justify-between px-5 py-4">
          <span className="flex items-center gap-2 text-[14px] font-semibold">
            <GitBranch className="h-4 w-4 text-green" />
            브랜치 생성
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-txt-3 transition hover:text-txt-0"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 pb-2">
          <Field label="브랜치 이름">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 구조적 해저드 중심 설명"
              className="w-full rounded-lg bg-bg-2 px-3 py-2.5 text-[13px] text-txt-0 outline-none placeholder:text-txt-3"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {NAME_SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setName(s)}
                  className="rounded-full bg-bg-2 px-2.5 py-1 text-[11px] text-txt-1 transition hover:bg-bg-3 hover:text-txt-0"
                >
                  {s}
                </button>
              ))}
            </div>
          </Field>

          <Field label="분기 지점">
            <select
              value={baseBlockId}
              onChange={(e) => setBaseBlockId(e.target.value)}
              className="w-full rounded-lg bg-bg-2 px-3 py-2.5 text-[13px] text-txt-0 outline-none"
            >
              {blocks.map((b) => (
                <option key={b.blockId} value={b.blockId}>
                  블록 {b.orderIndex + 1} — {toPreview(b.content).slice(0, 40)}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-[11px] text-txt-3">
              이 지점까지의 대화를 새 브랜치가 이어받습니다. 원본 대화는 그대로
              남습니다.
            </p>
          </Field>

          <Field label={`포함할 Context 블록 (${contextIds.length})`}>
            <div className="space-y-1">
              {selectable.map((b) => (
                <label
                  key={b.blockId}
                  className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 transition hover:bg-bg-2"
                >
                  <input
                    type="checkbox"
                    checked={contextIds.includes(b.blockId)}
                    onChange={() => toggle(b.blockId)}
                    className="mt-1 h-3.5 w-3.5 shrink-0 accent-blue"
                  />
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                      b.role === 'user' ? 'bg-blue' : 'bg-green'
                    }`}
                  />
                  <span className="line-clamp-2 text-[12px] leading-relaxed text-txt-1">
                    {toPreview(b.content)}
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-txt-3">
              고른 블록은 브랜치 상단에 출발 Context로 표시됩니다.
            </p>
          </Field>
        </div>

        <footer className="flex justify-end gap-2 px-5 py-4">
          {branchError && <p className="mr-auto self-center text-[11px] text-red">{branchError}</p>}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-[12.5px] text-txt-2 transition hover:text-txt-0"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={isCreatingBranch || !name.trim() || !baseBlockId}
            className="rounded-lg bg-green px-4 py-2 text-[12.5px] font-semibold text-white transition disabled:opacity-40"
          >
            {isCreatingBranch ? '만드는 중…' : '브랜치 생성'}
          </button>
        </footer>
      </div>
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <section className="pt-4">
      <p className="pb-2 text-[11px] font-semibold uppercase tracking-wide text-txt-3">
        {label}
      </p>
      {children}
    </section>
  )
}
