// @vitest-environment jsdom

import { afterEach, expect, it, vi } from 'vitest'
import { RequestTimeoutError, withRequestTimeout } from '@/lib/requestTimeout'

afterEach(() => vi.useRealTimers())

it('제한 시간이 지나면 요청을 중단하고 시간 초과 오류를 반환한다', async () => {
  vi.useFakeTimers()
  const pending = withRequestTimeout(
    ({ signal }) => new Promise<void>((_, reject) => {
      signal.addEventListener('abort', () => reject(new RequestTimeoutError(100)))
    }),
    100,
  )

  const assertion = expect(pending).rejects.toBeInstanceOf(RequestTimeoutError)
  await vi.advanceTimersByTimeAsync(100)
  await assertion
})
