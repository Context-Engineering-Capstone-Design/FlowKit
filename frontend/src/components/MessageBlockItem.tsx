import { Check, ChevronLeft, ChevronRight, Copy, Pencil, RotateCw, ThumbsDown, ThumbsUp, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { useChatStore } from '@/store/chatStore'
import type { MessageBlock, RefineResultItem, RefineStatus } from '@/types/api'

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
  const pendingAi = useChatStore((s) => s.pendingByBlockId[block.blockId])
  const failedJobId = useChatStore((s) => s.failedJobsByBlockId[block.blockId])
  const retryAiResponseJob = useChatStore((s) => s.retryAiResponseJob)
  const saveEdit = useChatStore((s) => s.editBlock)
  const rating = useChatStore((s) => s.ratings[block.blockId])
  const setFeedback = useChatStore((s) => s.setFeedback)
  const versions = useChatStore((s) => s.versionsByBlock[block.blockId])
  const loadVersions = useChatStore((s) => s.loadVersions)
  const setActiveVersion = useChatStore((s) => s.setActiveVersion)
  const view = useChatStore((s) => s.inlineView[block.blockId] ?? 'refined')
  const highlighted = useChatStore(
    (s) => s.highlightedBlockId === block.blockId,
  )

  const isUser = block.role === 'user'
  const pending = refine?.status === 'pending'
  const rejected = refine?.status === 'rejected'
  const shown = pending && view === 'refined' ? refine.refinedContent : block.content
  const currentVersionIndex = versions?.findIndex((version) => version.isCurrent) ?? -1
  const time = new Date(block.createdAt).toLocaleTimeString('ko', {
    hour: '2-digit',
    minute: '2-digit',
  })

  useEffect(() => {
    if ((block.versionNo ?? 0) > 1 && !versions) {
      void loadVersions(block.blockId)
    }
  }, [block.blockId, block.versionNo, loadVersions, versions])

  // 정제 결과가 대기 → 승인으로 바뀐 순간 잠깐 강조한다 (FE-REFINE-005)
  const [flash, setFlash] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(block.content)
  const [editBusy, setEditBusy] = useState(false)
  const prevRefineStatus = useRef<RefineStatus | undefined>(refine?.status)
  useEffect(() => {
    const was = prevRefineStatus.current
    prevRefineStatus.current = refine?.status
    if (was === 'pending' && refine?.status === 'approved') {
      setFlash(true)
      const timer = setTimeout(() => setFlash(false), 900)
      return () => clearTimeout(timer)
    }
  }, [refine?.status])

  return (
    <div
      id={`block-${block.blockId}`}
      className={`group relative border-l-[3px] py-2.5 pl-11 pr-5 transition ${flash ? 'approve-flash' : ''} ${
        selected
          ? 'border-sel-line bg-sel-bg'
          : highlighted
            ? 'border-green bg-green-dim'
            : pending
              ? 'border-blue'
              : rejected
                ? 'border-line-strong'
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
        <span className="text-[11px] text-txt-3">{time}</span>
      </div>

      {editing ? <div className="mt-1"><textarea value={draft} onChange={(e) => setDraft(e.target.value)} className="min-h-24 w-full rounded-lg bg-bg-2 p-2 text-[13px] text-txt-0 outline-none" /><div className="mt-1 flex gap-1"><button type="button" onClick={() => { setEditing(false); setDraft(block.content) }} className="rounded px-2 py-1 text-[11px] text-txt-2">취소</button><button type="button" disabled={editBusy || !draft.trim()} onClick={() => void (async () => { setEditBusy(true); if (await saveEdit(block.blockId, draft)) setEditing(false); setEditBusy(false) })()} className="rounded bg-blue px-2 py-1 text-[11px] text-white disabled:opacity-40">저장</button></div></div> : <div className="markdown text-[13.5px] leading-relaxed text-txt-1"><ReactMarkdown>{shown}</ReactMarkdown></div>}

      {isUser && failedJobId && <div className="mt-2 flex items-center gap-2 text-[11px] text-red"><span>답변 생성에 실패했습니다.</span><button type="button" onClick={() => void retryAiResponseJob(failedJobId)} className="rounded border border-red/40 px-1.5 py-0.5 hover:bg-red/10">다시 시도</button></div>}
      {!isUser && pendingAi && <div className="mt-2 text-[11px] text-txt-2">답변을 다시 생성하는 중…</div>}

      {pending && <InlineRefineBar result={refine} />}

      {!pending && (
        <div className="mt-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
          {versions && versions.length > 1 && currentVersionIndex >= 0 && (
            <div className="mr-1 flex items-center rounded border border-line text-[10px] text-txt-2">
              <button
                type="button"
                disabled={currentVersionIndex === 0}
                onClick={() => void setActiveVersion(block.blockId, versions[currentVersionIndex - 1].versionId)}
                title="이전 버전"
                className="rounded p-1 transition hover:bg-bg-3 disabled:cursor-default disabled:opacity-30"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="min-w-9 text-center">
                {currentVersionIndex + 1}/{versions.length}
              </span>
              <button
                type="button"
                disabled={currentVersionIndex === versions.length - 1}
                onClick={() => void setActiveVersion(block.blockId, versions[currentVersionIndex + 1].versionId)}
                title="다음 버전"
                className="rounded p-1 transition hover:bg-bg-3 disabled:cursor-default disabled:opacity-30"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {!isUser && (
            <>
              <button
                type="button"
                onClick={() => void setFeedback(block.blockId, 'like')}
                title="좋아요"
                aria-pressed={rating === 'like'}
                className={`rounded p-1 transition hover:bg-bg-3 ${
                  rating === 'like' ? 'bg-blue-dim text-blue' : 'text-txt-3 hover:text-txt-1'
                }`}
              >
                <ThumbsUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => void setFeedback(block.blockId, 'dislike')}
                title="싫어요"
                aria-pressed={rating === 'dislike'}
                className={`rounded p-1 transition hover:bg-bg-3 ${
                  rating === 'dislike' ? 'bg-blue-dim text-blue' : 'text-txt-3 hover:text-txt-1'
                }`}
              >
                <ThumbsDown className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => void regenerate(block.blockId)}
                disabled={pendingAi}
                title="답변 다시 시도"
                className="rounded p-1 text-txt-3 transition hover:bg-bg-3 hover:text-txt-1 disabled:opacity-40"
              >
                <RotateCw className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          <button type="button" onClick={() => void navigator.clipboard?.writeText(block.content)} title="복사" className="rounded p-1 text-txt-3 transition hover:bg-bg-3 hover:text-txt-1"><Copy className="h-3.5 w-3.5" /></button>
          {!editing && <button type="button" onClick={() => { setDraft(block.content); setEditing(true) }} title="수정" className="rounded p-1 text-txt-3 transition hover:bg-bg-3 hover:text-txt-1"><Pencil className="h-3.5 w-3.5" /></button>}
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
