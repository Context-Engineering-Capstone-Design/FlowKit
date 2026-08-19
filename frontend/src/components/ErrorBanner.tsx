import { AlertCircle, X } from 'lucide-react'
import { useNotificationStore } from '@/store/notificationStore'

// 복구가 필요한 오류와 바로 실행할 수 있는 조치를 화면 위쪽에 보여준다
export function ErrorBanner() {
  const banner = useNotificationStore((state) => state.banner)
  const dismiss = useNotificationStore((state) => state.dismissBanner)

  if (!banner) return null

  return (
    <div
      role="alert"
      className="fixed left-1/2 top-4 z-[75] flex w-[min(92vw,640px)] -translate-x-1/2 items-start gap-3 rounded-xl border border-red/40 bg-bg-1 px-4 py-3 shadow-2xl shadow-black/40"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red" />
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] text-txt-0">{banner.message}</p>
        {banner.details.length > 0 && (
          <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[11px] text-txt-1">
            {banner.details.map((detail, index) => (
              <li key={`${index}-${detail}`}>{detail}</li>
            ))}
          </ul>
        )}
        {banner.traceId && (
          <p className="mt-1 truncate text-[10.5px] text-txt-3">
            추적 ID: {banner.traceId}
          </p>
        )}
      </div>
      {banner.action && (
        <button
          type="button"
          onClick={banner.action.run}
          className="shrink-0 rounded-md bg-red/15 px-2.5 py-1.5 text-[11px] font-medium text-red transition hover:bg-red/25"
        >
          {banner.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => dismiss()}
        aria-label="오류 안내 닫기"
        className="shrink-0 rounded p-1 text-txt-2 transition hover:bg-bg-3 hover:text-txt-0"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
