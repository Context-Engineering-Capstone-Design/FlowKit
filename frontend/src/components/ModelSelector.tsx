import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ModelOption } from '@/types/api'

interface Props {
  models: ModelOption[]
  selectedId: string | null
  loading: boolean
  onChange: (id: string) => void
}

// 색만으로 구분하는 용도라 의미를 담지 않는다. 순서대로 돌려 쓴다.
const DOT_COLORS = ['bg-blue', 'bg-green', 'bg-orange', 'bg-red']

// 답변에 쓸 모델을 고르는 선택 상자 — 색 점·설명·태그로 모델을 구분해 보여준다
export function ModelSelector({ models, selectedId, loading, onChange }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const holderRef = useRef<HTMLDivElement>(null)
  const selected = models.find((m) => m.modelId === selectedId) ?? models[0]

  useEffect(() => {
    if (!isOpen) return

    function closeFromOutside(event: PointerEvent) {
      if (!holderRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    function closeFromEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('pointerdown', closeFromOutside)
    document.addEventListener('keydown', closeFromEscape)
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside)
      document.removeEventListener('keydown', closeFromEscape)
    }
  }, [isOpen])

  return (
    <div ref={holderRef} className="relative">
      {isOpen && (
        <div
          role="listbox"
          aria-label="모델 선택"
          className="absolute bottom-full left-0 z-40 mb-2 w-64 overflow-hidden rounded-xl border border-line bg-bg-2 p-1.5 shadow-2xl shadow-black/40"
        >
          {models.map((model, index) => {
            const active = model.modelId === selected?.modelId
            return (
              <button
                key={model.modelId}
                type="button"
                role="option"
                aria-selected={active}
                disabled={!model.isAvailable}
                onClick={() => {
                  onChange(model.modelId)
                  setIsOpen(false)
                }}
                className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition hover:bg-bg-3 disabled:cursor-default disabled:opacity-40"
              >
                <span
                  className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${DOT_COLORS[index % DOT_COLORS.length]}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[12.5px] font-medium text-txt-0">
                      {model.displayName}
                    </span>
                    {model.isDefault && (
                      <span className="shrink-0 text-[10px] text-txt-3">기본</span>
                    )}
                  </span>
                  {model.description && (
                    <span className="mt-0.5 block text-[11px] leading-snug text-txt-2">
                      {model.description}
                    </span>
                  )}
                  {model.tags.length > 0 && (
                    <span className="mt-1 flex flex-wrap gap-1">
                      {model.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full bg-bg-3 px-1.5 py-px text-[10px] text-txt-2"
                        >
                          {tag}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
                {active && <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-blue" />}
              </button>
            )
          })}
        </div>
      )}

      <button
        type="button"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        disabled={loading || models.length === 0}
        onClick={() => setIsOpen((open) => !open)}
        className="flex min-w-0 max-w-44 items-center gap-1.5 rounded px-1 py-0.5 text-[11px] text-txt-2 transition hover:bg-bg-3 disabled:opacity-50"
      >
        {selected && (
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_COLORS[models.indexOf(selected) % DOT_COLORS.length]}`}
          />
        )}
        <span className="truncate text-[11px] text-txt-1">
          {selected ? `${selected.displayName}${selected.isDefault ? ' · 기본' : ''}` : '모델 없음'}
        </span>
        <ChevronDown className="h-3 w-3 shrink-0" />
      </button>
    </div>
  )
}
