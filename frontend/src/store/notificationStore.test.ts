// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNotificationStore } from '@/store/notificationStore'

describe('notificationStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useNotificationStore.getState().clearToast()
    useNotificationStore.getState().dismissBanner()
  })

  afterEach(() => vi.useRealTimers())

  it('새 오류가 기존 배너를 교체한다', () => {
    useNotificationStore.getState().showError(new Error('one'), { message: '첫 오류' })
    useNotificationStore.getState().showError(new Error('two'), { message: '둘째 오류' })
    expect(useNotificationStore.getState().banner?.message).toBe('둘째 오류')
  })

  it('토스트를 자동 또는 수동으로 닫는다', () => {
    useNotificationStore.getState().showToast({ message: '완료', durationMs: 1_000 })
    vi.advanceTimersByTime(1_000)
    expect(useNotificationStore.getState().toast).toBeNull()

    useNotificationStore.getState().showToast({ message: '다시 표시' })
    useNotificationStore.getState().clearToast()
    expect(useNotificationStore.getState().toast).toBeNull()
  })

  it('hover 중에는 자동 닫기 시간을 멈춘다', () => {
    useNotificationStore.getState().showToast({ message: '유지', durationMs: 2_000 })
    vi.advanceTimersByTime(500)
    useNotificationStore.getState().pauseToast('hover')
    vi.advanceTimersByTime(5_000)
    expect(useNotificationStore.getState().toast?.message).toBe('유지')

    useNotificationStore.getState().resumeToast('hover')
    vi.advanceTimersByTime(1_500)
    expect(useNotificationStore.getState().toast).toBeNull()
  })
})
