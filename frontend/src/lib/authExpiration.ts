import { useAuthStore } from '@/store/authStore'
import { useChatStore } from '@/store/chatStore'
import { useNotificationStore } from '@/store/notificationStore'
import { useSettingsStore } from '@/store/settingsStore'

/** 만료된 사용자의 화면·대화 상태를 함께 비우고 안내 배너 하나만 남긴다. */
export function handleAuthExpired() {
  useAuthStore.getState().clearSession()
  useSettingsStore.getState().closeModal()
  useChatStore.getState().resetSession()
  useNotificationStore.getState().showError(new Error('auth-session-expired'), {
    message: '세션이 만료되었습니다. 다시 로그인해주세요.',
    scope: 'auth-session',
  })
}
