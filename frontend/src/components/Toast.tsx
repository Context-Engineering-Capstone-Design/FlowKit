import { X } from 'lucide-react'
import { useNotificationStore } from '@/store/notificationStore'
// 앱 전체 성공·정보·오류 안내를 잠시 보여주는 토스트
export function Toast() { const message = useNotificationStore((s) => s.message); const kind = useNotificationStore((s) => s.kind); const clear = useNotificationStore((s) => s.clear); if (!message) return null; return <div role="status" className={`fixed bottom-5 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-3 rounded-lg px-3 py-2 text-[12px] shadow-xl ${kind === 'error' ? 'bg-red text-white' : kind === 'success' ? 'bg-green text-white' : 'bg-bg-3 text-txt-0'}`}><span>{message}</span><button type="button" onClick={clear} aria-label="알림 닫기"><X className="h-3.5 w-3.5" /></button></div> }
