import { Check, Pencil, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toPreview } from '@/lib/preview'
import { useChatPaneStore } from '@/components/ChatPaneContext'
import type { RefineStatus } from '@/types/api'
import { MessageEditForm } from '@/components/MessageEditForm'

/** 항목이 밀려 나가는 시간(ms). 여러 개를 승인하면 이만큼씩 늦게 시작한다. */
const LEAVE_DURATION = 320
const LEAVE_STAGGER = 55

interface Props {
  onClose: () => void
  /** 이전 좁은 패널 호출부 호환용. */
  open?: boolean
  width?: number
  onResizeStart?: () => void
}

// 대화 패널 안 Context 편집 탭 — 드래그 범위에서 연 블록 정제 결과를 검토한다
export function ContextPanel({ onClose }: Props) {
  const blocks = useChatPaneStore((s) => s.blocks)
  const refineTargetBlockId = useChatPaneStore((s) => s.refineTargetBlockId)
  const refineJob = useChatPaneStore((s) => s.refineJob)

  const refineTarget = blocks.find((b) => b.blockId === refineTargetBlockId)

  return (
    <section className="flex h-full min-h-0 flex-col bg-bg-1">
      <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <span className="flex items-center gap-2 text-[13px] font-semibold">
          <SlidersHorizontal className="h-3.5 w-3.5 text-txt-2" />
          Context 편집 패널
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-txt-3 transition hover:text-txt-0"
        >
          닫기
        </button>
      </header>

      <div className="flex flex-1 flex-col overflow-y-auto">
        {!refineTarget && !refineJob ? (
          <EmptyGuide />
        ) : (
          <div className="px-4 pb-4">
            <SelectedBlocks />
            <RefineForm />
            {refineJob && <RefinePreview />}
          </div>
        )}
      </div>
    </section>
  )
}

function EmptyGuide() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <p className="text-[12.5px] leading-relaxed text-txt-2">
        메시지에서 원하는 범위를 드래그한 뒤
        <br />
        블록 정제를 선택하세요.
      </p>
      <p className="mt-4 text-[12.5px] leading-relaxed text-txt-3">
        드래그한 범위가 속한 메시지 블록을
        <br />
        개별 정제할 수 있습니다.
      </p>
    </div>
  )
}

// 드래그 범위에서 연 단일 정제 대상 — 연필 아이콘으로 바로 고칠 수 있다
function SelectedBlocks() {
  const blocks = useChatPaneStore((s) => s.blocks)
  const branchId = useChatPaneStore((s) => s.branchId)
  const refineTargetBlockId = useChatPaneStore((s) => s.refineTargetBlockId)
  const refineJob = useChatPaneStore((s) => s.refineJob)
  const editing = useChatPaneStore((s) => s.editingBlockId === refineTargetBlockId)
  const draft = useChatPaneStore((s) => s.editingDraft)
  const editBusy = useChatPaneStore((s) => s.isSavingEdit)
  const startEdit = useChatPaneStore((s) => s.startEdit)
  const setEditingDraft = useChatPaneStore((s) => s.setEditingDraft)
  const cancelEdit = useChatPaneStore((s) => s.cancelEdit)
  const saveEdit = useChatPaneStore((s) => s.editBlock)
  const createBranchAt = useChatPaneStore((s) => s.createBranchAt)

  const selected = blocks.find((b) => b.blockId === refineTargetBlockId)
  if (!selected) return null

  const canEdit = !refineJob && selected.branchId === branchId

  return (
    <section className="pt-3">
      <div className="flex items-center justify-between gap-2">
        <SectionLabel>정제할 블록</SectionLabel>
        {canEdit && !editing && (
          <button
            type="button"
            title="블록 내용 수정"
            aria-label="정제할 블록 내용 수정"
            onClick={() => void startEdit(selected.blockId, selected.content)}
            className="rounded-md p-1 text-txt-3 transition hover:bg-bg-2 hover:text-txt-0"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="mt-2 space-y-1.5">
        {editing ? (
          <MessageEditForm
            draft={draft}
            busy={editBusy}
            onDraftChange={setEditingDraft}
            onCancel={cancelEdit}
            onSaveBranch={() => void createBranchAt(selected.blockId)}
            onSave={() => saveEdit(selected.blockId, draft)}
          />
        ) : (
          <div className="flex items-start gap-2 rounded-md bg-bg-2 px-2.5 py-2">
            <span
              className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                selected.role === 'user' ? 'bg-blue' : 'bg-green'
              }`}
            />
            <span className="line-clamp-2 flex-1 text-[11.5px] leading-relaxed text-txt-1">
              {toPreview(selected.content)}
            </span>
          </div>
        )}
      </div>
    </section>
  )
}

// 자연어 편집 지시 입력 (REQ-025)
function RefineForm() {
  const instruction = useChatPaneStore((s) => s.contextInstruction)
  const setInstruction = useChatPaneStore((s) => s.setContextInstruction)
  const focusSignal = useChatPaneStore((s) => s.contextInstructionFocusSignal)
  const blocks = useChatPaneStore((s) => s.blocks)
  const refineTargetBlockId = useChatPaneStore((s) => s.refineTargetBlockId)
  const branchId = useChatPaneStore((s) => s.branchId)
  const isRefining = useChatPaneStore((s) => s.isRefining)
  const runRefine = useChatPaneStore((s) => s.runRefine)
  const retryRefine = useChatPaneStore((s) => s.retryRefine)
  const refineFailed = useChatPaneStore((s) => s.refineFailed)
  const refineError = useChatPaneStore((s) => s.error)
  const refineJob = useChatPaneStore((s) => s.refineJob)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [focusSignal])

  if (!refineTargetBlockId || refineJob) return null

  // 다른(조상) 브랜치에서 이어받은 블록은 정제하면 원본 대화가 바뀌므로 대상에서 뺀다
  const hasInheritedBlock = blocks.some(
    (b) => b.blockId === refineTargetBlockId && b.branchId !== branchId,
  )

  return (
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
  )
}

// 정제 결과 미리보기 — 원본과 정제본 비교 (REQ-029)
function RefinePreview() {
  const refineJob = useChatPaneStore((s) => s.refineJob)
  const blocks = useChatPaneStore((s) => s.blocks)
  const approve = useChatPaneStore((s) => s.approveResult)
  const reject = useChatPaneStore((s) => s.rejectResult)
  const approveAll = useChatPaneStore((s) => s.approveAll)
  const rejectAll = useChatPaneStore((s) => s.rejectAll)
  const closeRefine = useChatPaneStore((s) => s.closeRefine)

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
