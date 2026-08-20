// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WebSearchToggle } from '@/components/WebSearchToggle'

afterEach(cleanup)

it('현재 상태를 버튼에 보여준다', () => {
  render(<WebSearchToggle mode="auto" disabled={false} onChange={vi.fn()} />)
  expect(screen.getByText('웹 검색 · 자동')).toBeTruthy()
})

it('버튼을 누르면 세 상태를 목록으로 보여준다', () => {
  render(<WebSearchToggle mode="off" disabled={false} onChange={vi.fn()} />)

  fireEvent.click(screen.getByRole('button', { name: /웹 검색/ }))

  expect(screen.getByRole('option', { name: /자동/ })).toBeTruthy()
  expect(screen.getByRole('option', { name: /항상/ })).toBeTruthy()
  expect(screen.getByRole('option', { name: /끄기/ })).toBeTruthy()
})

it('상태를 고르면 onChange를 부르고 목록을 닫는다', () => {
  const onChange = vi.fn()
  render(<WebSearchToggle mode="off" disabled={false} onChange={onChange} />)

  fireEvent.click(screen.getByRole('button', { name: /웹 검색/ }))
  fireEvent.click(screen.getByRole('option', { name: /항상/ }))

  expect(onChange).toHaveBeenCalledWith('always')
  expect(screen.queryByRole('listbox')).toBeNull()
})

it('모델이 검색을 지원하지 않으면 비활성화하고 사유를 알린다', () => {
  render(<WebSearchToggle mode="off" disabled reason="선택한 모델은 웹 검색을 지원하지 않습니다." onChange={vi.fn()} />)

  const button = screen.getByRole('button', { name: /웹 검색/ })
  expect(button).toHaveProperty('disabled', true)
  expect(button.title).toBe('선택한 모델은 웹 검색을 지원하지 않습니다.')
})
