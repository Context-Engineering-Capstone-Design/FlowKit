import { create } from 'zustand'
import * as settingsApi from '@/api/settings'
import { errorCode, toErrorMessage } from '@/api/client'
import { withRequestTimeout } from '@/lib/requestTimeout'
import type { ApiKeyStatus } from '@/types/api'
import { useNotificationStore } from '@/store/notificationStore'

type SettingsModal = 'profile' | 'apiKey' | null

interface SettingsState {
  activeModal: SettingsModal
  apiKeyStatus: ApiKeyStatus | null
  isLoading: boolean
  isSaving: boolean
  isChecking: boolean
  isDeleting: boolean
  error: string | null
  notice: string | null

  openProfile: () => void
  openApiKey: (notice?: string) => void
  closeModal: () => void
  clearMessages: () => void
  load: () => Promise<void>
  saveApiKey: (apiKey: string) => Promise<boolean>
  deleteApiKey: () => Promise<boolean>
  checkApiKey: () => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  activeModal: null,
  apiKeyStatus: null,
  isLoading: false,
  isSaving: false,
  isChecking: false,
  isDeleting: false,
  error: null,
  notice: null,

  openProfile() {
    set({ activeModal: 'profile', error: null, notice: null })
  },

  openApiKey(notice) {
    set({
      activeModal: 'apiKey',
      apiKeyStatus: null,
      error: null,
      notice: notice ?? null,
    })
    void get().load()
  },

  closeModal() {
    set({ activeModal: null, error: null, notice: null })
  },

  clearMessages() {
    set({ error: null, notice: null })
  },

  async load() {
    if (get().isLoading) return
    set({ isLoading: true, error: null })
    try {
      const settings = await withRequestTimeout(({ signal }) =>
        settingsApi.fetchSettings(signal),
      )
      set({ apiKeyStatus: settings.apiKeyStatus })
      useNotificationStore.getState().dismissBanner('settings-load')
    } catch (error) {
      set({ error: toErrorMessage(error) })
      showSettingsError(error, 'settings-load', () => void get().load())
    } finally {
      set({ isLoading: false })
    }
  },

  async saveApiKey(apiKey) {
    if (get().isSaving) return false
    set({ isSaving: true, error: null, notice: null })
    try {
      const status = await withRequestTimeout(({ signal }) =>
        settingsApi.saveApiKey(apiKey, signal),
      )
      set({
        apiKeyStatus: status,
        notice: 'API 키를 안전하게 저장했습니다.',
      })
      useNotificationStore.getState().dismissBanner('settings-save')
      useNotificationStore.getState().dismissBanner('api-key-required')
      useNotificationStore.getState().show('API 키를 저장했습니다.', 'success')
      return true
    } catch (error) {
      set({ error: toErrorMessage(error) })
      // 키 원문을 전역 action에 보관하지 않도록 저장은 화면 버튼으로 다시 시도한다.
      showSettingsError(error, 'settings-save')
      return false
    } finally {
      set({ isSaving: false })
    }
  },

  async deleteApiKey() {
    if (get().isDeleting) return false
    set({ isDeleting: true, error: null, notice: null })
    try {
      const result = await withRequestTimeout(({ signal }) =>
        settingsApi.deleteApiKey(signal),
      )
      set({
        apiKeyStatus: result.apiKeyStatus,
        notice: '저장된 API 키를 삭제했습니다.',
      })
      useNotificationStore.getState().dismissBanner('settings-delete')
      useNotificationStore.getState().show('API 키를 삭제했습니다.', 'success')
      return true
    } catch (error) {
      set({ error: toErrorMessage(error) })
      showSettingsError(error, 'settings-delete', () => void get().deleteApiKey())
      return false
    } finally {
      set({ isDeleting: false })
    }
  },

  async checkApiKey() {
    if (get().isChecking) return
    set({ isChecking: true, error: null, notice: null })
    try {
      const status = await withRequestTimeout(({ signal }) =>
        settingsApi.checkApiKey(signal),
      )
      set({ apiKeyStatus: status })
      useNotificationStore.getState().dismissBanner('settings-check')
      useNotificationStore.getState().show('API 키 연결 상태를 확인했습니다.', 'success')
    } catch (error) {
      set({ error: toErrorMessage(error) })
      showSettingsError(error, 'settings-check', () => void get().checkApiKey())
    } finally {
      set({ isChecking: false })
    }
  },
}))

function showSettingsError(
  error: unknown,
  scope: string,
  retry?: () => void,
) {
  useNotificationStore.getState().showError(error, {
    scope,
    action:
      retry && errorCode(error) === 'REQUEST_TIMEOUT'
        ? { label: '다시 시도', run: retry }
        : undefined,
  })
}
