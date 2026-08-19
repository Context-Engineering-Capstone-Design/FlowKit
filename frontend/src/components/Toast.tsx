import { X } from 'lucide-react'
import { ErrorBanner } from '@/components/ErrorBanner'
import {
  useNotificationStore,
  type NoticeKind,
} from '@/store/notificationStore'

const KIND_STYLE: Record<NoticeKind, string> = {
  error: 'bg-red text-white',
  success: 'bg-green text-white',
  warning: 'bg-orange text-bg-0',
  info: 'bg-bg-3 text-txt-0',
}

// 앱 전체 성공·정보·주의 결과를 잠시 보여주고 복구가 필요한 오류 배너도 함께 배치한다
export function Toast() {
  const toast = useNotificationStore((state) => state.toast)
  const clearToast = useNotificationStore((state) => state.clearToast)
  const pauseToast = useNotificationStore((state) => state.pauseToast)
  const resumeToast = useNotificationStore((state) => state.resumeToast)

  function runAction() {
    const action = toast?.action
    clearToast()
    action?.run()
  }

  return (
    <>
      <ErrorBanner />
      {toast && (
        <div
          role={toast.kind === 'error' ? 'alert' : 'status'}
          aria-live={toast.kind === 'error' ? 'assertive' : 'polite'}
          onMouseEnter={() => pauseToast('hover')}
          onMouseLeave={() => resumeToast('hover')}
          onFocusCapture={() => pauseToast('focus')}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              resumeToast('focus')
            }
          }}
          className={`fixed bottom-5 left-1/2 z-[70] flex max-w-[min(92vw,560px)] -translate-x-1/2 items-center gap-3 rounded-lg px-3 py-2 text-[12px] shadow-xl ${KIND_STYLE[toast.kind]}`}
        >
          <span className="min-w-0 flex-1">{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              onClick={runAction}
              className="shrink-0 rounded border border-current/30 px-2 py-1 text-[11px] font-semibold hover:bg-white/10"
            >
              {toast.action.label}
            </button>
          )}
          <button
            type="button"
            onClick={clearToast}
            aria-label="알림 닫기"
            className="shrink-0 rounded p-0.5 hover:bg-white/10"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </>
  )
}
