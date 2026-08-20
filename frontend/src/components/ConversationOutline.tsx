import { useState, type RefObject } from 'react'
import { useConversationOutlineLayout } from '@/hooks/useConversationOutlineLayout'
import type { ConversationOutlineTurn } from '@/lib/conversationOutline'

interface Props {
  containerRef: RefObject<HTMLDivElement | null>
  contentRef: RefObject<HTMLDivElement | null>
  turns: ConversationOutlineTurn[]
}

const SEGMENT_MIN_WIDTH_PX = 4
const SEGMENT_NEAR_WIDTH_PX = 10
const SEGMENT_MID_WIDTH_PX = 16
const SEGMENT_MAX_WIDTH_PX = 24

/** 호버·포커스 중심과의 거리에 따라 선분 너비를 계산한다. 상·하 2칸까지 점진적으로 길어진다. */
function getSegmentWidth(index: number, focusIndex: number | null): number {
  if (focusIndex === null) return SEGMENT_MIN_WIDTH_PX
  const distance = Math.abs(index - focusIndex)
  if (distance === 0) return SEGMENT_MAX_WIDTH_PX
  if (distance === 1) return SEGMENT_MID_WIDTH_PX
  if (distance === 2) return SEGMENT_NEAR_WIDTH_PX
  return SEGMENT_MIN_WIDTH_PX
}

// 긴 대화의 스크롤 영역 가장자리에 붙는 얇은 목차 레일 — 항목을 누르면 해당 질문으로 이동한다
export function ConversationOutline({ containerRef, contentRef, turns }: Props) {
  const { visible, positions, activeTurnId } = useConversationOutlineLayout(containerRef, contentRef, turns)
  const [hoveredTurnId, setHoveredTurnId] = useState<string | null>(null)
  const [focusedTurnId, setFocusedTurnId] = useState<string | null>(null)

  if (!visible || positions.length === 0) return null

  const highlightTurnId = hoveredTurnId ?? focusedTurnId ?? activeTurnId
  const fisheyeTurnId = hoveredTurnId ?? focusedTurnId
  const fisheyeIndex =
    fisheyeTurnId === null ? null : positions.findIndex((pos) => pos.turnId === fisheyeTurnId)

  const popupTurnId = hoveredTurnId ?? focusedTurnId

  function moveToTurn(questionBlockId: string) {
    document.getElementById(`block-${questionBlockId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <nav aria-label="대화 목차" className="absolute inset-y-3 left-1.5 z-10 hidden w-8 lg:block">
      <div className="relative flex h-full flex-col justify-center gap-px">
        {positions.map((pos, index) => {
          const turn = turns.find((item) => item.turnId === pos.turnId)
          if (!turn) return null
          const highlighted = turn.turnId === highlightTurnId
          const showPopup = turn.turnId === popupTurnId
          const width = getSegmentWidth(index, fisheyeIndex)
          return (
            <button
              key={turn.turnId}
              type="button"
              onClick={() => moveToTurn(turn.questionBlockId)}
              onMouseEnter={() => setHoveredTurnId(turn.turnId)}
              onMouseLeave={() => setHoveredTurnId((id) => (id === turn.turnId ? null : id))}
              onFocus={() => setFocusedTurnId(turn.turnId)}
              onBlur={() => setFocusedTurnId((id) => (id === turn.turnId ? null : id))}
              aria-label={turn.questionTitle}
              className="relative flex h-2.5 w-full shrink-0 items-center"
            >
              <span
                style={{ width: `${width}px` }}
                className={`h-0.5 shrink-0 rounded-full transition-[width,background-color] duration-300 ease-out ${
                  highlighted ? 'bg-txt-0' : 'bg-txt-2/35'
                }`}
              />
              {showPopup && <OutlinePopup turn={turn} />}
            </button>
          )
        })}
      </div>
    </nav>
  )
}

// 목차 항목 위에 마우스를 올리거나 포커스했을 때 보여주는 미리보기 카드
function OutlinePopup({ turn }: { turn: ConversationOutlineTurn }) {
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute left-full top-1/2 z-20 ml-3 w-56 -translate-y-1/2 rounded-lg border border-line bg-bg-2 p-2.5 text-left shadow-lg"
    >
      <p className="truncate text-[12px] font-semibold text-txt-0">{turn.questionTitle}</p>
      {turn.answerPreview && (
        <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-txt-2">{turn.answerPreview}</p>
      )}
    </div>
  )
}
