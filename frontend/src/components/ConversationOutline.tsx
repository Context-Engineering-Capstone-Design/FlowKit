import { useState, type RefObject } from 'react'
import { useConversationOutlineLayout } from '@/hooks/useConversationOutlineLayout'
import type { ConversationOutlineTurn } from '@/lib/conversationOutline'

interface Props {
  containerRef: RefObject<HTMLDivElement | null>
  contentRef: RefObject<HTMLDivElement | null>
  turns: ConversationOutlineTurn[]
}

// 긴 대화의 스크롤 영역 가장자리에 붙는 얇은 목차 레일 — 항목을 누르면 해당 질문으로 이동한다
export function ConversationOutline({ containerRef, contentRef, turns }: Props) {
  const { visible, positions, activeTurnId } = useConversationOutlineLayout(containerRef, contentRef, turns)
  const [hoveredTurnId, setHoveredTurnId] = useState<string | null>(null)
  const [focusedTurnId, setFocusedTurnId] = useState<string | null>(null)

  if (!visible || positions.length === 0) return null

  const popupTurnId = hoveredTurnId ?? focusedTurnId
  const popupTurn = turns.find((turn) => turn.turnId === popupTurnId) ?? null
  const popupPosition = popupTurn ? positions.find((pos) => pos.turnId === popupTurn.turnId) : undefined

  function moveToTurn(questionBlockId: string) {
    document.getElementById(`block-${questionBlockId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <nav aria-label="대화 목차" className="absolute inset-y-3 right-1.5 z-10 hidden w-3 lg:block">
      <div className="relative h-full">
        {positions.map((pos) => {
          const turn = turns.find((item) => item.turnId === pos.turnId)
          if (!turn) return null
          const active = turn.turnId === activeTurnId
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
              style={{ top: `${pos.topRatio * 100}%` }}
              className={`absolute left-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition ${
                active ? 'bg-blue' : 'bg-line-strong hover:bg-txt-2'
              }`}
            />
          )
        })}
      </div>
      {popupTurn && <OutlinePopup turn={popupTurn} topRatio={popupPosition?.topRatio ?? 0} />}
    </nav>
  )
}

// 목차 항목 위에 마우스를 올리거나 포커스했을 때 보여주는 미리보기 카드
function OutlinePopup({ turn, topRatio }: { turn: ConversationOutlineTurn; topRatio: number }) {
  // 팝업 자체 높이만큼 화면 위아래로 넘칠 수 있어, 점 위치를 안전한 범위로 좁혀서 배치한다.
  const safeRatio = Math.min(0.9, Math.max(0.1, topRatio))
  return (
    <div
      role="tooltip"
      style={{ top: `${safeRatio * 100}%` }}
      className="pointer-events-none absolute right-full top-0 mr-2 w-56 -translate-y-1/2 rounded-lg border border-line bg-bg-2 p-2.5 text-left shadow-lg"
    >
      <p className="truncate text-[12px] font-semibold text-txt-0">{turn.questionTitle}</p>
      {turn.answerPreview && (
        <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-txt-2">{turn.answerPreview}</p>
      )}
    </div>
  )
}
