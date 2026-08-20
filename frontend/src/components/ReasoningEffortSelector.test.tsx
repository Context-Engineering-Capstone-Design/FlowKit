// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ReasoningEffortSelector } from '@/components/ReasoningEffortSelector'

afterEach(cleanup)

it('현재 추론 단계를 버튼에 보여 준다', () => {
  render(<ReasoningEffortSelector value="high" onChange={() => undefined} />)

  expect(screen.getByRole('button', { name: '추론 높음' })).toBeTruthy()
})

it('화살표로 다음 단계를 고른다', () => {
  const onChange = vi.fn()
  render(<ReasoningEffortSelector value="medium" onChange={onChange} />)

  fireEvent.click(screen.getByRole('button', { name: '추론 중간' }))
  fireEvent.keyDown(screen.getByRole('slider', { name: '추론 수준' }), { key: 'ArrowRight' })

  expect(onChange).toHaveBeenCalledWith('high')
})
