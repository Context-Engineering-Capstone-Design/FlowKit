import { ChevronDown } from 'lucide-react'
import type { ModelOption } from '@/types/api'

interface Props { models: ModelOption[]; selectedId: string | null; loading: boolean; onChange: (id: string) => void }

// 서버 모델 목록에서 이번 답변에 쓸 모델을 고르는 선택 상자
export function ModelSelector({ models, selectedId, loading, onChange }: Props) {
  return <label className="flex min-w-0 items-center gap-1 text-[11px] text-txt-2">
    <select value={selectedId ?? ''} disabled={loading || models.length === 0} onChange={(e) => onChange(e.target.value)} className="max-w-44 appearance-none bg-transparent pr-1 text-[11px] text-txt-1 outline-none disabled:opacity-50">
      {models.map((model) => <option key={model.modelId} value={model.modelId} disabled={!model.isAvailable}>{model.displayName}{model.isDefault ? ' · 기본' : ''}</option>)}
    </select>
    <ChevronDown className="h-3 w-3" />
  </label>
}
