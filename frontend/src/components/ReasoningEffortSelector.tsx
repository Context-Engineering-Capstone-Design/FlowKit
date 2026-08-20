import type { ReasoningEffort } from '@/types/api'

interface Props {
  value: ReasoningEffort
  onChange: (value: ReasoningEffort) => void
}

const OPTIONS: { value: ReasoningEffort; label: string }[] = [
  { value: 'low', label: '낮음' },
  { value: 'medium', label: '중간' },
  { value: 'high', label: '높음' },
  { value: 'xhigh', label: '매우 높음' },
  { value: 'max', label: '최대' },
]

// 답변에 사용할 추론 단계를 입력창에서 선택하는 메뉴
export function ReasoningEffortSelector({ value, onChange }: Props) {
  return (
    <label className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-txt-2">
      <span>추론</span>
      <select value={value} onChange={(event) => onChange(event.target.value as ReasoningEffort)} className="bg-transparent text-[11px] text-txt-1 outline-none">
        {OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  )
}
