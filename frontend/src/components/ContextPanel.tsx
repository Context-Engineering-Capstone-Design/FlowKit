import { Check, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { toPreview } from '@/lib/preview'
import { useChatStore } from '@/store/chatStore'
import type { RefineStatus } from '@/types/api'

/** 항목이 밀려 나가는 시간(ms). 여러 개를 승인하면 이만큼씩 늦게 시작한다. */
const LEAVE_DURATION = 320
const LEAVE_STAGGER = 55

const QUICK_EDITS = [
  '핵심만 요약',
  '불필요한 내용 제거',
  '초보자용으로',
  '예시 추가',
  '용어 설명 추가',
  '시험 대비용',
  '발표 대본용',
  '표로 정리',
]

interface Props {
  onClose: () => void
  width: number
  onResizeStart: () => void
}

// 우측 Context 편집 패널 — 선택한 블록 확인, 편집 지시 입력, 정제 결과 검토
export function ContextPanel({ onClose, width, onResizeStart }: Props) {
  const blocks = useChatStore((s) => s.blocks)
  const selectedIds = useChatStore((s) => s.selectedBlockIds)
  const refineJob = useChatStore((s) => s.refineJob)

  const selected = blocks.filter((b) => selectedIds.includes(b.blockId))

  return (
    <aside style={{ '--panel-width': `${width}px` } as CSSProperties} className="relative flex w-[min(90vw,380px)] shrink-0 flex-col overflow-hidden bg-bg-1 shadow-2xl max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-30 lg:w-[var(--panel-width)]">
      <div aria-label="Context 패널 너비 조절" onPointerDown={onResizeStart} className="absolute inset-y-0 left-0 hidden w-1 cursor-col-resize hover:bg-blue lg:block" />
      <header className="flex items-center justify-between px-4 py-3.5">
        <span className="flex items-center gap-2 text-[13px] font-semibold">
          <SlidersHorizontal className="h-3.5 w-3.5 text-txt-2" />
          Context 편집 패널
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-txt-3 transition hover:text-txt-0"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {selected.length === 0 && !refineJob ? (
        <EmptyGuide />
      ) : (
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          <SelectedBlocks />
          <RefineForm />
          {refineJob && <RefinePreview />}
        </div>
      )}

      {selected.length > 0 && !refineJob && <PanelFooter />}
    </aside>
  )
}

function EmptyGuide() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <p className="text-[12.5px] leading-relaxed text-txt-2">
        메시지 블록에 마우스를 올리면
        <br />
        왼쪽에 체크박스가 나타납니다.
      </p>
      <p className="mt-4 text-[12.5px] leading-relaxed text-txt-3">
        원하는 블록을 선택하면
        <br />
        Context 편집이 시작됩니다.
      </p>
    </div>
  )
}

// 선택된 블록 목록 (REQ-023)
function SelectedBlocks() {
  const blocks = useChatStore((s) => s.blocks)
  const selectedIds = useChatStore((s) => s.selectedBlockIds)
  const toggleBlock = useChatStore((s) => s.toggleBlock)

  const selected = blocks.filter((b) => selectedIds.includes(b.blockId))
  if (selected.length === 0) return null

  return (
    <section className="pt-3">
      <SectionLabel>
        선택된 블록
        <span className="ml-1.5 rounded bg-blue px-1.5 text-[10px] font-bold text-white">
          {selected.length}
        </span>
      </SectionLabel>

      <div className="mt-2 space-y-1.5">
        {selected.map((b) => (
          <div
            key={b.blockId}
            className="flex items-start gap-2 rounded-md bg-bg-2 px-2.5 py-2"
          >
            <span
              className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                b.role === 'user' ? 'bg-blue' : 'bg-green'
              }`}
            />
            <span className="line-clamp-2 flex-1 text-[11.5px] leading-relaxed text-txt-1">
              {toPreview(b.content)}
            </span>
            <button
              type="button"
              onClick={() => toggleBlock(b.blockId)}
              className="text-txt-3 transition hover:text-txt-0"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}

// 빠른 편집 버튼과 자연어 편집 지시 입력 (REQ-024, REQ-025)
function RefineForm() {
  const instruction = useChatStore((s) => s.contextInstruction)
  const setInstruction = useChatStore((s) => s.setContextInstruction)
  const focusSignal = useChatStore((s) => s.contextInstructionFocusSignal)
  const blocks = useChatStore((s) => s.blocks)
  const selectedIds = useChatStore((s) => s.selectedBlockIds)
  const branchId = useChatStore((s) => s.branchId)
  const isRefining = useChatStore((s) => s.isRefining)
  const runRefine = useChatStore((s) => s.runRefine)
  const retryRefine = useChatStore((s) => s.retryRefine)
  const refineFailed = useChatStore((s) => s.refineFailed)
  const refineError = useChatStore((s) => s.error)
  const refineJob = useChatStore((s) => s.refineJob)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [focusSignal])

  const selectedCount = selectedIds.length
  if (selectedCount === 0 || refineJob) return null

  // 다른(조상) 브랜치에서 이어받은 블록은 정제하면 원본 대화가 바뀌므로 대상에서 뺀다
  const hasInheritedBlock = blocks.some(
    (b) => selectedIds.includes(b.blockId) && b.branchId !== branchId,
  )

  return (
    <>
      <section className="pt-5">
        <SectionLabel>빠른 편집</SectionLabel>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {QUICK_EDITS.map((q) => (
            <button
              key={q}
              type="button"
            onClick={() => {
              setInstruction(q)
              textareaRef.current?.focus()
            }}
              className="rounded-full bg-bg-2 px-2.5 py-1 text-[11px] text-txt-1 transition hover:bg-bg-3 hover:text-txt-0"
            >
              {q}
            </button>
          ))}
        </div>
      </section>

      <section className="pt-5">
        <SectionLabel>AI 편집 지시</SectionLabel>
        <textarea
          ref={textareaRef}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          maxLength={2000}
          rows={3}
          placeholder="어떻게 정리할지 적어주세요"
          className="mt-2 w-full resize-none rounded-lg bg-bg-2 p-2.5 text-[12.5px] text-txt-0 outline-none placeholder:text-txt-3"
        />
        <button
          type="button"
          onClick={() => void runRefine(instruction)}
          disabled={isRefining || !instruction.trim() || hasInheritedBlock}
          className="mt-2 w-full rounded-lg bg-blue py-2.5 text-[12.5px] font-semibold text-white transition disabled:opacity-40"
        >
          {isRefining ? '정제 중…' : '블록별로 정제하기'}
        </button>
        {hasInheritedBlock ? (
          <p className="mt-1.5 text-[11px] text-txt-3">
            다른 브랜치에서 이어받은 블록은 정제할 수 없습니다. 선택에서 제외해주세요.
          </p>
        ) : (
          !instruction.trim() && !isRefining && (
            <p className="mt-1.5 text-[11px] text-txt-3">
              편집 지시를 입력해야 정제할 수 있습니다.
            </p>
          )
        )}
        {refineFailed && !isRefining && (
          <>
            {refineError && (
              <p className="mt-1.5 text-[11px] text-red">{refineError}</p>
            )}
            <button type="button" onClick={() => void retryRefine()} className="mt-1 w-full rounded-lg bg-bg-3 py-2 text-[12px] text-txt-1">같은 지시로 다시 시도</button>
          </>
        )}
        <p className="mt-2 text-[11px] leading-relaxed text-txt-3">
          선택한 블록을 각각 따로 정제합니다. 승인한 결과만 원본에 반영됩니다.
        </p>
      </section>
    </>
  )
}

// 정제 결과 미리보기 — 원본과 정제본 비교 (REQ-029)
function RefinePreview() {
  const refineJob = useChatStore((s) => s.refineJob)
  const blocks = useChatStore((s) => s.blocks)
  const approve = useChatStore((s) => s.approveResult)
  const reject = useChatStore((s) => s.rejectResult)
  const approveAll = useChatStore((s) => s.approveAll)
  const rejectAll = useChatStore((s) => s.rejectAll)
  const closeRefine = useChatStore((s) => s.closeRefine)

  // 방금 승인되어 밀려 나가는 중인 항목. 애니메이션이 끝나야 목록에서 완전히 빠진다 (REQ-039)
  const [leavingIds, setLeavingIds] = useState<Set<string>>(new Set())
  const prevStatuses = useRef<Record<string, RefineStatus>>({})

  useEffect(() => {
    if (!refineJob) {
      prevStatuses.current = {}
      return
    }
    const prev = prevStatuses.current
    const justApproved = refineJob.results.filter(
      (r) => r.status === 'approved' && prev[r.resultId] === 'pending',
    )
    prevStatuses.current = Object.fromEntries(
      refineJob.results.map((r) => [r.resultId, r.status]),
    )
    if (justApproved.length === 0) return

    setLeavingIds((ids) => new Set([...ids, ...justApproved.map((r) => r.resultId)]))
    const timers = justApproved.map((r, i) =>
      setTimeout(
        () => {
          setLeavingIds((ids) => {
            if (!ids.has(r.resultId)) return ids
            const next = new Set(ids)
            next.delete(r.resultId)
            return next
          })
        },
        LEAVE_DURATION + i * LEAVE_STAGGER,
      ),
    )
    return () => timers.forEach(clearTimeout)
  }, [refineJob])

  // 승인된 항목은 목록에서 빠지고, 대기·거절 상태만 남는다 (REQ-032)
  // 상태가 바뀐 첫 렌더에서도 항목을 유지해야 다음 렌더에서 퇴장 효과를 시작할 수 있다
  const justApprovedIds = new Set(
    refineJob?.results
      .filter(
        (r) => r.status === 'approved' && prevStatuses.current[r.resultId] === 'pending',
      )
      .map((r) => r.resultId) ?? [],
  )
  const visible =
    refineJob?.results.filter(
      (r) =>
        r.status !== 'approved' ||
        leavingIds.has(r.resultId) ||
        justApprovedIds.has(r.resultId),
    ) ?? []
  // 남은 항목이 하나도 없으면 카드 전체를 서서히 닫는다
  const closing = refineJob !== null && visible.length === 0

  useEffect(() => {
    if (!closing) return
    const timer = setTimeout(() => void closeRefine(), 280)
    return () => clearTimeout(timer)
  }, [closing, closeRefine])

  if (!refineJob) return null
  const pending = refineJob.results.filter((r) => r.status === 'pending')

  return (
    <section
      className={`pt-5 transition-opacity duration-300 ${closing ? 'opacity-0' : 'opacity-100'}`}
    >
      <SectionLabel>블록별 정제 미리보기</SectionLabel>

      <div className="mt-2 space-y-2.5">
        {visible.map((r) => {
          const leaving = leavingIds.has(r.resultId)
          return (
            <div
              key={r.resultId}
              className={`grid transition-all ease-in ${
                leaving ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'
              }`}
              style={{ transitionDuration: `${LEAVE_DURATION}ms` }}
            >
              <div
                className={`overflow-hidden rounded-lg bg-bg-2 transition-transform ease-in ${
                  leaving ? 'translate-x-6' : 'translate-x-0'
                }`}
                style={{ transitionDuration: `${LEAVE_DURATION}ms` }}
              >
                <div className="p-2.5">
                  <div className="flex items-center justify-between">
                    <p className="text-[10.5px] font-semibold text-txt-3">
                      원본 · {blocks.find((block) => block.blockId === r.blockId)?.role === 'user' ? 'User' : 'AI'}
                    </p>
                    <StatusBadge status={r.status} />
                  </div>
                  <p className="mt-1 line-clamp-3 border-l-2 border-line pl-2 text-[11.5px] leading-relaxed text-txt-2">
                    {r.baseContent}
                  </p>
                  <button type="button" onClick={() => document.getElementById(`block-${r.blockId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })} className="mt-1 text-[10.5px] text-blue hover:underline">원본 위치로 이동</button>

                  <p className="mt-2.5 text-[10.5px] font-semibold text-green">
                    정제 결과
                  </p>
                  <p className="mt-1 line-clamp-4 border-l-2 border-green pl-2 text-[11.5px] leading-relaxed text-txt-1">
                    {r.refinedContent}
                  </p>

                  {r.status === 'pending' && (
                    <div className="mt-2.5 flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => void approve(r.resultId)}
                        className="flex flex-1 items-center justify-center gap-1 rounded-md bg-blue-dim py-1.5 text-[11px] font-semibold text-blue transition hover:bg-blue hover:text-white"
                      >
                        <Check className="h-3 w-3" /> 승인
                      </button>
                      <button
                        type="button"
                        onClick={() => void reject(r.resultId)}
                        className="flex flex-1 items-center justify-center gap-1 rounded-md bg-bg-3 py-1.5 text-[11px] text-txt-1 transition hover:text-txt-0"
                      >
                        <X className="h-3 w-3" /> 거절
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-3 flex gap-1.5">
        {pending.length > 0 && (
          <button
            type="button"
            onClick={() => void approveAll()}
            className="flex-1 rounded-lg bg-blue py-2 text-[12px] font-semibold text-white"
          >
            전체 승인
          </button>
        )}
        {pending.length > 0 && (
          <button type="button" onClick={() => void rejectAll()} className="flex-1 rounded-lg bg-bg-3 py-2 text-[12px] text-txt-1 transition hover:text-txt-0">전체 거절</button>
        )}
        <button
          type="button"
          onClick={() => void closeRefine()}
          className="flex-1 rounded-lg bg-bg-3 py-2 text-[12px] text-txt-1 transition hover:text-txt-0"
        >
          닫기
        </button>
      </div>
    </section>
  )
}

// Context 적용과 브랜치 생성 (REQ-046, REQ-010)
function PanelFooter() {
  const applyContext = useChatStore((s) => s.applyContext)
  const selectedCount = useChatStore((s) => s.selectedBlockIds.length)
  const blocks = useChatStore((s) => s.blocks)
  const openBranchModal = useChatStore((s) => s.openBranchModal)

  return (
    <div className="space-y-1.5 px-4 py-3">
      <button
        type="button"
        onClick={applyContext}
        className="w-full rounded-lg bg-blue py-2.5 text-[12.5px] font-semibold text-white"
      >
        이 Context로 질문하기 ({selectedCount})
      </button>
      <button
        type="button"
        onClick={() => openBranchModal(blocks.at(-1)?.blockId ?? '', undefined, 'block')}
        className="w-full rounded-lg bg-bg-3 py-2.5 text-[12.5px] font-semibold text-txt-1 transition hover:text-txt-0"
      >
        이 Context로 브랜치 생성
      </button>
    </div>
  )
}

// 정제 결과 상태 배지 — 대기·거절됨 (REQ-032)
function StatusBadge({ status }: { status: RefineStatus }) {
  if (status === 'approved') {
    return (
      <span className="rounded bg-green-dim px-1.5 py-px text-[10px] text-green">
        승인됨
      </span>
    )
  }
  if (status === 'rejected') {
    return (
      <span className="rounded bg-bg-3 px-1.5 py-px text-[10px] text-txt-3">
        거절됨
      </span>
    )
  }
  return (
    <span className="rounded bg-blue-dim px-1.5 py-px text-[10px] text-blue">
      대기
    </span>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
      {children}
    </p>
  )
}
