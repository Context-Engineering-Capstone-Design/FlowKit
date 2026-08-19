// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '@/lib/requestTimeout'

const submitFeedback = vi.hoisted(() => vi.fn())
vi.mock('@/api/feedback', () => ({ submitFeedback }))

import { FeedbackModal } from '@/components/FeedbackModal'
import { useChatStore } from '@/store/chatStore'
import { useNotificationStore } from '@/store/notificationStore'

describe('FeedbackModal 제출 복구', () => {
  beforeEach(() => {
    submitFeedback.mockReset()
    useChatStore.setState({ chatId: 'chat-1', branchId: 'branch-1' })
    useNotificationStore.getState().clearToast()
    useNotificationStore.getState().dismissBanner()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('성공하면 입력을 비우고 화면·채팅·브랜치 정보만 전송한다', async () => {
    submitFeedback.mockResolvedValue({
      feedbackId: 'feedback-1',
      submittedAt: '2026-08-19T00:00:00Z',
      actionMeta: {
        actionType: 'service_feedback_submit',
        successCode: 'SERVICE_FEEDBACK_SUBMITTED',
        message: '피드백을 제출했습니다.',
        affectedResourceId: 'feedback-1',
      },
    })
    const onClose = vi.fn()
    render(<FeedbackModal onClose={onClose} />)
    const input = screen.getByLabelText('내용') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: '개선 의견' } })
    fireEvent.click(screen.getByRole('button', { name: '제출' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(input.value).toBe('')
    expect(submitFeedback).toHaveBeenCalledWith(
      'usability',
      '개선 의견',
      { page: '/', chatId: 'chat-1', branchId: 'branch-1' },
      expect.any(AbortSignal),
    )
  })

  it('실패하면 유형과 입력 내용을 유지한다', async () => {
    submitFeedback.mockRejectedValue(new Error('submit failed'))
    render(<FeedbackModal onClose={() => undefined} />)
    const type = screen.getByLabelText('유형') as HTMLSelectElement
    const input = screen.getByLabelText('내용') as HTMLTextAreaElement
    fireEvent.change(type, { target: { value: 'branch' } })
    fireEvent.change(input, { target: { value: '이 내용은 유지' } })
    fireEvent.click(screen.getByRole('button', { name: '제출' }))

    await screen.findByText('요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.')
    expect(type.value).toBe('branch')
    expect(input.value).toBe('이 내용은 유지')
  })

  it('시간이 초과되면 입력을 유지하고 다시 시도 action을 제공한다', async () => {
    vi.useFakeTimers()
    submitFeedback.mockReturnValue(new Promise(() => undefined))
    render(<FeedbackModal onClose={() => undefined} />)
    const input = screen.getByLabelText('내용') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: '느린 요청 내용' } })
    fireEvent.click(screen.getByRole('button', { name: '제출' }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS)
    })

    expect(input.value).toBe('느린 요청 내용')
    expect(useNotificationStore.getState().banner).toMatchObject({
      errorCode: 'REQUEST_TIMEOUT',
      scope: 'feedback',
      action: { label: '다시 시도' },
    })
  })
})
