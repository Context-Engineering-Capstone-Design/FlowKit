import { api, tokenStore } from './client'
import type { AuthStatus, TokenResponse, UserProfile } from '@/types/api'

export async function loginWithGoogle(idToken: string): Promise<TokenResponse> {
  const { data } = await api.post<TokenResponse>('/api/auth/google', { idToken })
  tokenStore.save(data.accessToken, data.refreshToken)
  return data
}

export async function fetchAuthStatus(): Promise<AuthStatus> {
  const { data } = await api.get<AuthStatus>('/api/auth/status')
  return data
}

export async function fetchMe(): Promise<UserProfile> {
  const { data } = await api.get<UserProfile>('/api/auth/me')
  return data
}

export async function updateMe(payload: {
  name?: string
  email?: string
  memo?: string
}): Promise<UserProfile> {
  const { data } = await api.patch<UserProfile>('/api/auth/me', payload)
  return data
}

export async function logout(): Promise<void> {
  try {
    await api.post('/api/auth/logout')
  } finally {
    // 서버 요청이 실패해도 이 기기의 토큰은 반드시 지운다
    tokenStore.clear()
  }
}
