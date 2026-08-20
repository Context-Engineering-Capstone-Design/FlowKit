import { MessageSquarePlus, Sparkles, Split } from 'lucide-react'
import { forwardRef, type CSSProperties } from 'react'

interface Props {
  style: CSSProperties
  onAddToChat: () => void
  onAskInSideChat: () => void
  onRefine: () => void
}

// 메시지 안에서 텍스트를 드래그하면 선택 범위 옆에 뜨는 작업 토글 (0820_13 A3)
export const SelectionActionToggle = forwardRef<HTMLDivElement, Props>(function SelectionActionToggle(
  { style, onAddToChat, onAskInSideChat, onRefine },
  ref,
) {
  return (
    <div
      ref={ref}
      role="menu"
      aria-label="선택한 범위로 할 작업"
      style={style}
      className="fixed z-30 flex items-center gap-1 rounded-lg border border-line bg-bg-2 p-1 shadow-lg"
      // 버튼을 누르기 전 문서 mousedown 리스너가 먼저 선택을 지우지 않도록 막는다
      onMouseDown={(e) => e.preventDefault()}
    >
      <button
        type="button"
        role="menuitem"
        onClick={onAddToChat}
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11.5px] text-txt-1 transition hover:bg-bg-3 hover:text-txt-0"
      >
        <MessageSquarePlus className="h-3.5 w-3.5 text-blue" />
        채팅에 추가
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={onRefine}
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11.5px] text-txt-1 transition hover:bg-bg-3 hover:text-txt-0"
      >
        <Sparkles className="h-3.5 w-3.5 text-green" />
        블록 정제
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={onAskInSideChat}
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11.5px] text-txt-1 transition hover:bg-bg-3 hover:text-txt-0"
      >
        <Split className="h-3.5 w-3.5 text-green" />
        사이드 채팅에 질문
      </button>
    </div>
  )
})
