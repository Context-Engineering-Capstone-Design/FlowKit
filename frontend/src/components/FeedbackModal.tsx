import { useEffect, useMemo, useRef, useState } from 'react'
import { submitFeedback } from '@/api/feedback'
import { errorCode, toErrorMessage } from '@/api/client'
import { withRequestTimeout } from '@/lib/requestTimeout'
import { useChatStore } from '@/store/chatStore'
import { useNotificationStore } from '@/store/notificationStore'
import type {
  ServiceFeedbackContext,
  ServiceFeedbackType,
} from '@/types/api'

const MAX_CONTENT_LENGTH = 2_000

interface FeedbackModalProps {
  onClose: () => void
  contextInfo?: ServiceFeedbackContext
}

// 사용자가 오류와 개선 의견을 안전한 화면 문맥과 함께 보내는 입력 창
export function FeedbackModal({ onClose, contextInfo }: FeedbackModalProps) {
  const chatId = useChatStore((state) => state.chatId)
  const branchId = useChatStore((state) => state.branchId)
  const showToast = useNotificationStore((state) => state.showToast)
  const showAction = useNotificationStore((state) => state.showAction)
  const showError = useNotificationStore((state) => state.showError)
  const dismissBanner = useNotificationStore((state) => state.dismissBanner)
  const [type, setType] = useState<ServiceFeedbackType>('usability')
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [validationMessage, setValidationMessage] = useState<string | null>(null)
  const latestRequestId = useRef<string | null>(null)

  const safeContext = useMemo<ServiceFeedbackContext>(
    () => ({
      page: contextInfo?.page ?? window.location.pathname,
      chatId: contextInfo?.chatId ?? chatId ?? undefined,
      branchId: contextInfo?.branchId ?? branchId ?? undefined,
    }),
    [branchId, chatId, contextInfo],
  )

  useEffect(() => {
    function closeFromEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', closeFromEscape)
    return () => document.removeEventListener('keydown', closeFromEscape)
  }, [busy, onClose])

  async function send() {
    if (busy) return
    const trimmed = content.trim()
    if (!trimmed) {
      setValidationMessage('피드백 내용을 입력해주세요.')
      return
    }
    if (trimmed.length > MAX_CONTENT_LENGTH) {
      setValidationMessage('피드백은 2,000자까지 입력할 수 있습니다.')
      return
    }

    setBusy(true)
    setValidationMessage(null)
    let requestId: string | null = null
    try {
      const result = await withRequestTimeout(async ({ signal, requestId: id }) => {
        requestId = id
        latestRequestId.current = id
        return submitFeedback(type, trimmed, safeContext, signal)
      })
      if (latestRequestId.current !== requestId) return
      dismissBanner('feedback')
      setType('usability')
      setContent('')
      if (result.actionMeta) showAction(result.actionMeta)
      else showToast({ message: '피드백을 제출했습니다.', kind: 'success' })
      onClose()
    } catch (error) {
      if (requestId && latestRequestId.current !== requestId) return
      const message = toErrorMessage(error)
      setValidationMessage(message)
      showError(error, {
        message,
        scope: 'feedback',
        action:
          errorCode(error) === 'REQUEST_TIMEOUT'
            ? { label: '다시 시도', run: () => void send() }
            : undefined,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-title"
        className="w-full max-w-md rounded-xl border border-line bg-bg-1 p-5 shadow-2xl shadow-black/40"
      >
        <h2 id="feedback-title" className="text-[14px] font-semibold">
          피드백 남기기
        </h2>
        <label className="mt-4 block text-[11px] text-txt-2" htmlFor="feedback-type">
          유형
        </label>
        <select
          id="feedback-type"
          value={type}
          disabled={busy}
          onChange={(event) => setType(event.target.value as ServiceFeedbackType)}
          className="mt-1.5 w-full rounded-lg border border-line bg-bg-2 p-2 text-[12px] outline-none focus:border-blue disabled:opacity-50"
        >
          <option value="error">오류</option>
          <option value="usability">사용성 불편</option>
          <option value="context">Context 편집 문제</option>
          <option value="branch">브랜치 기능 문제</option>
          <option value="other">기타</option>
        </select>
        <label className="mt-3 block text-[11px] text-txt-2" htmlFor="feedback-content">
          내용
        </label>
        <textarea
          id="feedback-content"
          value={content}
          maxLength={MAX_CONTENT_LENGTH}
          disabled={busy}
          onChange={(event) => {
            setContent(event.target.value)
            if (validationMessage) setValidationMessage(null)
          }}
          placeholder="의견을 입력하세요"
          aria-describedby="feedback-help feedback-error"
          aria-invalid={Boolean(validationMessage)}
          className="mt-1.5 min-h-28 w-full resize-y rounded-lg border border-line bg-bg-2 p-2 text-[13px] outline-none placeholder:text-txt-3 focus:border-blue disabled:opacity-50"
        />
        <div id="feedback-help" className="mt-1 flex justify-between text-[10.5px] text-txt-3">
          <span>메시지와 Context 본문은 자동으로 첨부하지 않습니다.</span>
          <span>{content.length.toLocaleString()} / 2,000</span>
        </div>
        {validationMessage && (
          <p id="feedback-error" role="alert" className="mt-2 text-[11px] text-red">
            {validationMessage}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-3 py-2 text-[12px] text-txt-2 disabled:opacity-40"
          >
            취소
          </button>
          <button
            type="button"
            disabled={!content.trim() || busy}
            onClick={() => void send()}
            className="rounded bg-blue px-3 py-2 text-[12px] text-white disabled:opacity-40"
          >
            {busy ? '제출 중…' : '제출'}
          </button>
        </div>
      </div>
    </div>
  )
}
