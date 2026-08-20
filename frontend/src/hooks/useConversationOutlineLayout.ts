import { useEffect, useRef, useState, type RefObject } from 'react'
import type { ConversationOutlineTurn } from '@/lib/conversationOutline'

export interface OutlinePosition {
  turnId: string
  /** 대화 영역 스크롤 높이 대비 세로 위치 비율 (0~1) */
  topRatio: number
}

interface OutlineLayout {
  visible: boolean
  positions: OutlinePosition[]
  activeTurnId: string | null
}

const OVERFLOW_TOLERANCE_PX = 4
const EMPTY_LAYOUT: OutlineLayout = { visible: false, positions: [], activeTurnId: null }

/** 대화 영역 스크롤 상태를 관찰해 목차 레일의 점 위치와 현재 읽는 턴을 계산한다. */
export function useConversationOutlineLayout(
  containerRef: RefObject<HTMLDivElement | null>,
  contentRef: RefObject<HTMLDivElement | null>,
  turns: ConversationOutlineTurn[],
): OutlineLayout {
  const [layout, setLayout] = useState<OutlineLayout>(EMPTY_LAYOUT)
  const turnsRef = useRef(turns)
  turnsRef.current = turns
  const recomputeRef = useRef<() => void>(() => {})

  useEffect(() => {
    const container = containerRef.current
    const content = contentRef.current
    if (!container || !content) return

    function recompute() {
      const el = containerRef.current
      if (!el) return
      const overflowing = el.scrollHeight - el.clientHeight > OVERFLOW_TOLERANCE_PX
      if (!overflowing) {
        setLayout((prev) => (prev.visible ? EMPTY_LAYOUT : prev))
        return
      }

      const containerRect = el.getBoundingClientRect()
      const positions: OutlinePosition[] = []
      let activeTurnId: string | null = null
      for (const turn of turnsRef.current) {
        const target = document.getElementById(`block-${turn.questionBlockId}`)
        if (!target) continue
        const relativeTop = target.getBoundingClientRect().top - containerRect.top + el.scrollTop
        positions.push({ turnId: turn.turnId, topRatio: Math.min(1, Math.max(0, relativeTop / el.scrollHeight)) })
        if (relativeTop <= el.scrollTop + OVERFLOW_TOLERANCE_PX) activeTurnId = turn.turnId
      }
      setLayout({ visible: true, positions, activeTurnId: activeTurnId ?? turnsRef.current[0]?.turnId ?? null })
    }
    recomputeRef.current = recompute

    let frame: number | null = null
    function schedule() {
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        recompute()
      })
    }

    recompute()
    container.addEventListener('scroll', schedule, { passive: true })
    // 콘텐츠 높이(content) 변화(스트리밍·블록 추가)와 뷰포트 높이(container) 변화를 모두 관찰한다.
    const resizeObserver = new ResizeObserver(schedule)
    resizeObserver.observe(container)
    resizeObserver.observe(content)
    window.addEventListener('resize', schedule)

    return () => {
      container.removeEventListener('scroll', schedule)
      resizeObserver.disconnect()
      window.removeEventListener('resize', schedule)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [containerRef, contentRef])

  useEffect(() => {
    recomputeRef.current()
  }, [turns])

  return layout
}
