import { describe, expect, it } from 'vitest'
import { isAuthEndpoint } from '@/api/client'

describe('인증 요청 재발급 제외 경로', () => {
  it('로그인·재발급 요청을 인증 API로 식별한다', () => {
    expect(isAuthEndpoint('/api/auth/google')).toBe(true)
    expect(isAuthEndpoint('/api/auth/dev')).toBe(true)
    expect(isAuthEndpoint('/api/auth/refresh?x=1')).toBe(true)
    expect(isAuthEndpoint('/api/chats/chat-1')).toBe(false)
  })
})
