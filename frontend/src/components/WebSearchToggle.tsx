import { Check, ChevronDown, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { WebSearchMode } from '@/types/api'

interface Props { mode: WebSearchMode; disabled: boolean; reason?: string; onChange: (mode: WebSearchMode) => void }

const OPTIONS: { mode: WebSearchMode; label: string; description: string }[] = [
  { mode: 'auto', label: '자동', description: '모델이 필요하다고 판단할 때만 검색한다' },
  { mode: 'always', label: '항상', description: '질문마다 반드시 검색하고 답한다' },
  { mode: 'off', label: '끄기', description: '검색을 쓰지 않는다' },
]

// 웹 검색을 자동/항상/끄기 세 상태로 고르는 선택 상자 (AI-SEARCH-001)
export function WebSearchToggle({ mode, disabled, reason, onChange }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const holderRef = useRef<HTMLDivElement>(null)
  const current = OPTIONS.find((o) => o.mode === mode) ?? OPTIONS[2]

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
          aria-label="웹 검색"
          className="absolute bottom-full left-0 z-40 mb-2 w-56 overflow-hidden rounded-xl border border-line bg-bg-2 p-1.5 shadow-2xl shadow-black/40"
        >
          {OPTIONS.map((option) => {
            const active = option.mode === mode
            return (
              <button
                key={option.mode}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(option.mode)
                  setIsOpen(false)
                }}
                className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition hover:bg-bg-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="text-[12.5px] font-medium text-txt-0">{option.label}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-txt-2">
                    {option.description}
                  </span>
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
        disabled={disabled}
        title={reason}
        onClick={() => setIsOpen((open) => !open)}
        className={`flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] transition ${
          mode === 'off' ? 'text-txt-2 hover:bg-bg-3' : 'bg-blue-dim text-blue'
        } disabled:cursor-not-allowed disabled:opacity-40`}
      >
        <Search className="h-3.5 w-3.5" />
        웹 검색 · {current.label}
        <ChevronDown className="h-3 w-3" />
      </button>
    </div>
  )
}
