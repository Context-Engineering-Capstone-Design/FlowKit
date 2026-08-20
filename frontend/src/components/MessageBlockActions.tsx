import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Pencil,
  RotateCw,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react'
import { useNotificationStore } from '@/store/notificationStore'
import type { AiResponseRating, MessageBlock, VersionItem } from '@/types/api'

type ActionResult = void | Promise<unknown>

interface Props {
  block: MessageBlock
  isUser: boolean
  isOwnBranch: boolean
  /** 생성 중·중단됨·실패한 답변은 Context·분기 어디에도 쓸 수 없다 (D밀스톤). */
  eligibleForReuse: boolean
  pendingAi?: boolean
  editing: boolean
  rating?: AiResponseRating
  versions?: VersionItem[]
  currentVersionIndex: number
  onSetActiveVersion: (versionId: string) => ActionResult
  onSetFeedback: (rating: AiResponseRating) => ActionResult
  onRegenerate: () => ActionResult
  onStartEdit: () => ActionResult
  onOpenContextEditor: () => ActionResult
  onOpenBranch: () => ActionResult
}

// 메시지의 버전 이동, 평가, 복사, 수정, Context 편집, 분기 동작을 모아 보여준다
export function MessageBlockActions({
  block,
  isUser,
  isOwnBranch,
  eligibleForReuse,
  pendingAi,
  editing,
  rating,
  versions,
  currentVersionIndex,
  onSetActiveVersion,
  onSetFeedback,
  onRegenerate,
  onStartEdit,
  onOpenContextEditor,
  onOpenBranch,
}: Props) {
  const showNotification = useNotificationStore((state) => state.show)

  async function copyContent() {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard API unavailable')
      await navigator.clipboard.writeText(block.content)
      showNotification('메시지를 복사했습니다.', 'success')
    } catch {
      showNotification('메시지를 복사하지 못했습니다.', 'error')
    }
  }

  return (
    <div
      role="toolbar"
      aria-label="메시지 동작"
      className="mt-2 flex gap-1 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
    >
      {versions && versions.length > 1 && currentVersionIndex >= 0 && (
        <div className="mr-1 flex items-center rounded border border-line text-[10px] text-txt-2">
          <button
            type="button"
            disabled={currentVersionIndex === 0}
            onClick={() =>
              void onSetActiveVersion(
                versions[currentVersionIndex - 1].versionId,
              )
            }
            title="이전 버전"
            aria-label="이전 버전"
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
            onClick={() =>
              void onSetActiveVersion(
                versions[currentVersionIndex + 1].versionId,
              )
            }
            title="다음 버전"
            aria-label="다음 버전"
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
            onClick={() => void onSetFeedback('like')}
            title="좋아요"
            aria-label="좋아요"
            aria-pressed={rating === 'like'}
            className={`rounded p-1 transition hover:bg-bg-3 ${
              rating === 'like'
                ? 'bg-blue-dim text-blue'
                : 'text-txt-3 hover:text-txt-1'
            }`}
          >
            <ThumbsUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void onSetFeedback('dislike')}
            title="싫어요"
            aria-label="싫어요"
            aria-pressed={rating === 'dislike'}
            className={`rounded p-1 transition hover:bg-bg-3 ${
              rating === 'dislike'
                ? 'bg-blue-dim text-blue'
                : 'text-txt-3 hover:text-txt-1'
            }`}
          >
            <ThumbsDown className="h-3.5 w-3.5" />
          </button>
          {isOwnBranch && eligibleForReuse && (
            <button
              type="button"
              onClick={() => void onRegenerate()}
              disabled={pendingAi}
              title="답변 다시 시도"
              aria-label="답변 다시 시도"
              className="rounded p-1 text-txt-3 transition hover:bg-bg-3 hover:text-txt-1 disabled:opacity-40"
            >
              <RotateCw className="h-3.5 w-3.5" />
            </button>
          )}
        </>
      )}

      <button
        type="button"
        onClick={() => void copyContent()}
        title="복사"
        aria-label="메시지 복사"
        className="rounded p-1 text-txt-3 transition hover:bg-bg-3 hover:text-txt-1"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
      {!editing && (
        <button
          type="button"
          onClick={() => void onStartEdit()}
          title="수정"
          aria-label="메시지 수정"
          className="rounded p-1 text-txt-3 transition hover:bg-bg-3 hover:text-txt-1"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
      {eligibleForReuse && (
        <button
          type="button"
          onClick={() => void onOpenContextEditor()}
          title="Context 편집 시작"
          aria-label="Context 편집 시작"
          className="rounded px-1 text-[10px] text-txt-3 transition hover:bg-bg-3 hover:text-txt-1"
        >
          Context
        </button>
      )}
      {eligibleForReuse && (
        <button
          type="button"
          onClick={() => void onOpenBranch()}
          title="여기서 브랜치 생성"
          aria-label="여기서 브랜치 생성"
          className="rounded px-1 text-[10px] text-txt-3 transition hover:bg-bg-3 hover:text-txt-1"
        >
          분기
        </button>
      )}
    </div>
  )
}
