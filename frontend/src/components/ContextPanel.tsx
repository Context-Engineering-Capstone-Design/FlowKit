import { Check, Pencil, SlidersHorizontal, Split, X } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { toPreview } from '@/lib/preview'
import { useChatStore } from '@/store/chatStore'
import type { RefineStatus } from '@/types/api'
import { MessageEditForm } from '@/components/MessageEditForm'

/** 항목이 밀려 나가는 시간(ms). 여러 개를 승인하면 이만큼씩 늦게 시작한다. */
const LEAVE_DURATION = 320
const LEAVE_STAGGER = 55

interface Props {
  open?: boolean
  onClose: () => void
  width: number
  onResizeStart: () => void
}

// 우측 패널 — 드래그 범위에서 연 블록 정제 결과를 검토한다
export function ContextPanel({ open = true, onClose, width, onResizeStart }: Props) {
  const blocks = useChatStore((s) => s.blocks)
  const refineTargetBlockId = useChatStore((s) => s.refineTargetBlockId)
  const refineJob = useChatStore((s) => s.refineJob)
  const [resizing, setResizing] = useState(false)

  const refineTarget = blocks.find((b) => b.blockId === refineTargetBlockId)

  function startResize() {
    setResizing(true)
    onResizeStart()
    function end() {
      setResizing(false)
      window.removeEventListener('pointerup', end)
    }
    window.addEventListener('pointerup', end)
  }

  return (
    <aside
      id="context-panel"
      aria-hidden={!open}
      inert={!open}
      style={{ '--panel-width': `${width}px` } as CSSProperties}
      className={`relative shrink-0 overflow-hidden bg-bg-1 max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-30 ${
        open ? 'w-[min(90vw,380px)] shadow-2xl lg:w-[var(--panel-width)]' : 'w-0'
      } ${resizing ? '' : 'transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none'}`}
    >
      <div
        className={`flex h-full w-[min(90vw,380px)] flex-col lg:w-[var(--panel-width)] ${
          resizing ? '' : 'transition-opacity duration-200 motion-reduce:transition-none'
        } ${open ? 'opacity-100' : 'opacity-0'}`}
      >
      {open && (
        <div aria-label="Context 패널 너비 조절" onPointerDown={startResize} className="absolute inset-y-0 left-0 hidden w-1 cursor-col-resize hover:bg-blue lg:block" />
      )}
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

      <div className="flex flex-1 flex-col overflow-y-auto">
        <SideChatSection />
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

      </div>
    </aside>
  )
}

// 사이드 채팅 만들기·전환 — 지금 대화 흐름을 그대로 참고하는 별도 대화 (0820_08 B2)
function SideChatSection() {
  const chatId = useChatStore((s) => s.chatId)
  const chatKind = useChatStore((s) => s.chatKind)
  const tabs = useChatStore((s) => s.tabs)
  const sideChatTree = useChatStore((s) => s.sideChatTree)
  const isCreating = useChatStore((s) => s.isCreatingSideChat)
  const createSideChatTab = useChatStore((s) => s.createSideChatTab)
  const openChat = useChatStore((s) => s.openChat)

  if (!chatId) return null
  const children = sideChatTree.filter((c) => c.parentChatId === chatId)

  return (
    <section className="border-b border-line px-4 pb-4 pt-3.5">
      <SectionLabel>사이드 채팅</SectionLabel>
      <p className="mt-1.5 text-[11px] leading-relaxed text-txt-3">
        상위 대화만 참고하며, 이 대화에는 자동으로 반영되지 않습니다.
      </p>
      {chatKind === 'MAIN' ? (
        <div className="mt-2.5 grid grid-cols-2 gap-1.5">
          <button type="button" onClick={() => void createSideChatTab()} disabled={isCreating} className="rounded-lg bg-bg-2 py-2 text-[12px] font-semibold text-txt-1 transition hover:bg-bg-3 disabled:opacity-50">
            <Split className="mr-1 inline h-3.5 w-3.5" />새 사이드 채팅 만들기
          </button>
          <button type="button" onClick={() => void createSideChatTab(undefined, undefined, true)} disabled={isCreating} className="rounded-lg bg-bg-2 py-2 text-[12px] font-semibold text-txt-1 transition hover:bg-bg-3 disabled:opacity-50">
            Temporary
          </button>
        </div>
      ) : (
        <div className="mt-2.5 grid grid-cols-2 gap-1.5">
          <button type="button" onClick={() => void createSideChatTab()} disabled={isCreating} className="rounded-lg bg-bg-2 py-2 text-[12px] font-semibold text-txt-1 transition hover:bg-bg-3 disabled:opacity-50"><Split className="mr-1 inline h-3.5 w-3.5" />새 사이드 채팅 만들기</button>
          <button type="button" onClick={() => void createSideChatTab(undefined, undefined, true)} disabled={isCreating} className="rounded-lg bg-bg-2 py-2 text-[12px] font-semibold text-txt-1 transition hover:bg-bg-3 disabled:opacity-50">Temporary</button>
        </div>
      )}

      {children.length > 0 && (
        <div className="mt-2 space-y-1">
          {children.map((child) => {
            const active = tabs.some((t) => t.chatId === child.chatId)
            return (
              <button
                key={child.chatId}
                type="button"
                onClick={() => void openChat(child.chatId)}
                className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[11.5px] transition ${
                  active ? 'bg-bg-2 text-txt-0' : 'text-txt-2 hover:bg-bg-2 hover:text-txt-1'
                }`}
              >
                <Split className="h-3 w-3 shrink-0 text-green" />
                <span className="truncate">{child.title}</span>
              </button>
            )
          })}
        </div>
      )}
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
  const blocks = useChatStore((s) => s.blocks)
  const branchId = useChatStore((s) => s.branchId)
  const refineTargetBlockId = useChatStore((s) => s.refineTargetBlockId)
  const refineJob = useChatStore((s) => s.refineJob)
  const editing = useChatStore((s) => s.editingBlockId === refineTargetBlockId)
  const draft = useChatStore((s) => s.editingDraft)
  const editBusy = useChatStore((s) => s.isSavingEdit)
  const startEdit = useChatStore((s) => s.startEdit)
  const setEditingDraft = useChatStore((s) => s.setEditingDraft)
  const cancelEdit = useChatStore((s) => s.cancelEdit)
  const saveEdit = useChatStore((s) => s.editBlock)
  const createBranchAt = useChatStore((s) => s.createBranchAt)

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
  const instruction = useChatStore((s) => s.contextInstruction)
  const setInstruction = useChatStore((s) => s.setContextInstruction)
  const focusSignal = useChatStore((s) => s.contextInstructionFocusSignal)
  const blocks = useChatStore((s) => s.blocks)
  const refineTargetBlockId = useChatStore((s) => s.refineTargetBlockId)
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
