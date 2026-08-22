import { Check, Copy, ExternalLink, Paperclip, Split, X } from 'lucide-react'
import { useEffect, useRef, useState, type ComponentPropsWithoutRef, type CSSProperties } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import { MessageBlockActions } from '@/components/MessageBlockActions'
import { MessageEditForm } from '@/components/MessageEditForm'
import { SelectionActionToggle } from '@/components/SelectionActionToggle'
import { useChatPaneStore } from '@/components/ChatPaneContext'
import { closeUnterminatedMarkdown } from '@/lib/streamingMarkdown'
import { rehypeHighlightRanges } from '@/lib/rehypeHighlightRanges'
import { captureSelection, SELECTABLE_ROOT_ATTR, toTagPreview } from '@/lib/textRangeSelection'
import type { AppliedContextOut, AttachmentResponse, MessageBlock, RefineResultItem, RefineStatus } from '@/types/api'
import { fetchAttachmentFile } from '@/api/inputAssist'
import { openChatInSidePanel } from '@/store/chatStore'

interface Props {
  block: MessageBlock
  refine?: RefineResultItem
}

// 메시지 블록 하나 — 드래그 범위로 Context·정제를 시작하고 정제 결과를 인라인으로 비교
export function MessageBlockItem({ block, refine }: Props) {
  const currentBranchId = useChatPaneStore((s) => s.branchId)
  const regenerate = useChatPaneStore((s) => s.regenerate)
  const pendingAi = useChatPaneStore((s) => s.pendingByBlockId[block.blockId])
  const failedJobId = useChatPaneStore((s) => s.failedJobsByBlockId[block.blockId])
  const retryAiResponseJob = useChatPaneStore((s) => s.retryAiResponseJob)
  const isSending = useChatPaneStore((s) => s.isSending)
  const saveEdit = useChatPaneStore((s) => s.editBlock)
  const editing = useChatPaneStore((s) => s.editingBlockId === block.blockId)
  const draft = useChatPaneStore((s) => s.editingDraft)
  const editBusy = useChatPaneStore((s) => s.isSavingEdit)
  const startEdit = useChatPaneStore((s) => s.startEdit)
  const setEditingDraft = useChatPaneStore((s) => s.setEditingDraft)
  const cancelEdit = useChatPaneStore((s) => s.cancelEdit)
  const rating = useChatPaneStore((s) => s.ratings[block.blockId])
  const setFeedback = useChatPaneStore((s) => s.setFeedback)
  const versions = useChatPaneStore((s) => s.versionsByBlock[block.blockId])
  const loadVersions = useChatPaneStore((s) => s.loadVersions)
  const setActiveVersion = useChatPaneStore((s) => s.setActiveVersion)
  const createBranchAt = useChatPaneStore((s) => s.createBranchAt)
  const openRefine = useChatPaneStore((s) => s.openRefine)
  const createSideChatTab = useChatPaneStore((s) => s.createSideChatTab)
  const linkedSideChats = useChatPaneStore((s) => s.sideChatsByBlockId[block.blockId])
  const view = useChatPaneStore((s) => s.inlineView[block.blockId] ?? 'refined')
  const highlighted = useChatPaneStore(
    (s) => s.highlightedBlockId === block.blockId,
  )
  const contextRangeTags = useChatPaneStore((s) => s.contextRangeTags)
  const editingContextTags = useChatPaneStore((s) => s.editingContextTags)
  const addContextRangeTag = useChatPaneStore((s) => s.addContextRangeTag)
  const removeContextRangeTag = useChatPaneStore((s) => s.removeContextRangeTag)
  const removeEditingContextTag = useChatPaneStore((s) => s.removeEditingContextTag)
  const openDraftSideChatWithRange = useChatPaneStore((s) => s.openDraftSideChatWithRange)

  const isUser = block.role === 'user'
  const chatId = useChatPaneStore((s) => s.chatId)
  const imageAttachments = block.attachments.filter((item) => item.mimeType.startsWith('image/'))
  const fileAttachments = block.attachments.filter((item) => !item.mimeType.startsWith('image/'))
  // 다른(조상) 브랜치에서 이어받은 블록은 재생성하면 원본 대화가 바뀌므로 버튼을 숨긴다
  const isOwnBranch = block.branchId === currentBranchId
  const pending = refine?.status === 'pending'
  const rejected = refine?.status === 'rejected'
  const isGenerating = block.generationStatus === 'generating'
  const isCancelled = block.generationStatus === 'cancelled'
  const isFailed = block.generationStatus === 'failed'
  // 생성 중·중단됨·실패한 답변은 Context·정제·분기 어디에도 쓸 수 없다 (D밀스톤).
  // 서버도 같은 조건으로 막지만, 화면에서 먼저 막아야 헛걸음을 줄인다.
  const eligibleForReuse = block.generationStatus === 'complete'
  const shown = pending && view === 'refined' ? refine.refinedContent : block.content
  const displayed = isGenerating ? closeUnterminatedMarkdown(shown) : shown
  const currentVersionIndex = versions?.findIndex((version) => version.isCurrent) ?? -1

  useEffect(() => {
    if ((block.versionNo ?? 0) > 1 && !versions) {
      void loadVersions(block.blockId)
    }
  }, [block.blockId, block.versionNo, loadVersions, versions])

  // 정제 결과가 대기 → 승인으로 바뀐 순간 잠깐 강조한다
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

  // 이 메시지 안에서 드래그로 고른 범위 (0820_13 A1~A4). 첨부 미리보기는 이 안에 두지 않아 선택할 수 없다.
  const contentRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLDivElement>(null)
  const [pendingSelection, setPendingSelection] = useState<{
    text: string
    snapshotText: string
    startOffset: number
    endOffset: number
    toggleStyle: CSSProperties
  } | null>(null)

  const highlightedRange = useChatPaneStore((s) => s.highlightedRange)

  const rangeTagsForBlock = contextRangeTags.filter(
    (tag) => tag.messageBlockId === block.blockId && tag.messageVersionId === block.currentVersionId,
  )
  const highlightRanges = rangeTagsForBlock.map((tag) => ({ id: tag.id, start: tag.startOffset, end: tag.endOffset }))
  if (
    highlightedRange &&
    highlightedRange.blockId === block.blockId &&
    highlightedRange.versionId === block.currentVersionId
  ) {
    highlightRanges.push({
      id: 'inspected-context-range',
      start: highlightedRange.startOffset,
      end: highlightedRange.endOffset,
    })
  }

  function dismissPendingSelection() {
    setPendingSelection(null)
    window.getSelection()?.removeAllRanges()
  }

  useEffect(() => {
    if (!pendingSelection) return
    function handleDocumentMouseDown(e: MouseEvent) {
      if (toggleRef.current?.contains(e.target as Node)) return
      dismissPendingSelection()
    }
    document.addEventListener('mousedown', handleDocumentMouseDown)
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSelection])

  function handleContentMouseUp() {
    if (!eligibleForReuse || !block.currentVersionId) return
    const captured = captureSelection(window.getSelection())
    if (!captured || captured.root !== contentRef.current) return
    const range = window.getSelection()!.getRangeAt(0)
    const rect = range.getBoundingClientRect?.() ?? { top: 0, bottom: 0, left: 0 }
    setPendingSelection({
      text: captured.text,
      snapshotText: captured.snapshotText,
      startOffset: captured.startOffset,
      endOffset: captured.endOffset,
      toggleStyle: { top: rect.bottom + 6, left: Math.min(Math.max(8, rect.left), window.innerWidth - 260) },
    })
  }

  // 이미 태그가 붙어 강조된 범위를 다시 누르면 그 선택을 비활성화한다 (0820_13 선택 규칙)
  function handleContentClick(e: React.MouseEvent<HTMLDivElement>) {
    const mark = (e.target as HTMLElement).closest('.ctx-range-mark')
    if (!mark) return
    for (const id of (mark.getAttribute('data-range-ids') ?? '').split(',').filter(Boolean)) {
      removeContextRangeTag(id)
    }
  }

  function addPendingToChat() {
    if (!pendingSelection || !block.currentVersionId) return
    const rawOffsets = block.content.slice(pendingSelection.startOffset, pendingSelection.endOffset) === pendingSelection.text
      ? { rawStartOffset: pendingSelection.startOffset, rawEndOffset: pendingSelection.endOffset }
      : {}
    addContextRangeTag({
      messageBlockId: block.blockId,
      messageVersionId: block.currentVersionId,
      role: block.role,
      snapshotText: pendingSelection.snapshotText,
      selectedText: pendingSelection.text,
      ...rawOffsets,
      startOffset: pendingSelection.startOffset,
      endOffset: pendingSelection.endOffset,
    })
    dismissPendingSelection()
  }

  function askPendingInSideChat() {
    if (!pendingSelection || !block.currentVersionId) return
    const rawOffsets = block.content.slice(pendingSelection.startOffset, pendingSelection.endOffset) === pendingSelection.text
      ? { rawStartOffset: pendingSelection.startOffset, rawEndOffset: pendingSelection.endOffset }
      : {}
    void openDraftSideChatWithRange({
      messageBlockId: block.blockId,
      messageVersionId: block.currentVersionId,
      role: block.role,
      snapshotText: pendingSelection.snapshotText,
      selectedText: pendingSelection.text,
      ...rawOffsets,
      startOffset: pendingSelection.startOffset,
      endOffset: pendingSelection.endOffset,
    })
    dismissPendingSelection()
  }

  function refinePendingSelection() {
    if (!pendingSelection) return
    openRefine(block.blockId)
    dismissPendingSelection()
  }

  // 인용 태그와 같은 줄 흐름으로 배치할 본문 — 전송 당시 인용한 Context가 있으면
  // 말풍선 안에서 태그 옆에 나란히 보이게 한다 (composer의 인라인 칩 배치와 맞춘다)
  const markdownBody = shown.trim() ? (
    <div
      ref={contentRef}
      {...(eligibleForReuse ? { [SELECTABLE_ROOT_ATTR]: '' } : {})}
      onMouseUp={eligibleForReuse ? handleContentMouseUp : undefined}
      onClick={eligibleForReuse ? handleContentClick : undefined}
      className={`markdown min-w-0 text-[13.5px] leading-relaxed ${isUser ? 'text-txt-0' : 'w-full text-txt-1'}`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // rehypeRaw 로 <br> 같은 원본 HTML을 실제 태그로 바꾸고, 그 결과를
        // rehypeSanitize(기본 허용 목록)로 걸러 스크립트·이벤트 속성을 없앤 뒤에야
        // rehypeHighlight 가 코드 블록에 강조 클래스를 붙인다. sanitize를 강조보다
        // 뒤에 두면 강조가 붙인 클래스까지 함께 지워진다. 드래그로 고른 범위 강조는
        // 이미 정제된 트리 위에 마지막으로 얹는다 (0820_13 A3, A4).
        rehypePlugins={[
          rehypeRaw,
          rehypeSanitize,
          rehypeHighlight,
          [rehypeHighlightRanges, { ranges: highlightRanges }],
        ]}
        components={{ pre: CodeBlock, table: TableBlock }}
      >
        {displayed}
      </ReactMarkdown>
    </div>
  ) : null

  return (
    <div
      id={`block-${block.blockId}`}
      className={`group relative border-l-[3px] py-2.5 pl-5 pr-5 transition ${flash ? 'approve-flash' : ''} ${
        highlighted
            ? 'border-green bg-green-dim'
            : pending
              ? 'border-blue'
              : rejected
                ? 'border-line-strong'
                : 'border-transparent hover:bg-white/[0.025]'
      }`}
    >
      <div
        className={`flex w-full flex-col ${
          isUser ? 'ml-auto max-w-[min(85%,40rem)] items-end' : 'items-start'
        }`}
      >
        {(Boolean(block.versionNo && block.versionNo > 1) || isCancelled || isFailed) && (
          <div className={`mb-1.5 flex items-center gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
            {block.versionNo && block.versionNo > 1 && (
              <span className="rounded bg-bg-3 px-1.5 py-px text-[10px] text-txt-2">
                v{block.versionNo}
              </span>
            )}
            {isCancelled && (
              <span className="rounded bg-bg-3 px-1.5 py-px text-[10px] text-txt-2">
                중단됨
              </span>
            )}
            {isFailed && (
              <span className="rounded bg-red/10 px-1.5 py-px text-[10px] text-red">
                생성 실패
              </span>
            )}
          </div>
        )}

        {imageAttachments.length > 0 && (
          <ImagePreviewList chatId={chatId} attachments={imageAttachments} />
        )}

        {editing ? (
          <div className="w-full">
            <MessageEditForm
              draft={draft}
              busy={editBusy}
              tags={editingContextTags}
              onDraftChange={setEditingDraft}
              onRemoveTag={removeEditingContextTag}
              onCancel={cancelEdit}
              onSaveBranch={() => void createBranchAt(block.blockId)}
              onSave={() => saveEdit(block.blockId, draft)}
            />
          </div>
        ) : markdownBody ? (
          isUser ? (
            <div className="flex w-fit max-w-full flex-wrap items-baseline gap-x-1.5 gap-y-1 rounded-2xl bg-bg-3 px-3.5 py-2.5">
              {block.appliedContext && block.appliedContext.length > 0 && (
                <AppliedContextTagList items={block.appliedContext} />
              )}
              {markdownBody}
            </div>
          ) : (
            markdownBody
          )
        ) : isGenerating ? (
          <p className="animate-pulse text-[13px] text-txt-3">생각하는 중…</p>
        ) : null}

        {fileAttachments.length > 0 && <AttachmentList attachments={fileAttachments} />}
        {!isUser && block.searchSources.length > 0 && <SearchSourceList sources={block.searchSources} />}

        {isUser && failedJobId && <div className="mt-2 flex items-center gap-2 text-[11px] text-red"><span>답변 생성에 실패했습니다.</span><button type="button" disabled={isSending} onClick={() => void retryAiResponseJob(failedJobId)} className="rounded border border-red/40 px-1.5 py-0.5 hover:bg-red/10 disabled:opacity-40">다시 시도</button></div>}
        {!isUser && pendingAi && <div className="mt-2 text-[11px] text-txt-2">답변을 다시 생성하는 중…</div>}

        {pending && <div className="w-full"><InlineRefineBar result={refine} /></div>}

        {linkedSideChats && linkedSideChats.length > 0 && (
          <div className={`mt-1.5 flex flex-wrap gap-1.5 ${isUser ? 'flex-row-reverse' : ''}`}>
            {linkedSideChats.map((sideChat) => (
              <button
                key={sideChat.chatId}
                type="button"
                onClick={() => void openChatInSidePanel(sideChat.chatId)}
                title="사이드 채팅 열기"
                className="flex items-center gap-1 rounded-full border border-line bg-bg-2 px-2 py-0.5 text-[10.5px] text-txt-2 transition hover:bg-bg-3 hover:text-txt-0"
              >
                <Split className="h-2.5 w-2.5 text-green" />
                <span className="max-w-[140px] truncate">{sideChat.title}</span>
              </button>
            ))}
          </div>
        )}

        {!pending && (
          <MessageBlockActions
            block={block}
            isUser={isUser}
            isOwnBranch={isOwnBranch}
            eligibleForReuse={eligibleForReuse}
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
            onOpenSideChat={() => createSideChatTab(block.blockId)}
            onCreateBranch={() => createBranchAt(block.blockId)}
          />
        )}
      </div>

      {pendingSelection && (
        <SelectionActionToggle
          ref={toggleRef}
          style={pendingSelection.toggleStyle}
          onAddToChat={addPendingToChat}
          onAskInSideChat={askPendingInSideChat}
          onRefine={refinePendingSelection}
        />
      )}
    </div>
  )
}

// 정제 결과 검토 줄 — 원본/정제 전환과 승인·거절
function InlineRefineBar({ result }: { result: RefineResultItem }) {
  const view = useChatPaneStore((s) => s.inlineView[result.blockId] ?? 'refined')
  const setInlineView = useChatPaneStore((s) => s.setInlineView)
  const approve = useChatPaneStore((s) => s.approveResult)
  const reject = useChatPaneStore((s) => s.rejectResult)

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
// 표가 화면보다 넓으면 페이지 전체가 아니라 표 안에서만 가로로 스크롤되게 한다 (0821_01 C4)
function TableBlock(props: ComponentPropsWithoutRef<'table'>) {
  return (
    <div className="overflow-x-auto">
      <table {...props} />
    </div>
  )
}

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

// 메시지에 붙은 이미지 — 로그인 권한으로 원본을 받아 미리보기로 보여준다
function ImagePreviewList({
  chatId,
  attachments,
}: {
  chatId: string | null
  attachments: AttachmentResponse[]
}) {
  return (
    <div className="mb-2 flex w-fit max-w-full flex-wrap gap-2">
      {attachments.map((attachment) => (
        <AuthenticatedImage
          key={attachment.attachmentId}
          chatId={chatId}
          attachment={attachment}
        />
      ))}
    </div>
  )
}

function AuthenticatedImage({
  chatId,
  attachment,
}: {
  chatId: string | null
  attachment: AttachmentResponse
}) {
  const [src, setSrc] = useState(attachment.previewUrl ?? null)

  useEffect(() => {
    if (attachment.previewUrl) {
      setSrc(attachment.previewUrl)
      return
    }
    if (!chatId) return
    let cancelled = false
    let created: string | null = null
    void fetchAttachmentFile(chatId, attachment.attachmentId).then((url) => {
      if (cancelled) {
        URL.revokeObjectURL(url)
        return
      }
      created = url
      setSrc(url)
    }).catch(() => undefined)
    return () => {
      cancelled = true
      if (created) URL.revokeObjectURL(created)
    }
  }, [attachment.attachmentId, attachment.previewUrl, chatId])

  if (!src) {
    return <div className="h-40 w-56 animate-pulse rounded-2xl bg-bg-3" aria-hidden />
  }

  return (
    <img
      src={src}
      alt={attachment.fileName}
      className="max-h-72 max-w-full rounded-2xl object-contain"
    />
  )
}

// 전송 당시 인용한 Context 스니펫 — 채팅 내역에 영구적으로 남는 태그. 클릭하면 원문 위치로 이동해 강조한다
function AppliedContextTagList({ items }: { items: AppliedContextOut[] }) {
  const jumpToAppliedContext = useChatPaneStore((s) => s.jumpToAppliedContext)

  return (
    <>
      {items.map((item, index) => (
        <button
          key={index}
          type="button"
          onClick={() => jumpToAppliedContext?.(item)}
          title={`${item.content} (클릭하여 원문 보기)`}
          className="max-w-[220px] truncate rounded-full bg-blue-dim px-2.5 py-1 text-[11px] text-blue transition hover:bg-blue/25"
        >
          “{toTagPreview(item.content)}”
        </button>
      ))}
    </>
  )
}

// 메시지에 붙은 첨부 파일 이름 목록 (이미지가 아닌 파일, 읽기 전용)
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
