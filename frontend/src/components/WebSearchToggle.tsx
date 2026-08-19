import { Search } from 'lucide-react'

interface Props { enabled: boolean; disabled: boolean; reason?: string; onChange: (enabled: boolean) => void }

// 웹 검색 사용 여부를 보여주고 바꾸는 토글
export function WebSearchToggle({ enabled, disabled, reason, onChange }: Props) {
  return <button type="button" disabled={disabled} title={reason} onClick={() => onChange(!enabled)} className={`flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] transition ${enabled ? 'bg-blue-dim text-blue' : 'text-txt-2 hover:bg-bg-3'} disabled:cursor-not-allowed disabled:opacity-40`}>
    <Search className="h-3.5 w-3.5" />웹 검색
  </button>
}
