import { create } from 'zustand'
import * as settingsApi from '@/api/settings'
import { toErrorMessage } from '@/api/client'
import type { ApiKeyStatus } from '@/types/api'

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
    set({ isLoading: true, error: null })
    try {
      const settings = await settingsApi.fetchSettings()
      set({ apiKeyStatus: settings.apiKeyStatus })
    } catch (error) {
      set({ error: toErrorMessage(error) })
    } finally {
      set({ isLoading: false })
    }
  },

  async saveApiKey(apiKey) {
    set({ isSaving: true, error: null, notice: null })
    try {
      const status = await settingsApi.saveApiKey(apiKey)
      set({
        apiKeyStatus: status,
        notice: 'API 키를 안전하게 저장했습니다.',
      })
      return true
    } catch (error) {
      set({ error: toErrorMessage(error) })
      return false
    } finally {
      set({ isSaving: false })
    }
  },

  async deleteApiKey() {
    set({ isDeleting: true, error: null, notice: null })
    try {
      const result = await settingsApi.deleteApiKey()
      set({
        apiKeyStatus: result.apiKeyStatus,
        notice: '저장된 API 키를 삭제했습니다.',
      })
      return true
    } catch (error) {
      set({ error: toErrorMessage(error) })
      return false
    } finally {
      set({ isDeleting: false })
    }
  },

  async checkApiKey() {
    set({ isChecking: true, error: null, notice: null })
    try {
      const status = await settingsApi.checkApiKey()
      set({ apiKeyStatus: status })
    } catch (error) {
      set({ error: toErrorMessage(error) })
    } finally {
      set({ isChecking: false })
    }
  },
}))
