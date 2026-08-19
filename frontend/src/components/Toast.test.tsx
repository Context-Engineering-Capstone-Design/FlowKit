// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it } from 'vitest'
import { Toast } from '@/components/Toast'
import { useNotificationStore } from '@/store/notificationStore'

beforeEach(() => {
  useNotificationStore.getState().clearToast()
  useNotificationStore.getState().dismissBanner()
})

it('토스트 메시지와 action을 실행하고 닫는다', () => {
  let called = false
  useNotificationStore.getState().showToast({
    message: '일부 항목을 처리하지 못했습니다.',
    action: { label: '다시 시도', run: () => { called = true } },
  })
  render(<Toast />)

  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))

  expect(called).toBe(true)
  expect(useNotificationStore.getState().toast).toBeNull()
})
