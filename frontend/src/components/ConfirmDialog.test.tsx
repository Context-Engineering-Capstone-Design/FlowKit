// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useConfirmStore } from '@/store/confirmStore'

afterEach(() => {
  cleanup()
  useConfirmStore.setState({ message: null, confirmLabel: '확인' })
})

it('사용자가 취소하면 대기 중인 이탈 요청을 false로 끝낸다', async () => {
  const result = useConfirmStore.getState().request('수정 내용을 버릴까요?', { confirmLabel: '버리기' })
  render(<ConfirmDialog />)

  fireEvent.click(screen.getByRole('button', { name: '취소' }))

  await expect(result).resolves.toBe(false)
  expect(useConfirmStore.getState().message).toBeNull()
})

it('확인 버튼 문구를 요청에 맞게 보여준다', () => {
  void useConfirmStore.getState().request('이 대화를 삭제할까요?', { confirmLabel: '삭제' })
  render(<ConfirmDialog />)

  expect(screen.getByRole('button', { name: '삭제' })).toBeTruthy()
})
