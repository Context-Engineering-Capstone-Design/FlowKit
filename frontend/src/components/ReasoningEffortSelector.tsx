import { ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
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

const LAST = OPTIONS.length - 1

function stepCenter(step: number) {
  return ((step + 0.5) / OPTIONS.length) * 100
}

// 답변에 사용할 추론 단계를 입력창에서 고르는 슬라이더
export function ReasoningEffortSelector({ value, onChange }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const holderRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const selected = OPTIONS.find((option) => option.value === value) ?? OPTIONS[1]
  const index = Math.max(0, OPTIONS.findIndex((option) => option.value === selected.value))
  const thumbPercent = stepCenter(index)
  const fillPercent = index === LAST ? 100 : thumbPercent

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

  function pickFromX(clientX: number) {
    const track = trackRef.current
    if (!track) return
    const rect = track.getBoundingClientRect()
    const ratio = (clientX - rect.left) / Math.max(rect.width, 1)
    const next = Math.min(LAST, Math.max(0, Math.floor(ratio * OPTIONS.length)))
    onChange(OPTIONS[next].value)
  }

  function startDrag(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(true)
    pickFromX(event.clientX)
    function move(moveEvent: PointerEvent) {
      pickFromX(moveEvent.clientX)
    }
    function end() {
      setDragging(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
  }

  function moveByKey(event: React.KeyboardEvent) {
    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault()
      onChange(OPTIONS[index - 1].value)
    }
    if (event.key === 'ArrowRight' && index < LAST) {
      event.preventDefault()
      onChange(OPTIONS[index + 1].value)
    }
    if (event.key === 'Home') {
      event.preventDefault()
      onChange(OPTIONS[0].value)
    }
    if (event.key === 'End') {
      event.preventDefault()
      onChange(OPTIONS[LAST].value)
    }
  }

  return (
    <div ref={holderRef} className="relative">
      {isOpen && (
        <div className="absolute bottom-full left-0 z-40 mb-2 w-[252px] rounded-2xl border border-line bg-bg-2 px-4 py-3 shadow-2xl shadow-black/40">
          <div
            ref={trackRef}
            role="slider"
            tabIndex={0}
            aria-label="추론 수준"
            aria-valuemin={0}
            aria-valuemax={LAST}
            aria-valuenow={index}
            aria-valuetext={selected.label}
            onPointerDown={startDrag}
            onKeyDown={moveByKey}
            className="relative h-5 cursor-pointer touch-none outline-none"
          >
            <div className="absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2 rounded-full bg-bg-3" />
            <div
              className={`absolute top-1/2 left-0 h-2.5 -translate-y-1/2 rounded-full bg-blue ${
                dragging ? '' : 'transition-[width] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none'
              }`}
              style={{ width: `${fillPercent}%` }}
            />
            {OPTIONS.map((option, step) => (
              <span
                key={option.value}
                className="pointer-events-none absolute top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/35"
                style={{ left: `${stepCenter(step)}%` }}
              />
            ))}
            <span
              className={`pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow ${
                dragging ? '' : 'transition-[left] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none'
              }`}
              style={{ left: `${thumbPercent}%` }}
            />
          </div>
        </div>
      )}

      <button
        type="button"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={`추론 ${selected.label}`}
        onClick={() => setIsOpen((open) => !open)}
        className="flex items-center gap-0.5 rounded-full px-2 py-1 text-[11px] text-txt-1 transition hover:bg-bg-3"
      >
        {selected.label}
        <ChevronDown className={`h-3 w-3 text-txt-2 transition ${isOpen ? 'rotate-180' : ''}`} />
      </button>
    </div>
  )
}
