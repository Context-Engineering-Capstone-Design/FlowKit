// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useConfirmStore } from '@/store/confirmStore'

afterEach(cleanup)

it('사용자가 취소하면 대기 중인 이탈 요청을 false로 끝낸다', async () => {
  const result = useConfirmStore.getState().request('수정 내용을 버릴까요?')
  render(<ConfirmDialog />)

  fireEvent.click(screen.getByRole('button', { name: '취소' }))

  await expect(result).resolves.toBe(false)
  expect(useConfirmStore.getState().message).toBeNull()
})
