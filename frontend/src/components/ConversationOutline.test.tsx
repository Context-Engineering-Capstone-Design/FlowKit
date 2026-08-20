// @vitest-environment jsdom

import { useRef } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ConversationOutline } from '@/components/ConversationOutline'
import type { ConversationOutlineTurn } from '@/lib/conversationOutline'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const turns: ConversationOutlineTurn[] = [
  { turnId: 'q1', questionBlockId: 'q1', questionTitle: '첫 번째 질문', answerBlockId: 'a1', answerPreview: '첫 번째 답변 미리보기', order: 0 },
  { turnId: 'q2', questionBlockId: 'q2', questionTitle: '두 번째 질문', answerBlockId: 'a2', answerPreview: '두 번째 답변 미리보기', order: 1 },
]

function Harness({ turns: items }: { turns: ConversationOutlineTurn[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  return (
    <div ref={containerRef}>
      <div ref={contentRef}>
        {items.map((turn) => (
          <div key={turn.turnId} id={`block-${turn.questionBlockId}`} />
        ))}
      </div>
      <ConversationOutline containerRef={containerRef} contentRef={contentRef} turns={items} />
    </div>
  )
}

let restoreScrollHeight: (() => void) | null = null

function mockOverflow(scrollHeight: number, clientHeight: number) {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => scrollHeight })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => clientHeight })
  restoreScrollHeight = () => {
    delete (HTMLElement.prototype as { scrollHeight?: unknown }).scrollHeight
    delete (HTMLElement.prototype as { clientHeight?: unknown }).clientHeight
  }
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  restoreScrollHeight?.()
  restoreScrollHeight = null
})

it('스크롤이 생기지 않는 짧은 대화에서는 레일을 보여주지 않는다', () => {
  // jsdom 기본값은 scrollHeight === clientHeight(0) 이라 넘치지 않는 상태다.
  render(<Harness turns={turns} />)
  expect(screen.queryByRole('navigation', { name: '대화 목차' })).toBeNull()
})

it('스크롤이 넘치는 긴 대화에서는 항목별 레일 점을 보여준다', () => {
  mockOverflow(2000, 500)
  render(<Harness turns={turns} />)

  const nav = screen.getByRole('navigation', { name: '대화 목차' })
  expect(nav).toBeTruthy()
  expect(screen.getByRole('button', { name: '첫 번째 질문' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '두 번째 질문' })).toBeTruthy()
})

it('항목에 포커스하면 질문 제목과 답변 미리보기 팝업을 보여준다', () => {
  mockOverflow(2000, 500)
  render(<Harness turns={turns} />)

  fireEvent.focus(screen.getByRole('button', { name: '첫 번째 질문' }))

  const tooltip = screen.getByRole('tooltip')
  expect(tooltip.textContent).toContain('첫 번째 질문')
  expect(tooltip.textContent).toContain('첫 번째 답변 미리보기')
})

it('항목을 선택하면 해당 질문 블록으로만 부드럽게 이동한다', () => {
  mockOverflow(2000, 500)
  render(<Harness turns={turns} />)
  const scrollIntoView = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>

  fireEvent.click(screen.getByRole('button', { name: '두 번째 질문' }))

  expect(scrollIntoView).toHaveBeenCalledTimes(1)
  expect(scrollIntoView.mock.instances[0]).toBe(document.getElementById('block-q2'))
  expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
})
