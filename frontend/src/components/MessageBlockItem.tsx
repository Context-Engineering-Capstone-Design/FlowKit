import { Check, Copy, ExternalLink, Paperclip, X } from 'lucide-react'
import { useEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import { MessageBlockActions } from '@/components/MessageBlockActions'
import { MessageEditForm } from '@/components/MessageEditForm'
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
  const editing = useChatStore((s) => s.editingBlockId === block.blockId)
  const draft = useChatStore((s) => s.editingDraft)
  const editBusy = useChatStore((s) => s.isSavingEdit)
  const startEdit = useChatStore((s) => s.startEdit)
  const setEditingDraft = useChatStore((s) => s.setEditingDraft)
  const cancelEdit = useChatStore((s) => s.cancelEdit)
  const rating = useChatStore((s) => s.ratings[block.blockId])
  const setFeedback = useChatStore((s) => s.setFeedback)
  const versions = useChatStore((s) => s.versionsByBlock[block.blockId])
  const loadVersions = useChatStore((s) => s.loadVersions)
  const setActiveVersion = useChatStore((s) => s.setActiveVersion)
  const openBranchModal = useChatStore((s) => s.openBranchModal)
  const openContextEditor = useChatStore((s) => s.openContextEditor)
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

      {editing ? (
        <MessageEditForm
          draft={draft}
          busy={editBusy}
          onDraftChange={setEditingDraft}
          onCancel={cancelEdit}
          onSaveBranch={() => openBranchModal(block.blockId, draft)}
          onSave={() => saveEdit(block.blockId, draft)}
        />
      ) : (
        <div className="markdown text-[13.5px] leading-relaxed text-txt-1">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={{ pre: CodeBlock }}
          >
            {shown}
          </ReactMarkdown>
        </div>
      )}

      {block.attachments.length > 0 && <AttachmentList attachments={block.attachments} />}
      {!isUser && block.searchSources.length > 0 && <SearchSourceList sources={block.searchSources} />}

      {isUser && failedJobId && <div className="mt-2 flex items-center gap-2 text-[11px] text-red"><span>답변 생성에 실패했습니다.</span><button type="button" onClick={() => void retryAiResponseJob(failedJobId)} className="rounded border border-red/40 px-1.5 py-0.5 hover:bg-red/10">다시 시도</button></div>}
      {!isUser && pendingAi && <div className="mt-2 text-[11px] text-txt-2">답변을 다시 생성하는 중…</div>}

      {pending && <InlineRefineBar result={refine} />}

      {!pending && (
        <MessageBlockActions
          block={block}
          isUser={isUser}
          pendingAi={pendingAi}
          editing={editing}
          rating={rating}
          versions={versions}
          currentVersionIndex={currentVersionIndex}
          onSetActiveVersion={(versionId) =>
            setActiveVersion(block.blockId, versionId)
          }
          onSetFeedback={(nextRating) =>
            setFeedback(block.blockId, nextRating)
          }
          onRegenerate={() => regenerate(block.blockId)}
          onStartEdit={() => startEdit(block.blockId, block.content)}
          onOpenContextEditor={() => openContextEditor(block.blockId)}
          onOpenBranch={() => openBranchModal(block.blockId)}
        />
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

// 코드 블록 — 언어별 색 구분에 더해 블록 하나만 복사하는 버튼을 얹는다
function CodeBlock(props: ComponentPropsWithoutRef<'pre'>) {
  const ref = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)

  async function copyCode() {
    const text = (ref.current?.textContent ?? '').replace(/\n$/, '')
    try {
      if (!navigator.clipboard) throw new Error('Clipboard API unavailable')
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // 실패해도 코드 블록 자체는 이미 보이므로 조용히 무시한다
    }
  }

  return (
    <div className="group/code relative">
      <button
        type="button"
        onClick={() => void copyCode()}
        className="absolute right-2 top-2 flex items-center gap-1 rounded-md border border-line bg-bg-3 px-1.5 py-1 text-[11px] text-txt-2 opacity-0 transition group-hover/code:opacity-100 hover:text-txt-0"
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      </button>
      <pre ref={ref} {...props} />
    </div>
  )
}

// 메시지에 붙은 첨부 파일 이름 목록 (읽기 전용)
function AttachmentList({ attachments }: { attachments: MessageBlock['attachments'] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {attachments.map((attachment) => (
        <span
          key={attachment.attachmentId}
          className="flex items-center gap-1 rounded-md border border-line bg-bg-2 px-2 py-1 text-[11px] text-txt-2"
        >
          <Paperclip className="h-3 w-3" />
          {attachment.fileName}
        </span>
      ))}
    </div>
  )
}

// 웹 검색으로 답했을 때 참고한 자료 목록
function SearchSourceList({ sources }: { sources: MessageBlock['searchSources'] }) {
  return (
    <div className="mt-2.5 flex flex-col gap-1 rounded-lg bg-bg-2 px-2.5 py-2">
      <span className="text-[11px] font-semibold text-txt-2">참고 자료</span>
      {sources.map((source, index) => (
        <a
          key={`${source.url}-${index}`}
          href={source.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 text-[11.5px] text-blue hover:underline"
        >
          <ExternalLink className="h-3 w-3 shrink-0" />
          <span className="truncate">{source.title}</span>
        </a>
      ))}
    </div>
  )
}
