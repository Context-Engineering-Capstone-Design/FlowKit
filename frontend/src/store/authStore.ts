import { create } from 'zustand'
import * as authApi from '@/api/auth'
import { toErrorMessage, tokenStore } from '@/api/client'
import type { UserProfile } from '@/types/api'
import { useNotificationStore } from '@/store/notificationStore'

interface AuthState {
  user: UserProfile | null
  isChecking: boolean
  error: string | null

  /** 새로고침 후에도 로그인 상태를 이어가기 위해 저장된 토큰으로 확인한다. */
  check: () => Promise<void>
  loginWithGoogle: (idToken: string) => Promise<void>
  exchangeGoogleLogin: (code: string) => Promise<void>
  loginForDevelopment: () => Promise<void>
  updateProfile: (payload: {
    name: string
    email: string
    memo: string | null
  }) => Promise<UserProfile>
  clearSession: () => void
  logout: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isChecking: true,
  error: null,

  async check() {
    if (!tokenStore.access) {
      set({ user: null, isChecking: false })
      return
    }
    try {
      const status = await authApi.fetchAuthStatus()
      set({ user: status.user, isChecking: false })
    } catch (e) {
      set({ user: null, isChecking: false, error: toErrorMessage(e) })
      if (tokenStore.access) {
        useNotificationStore.getState().showError(e, { scope: 'auth' })
      }
    }
  },

  async loginWithGoogle(idToken) {
    set({ error: null })
    try {
      const res = await authApi.loginWithGoogle(idToken)
      set({ user: res.user })
      useNotificationStore.getState().dismissBanner('auth')
      useNotificationStore.getState().dismissBanner('auth-session')
    } catch (e) {
      set({ error: toErrorMessage(e) })
      useNotificationStore.getState().showError(e, { scope: 'auth' })
    }
  },

  async exchangeGoogleLogin(code) {
    set({ error: null, isChecking: true })
    try {
      const res = await authApi.exchangeGoogleLogin(code)
      set({ user: res.user, isChecking: false })
      useNotificationStore.getState().dismissBanner('auth')
      useNotificationStore.getState().dismissBanner('auth-session')
    } catch (e) {
      set({ user: null, isChecking: false, error: toErrorMessage(e) })
      useNotificationStore.getState().showError(e, { scope: 'auth' })
    }
  },

  async loginForDevelopment() {
    set({ error: null })
    try {
      const res = await authApi.loginForDevelopment()
      set({ user: res.user })
      useNotificationStore.getState().dismissBanner('auth')
      useNotificationStore.getState().dismissBanner('auth-session')
    } catch (e) {
      set({ error: toErrorMessage(e) })
      useNotificationStore.getState().showError(e, { scope: 'auth' })
    }
  },

  async updateProfile(payload) {
    const user = await authApi.updateMe(payload)
    set({ user })
    return user
  },

  clearSession() {
    set({ user: null, error: null })
  },

  async logout() {
    try {
      await authApi.logout()
    } catch {
      // 토큰은 authApi.logout 내부에서 이미 지워졌다. 요청이 실패해도 화면은 로그인 상태로 되돌린다
    } finally {
      set({ user: null })
      useNotificationStore.getState().dismissBanner('auth')
      useNotificationStore.getState().dismissBanner('auth-session')
    }
  },
}))
