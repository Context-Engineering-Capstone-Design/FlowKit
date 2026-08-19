// @vitest-environment jsdom

import { beforeEach, expect, it, vi } from 'vitest'

const submitClientError = vi.hoisted(() => vi.fn().mockResolvedValue({}))
vi.mock('@/api/observability', () => ({ submitClientError }))

import { reportClientError } from '@/lib/errorReporting'

beforeEach(() => submitClientError.mockClear())

it('민감정보와 허용하지 않은 context를 제거해 오류를 전송한다', async () => {
  reportClientError(
    'Window Error',
    new Error('Bearer secret-token user@example.com'),
    { page: '/workspace', feature: 'chat', token: 'do-not-send' },
  )
  await Promise.resolve()

  expect(submitClientError).toHaveBeenCalledWith({
    clientErrorType: 'window_error',
    message: '[redacted] [redacted]',
    pageContext: { page: '/workspace', feature: 'chat' },
  })
})
