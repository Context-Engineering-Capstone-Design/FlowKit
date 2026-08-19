import { create } from 'zustand'
import { errorCode, errorTraceId, toErrorMessage } from '@/api/client'
import type { ActionMeta } from '@/types/api'

export type NoticeKind = 'success' | 'error' | 'info' | 'warning'

export interface NotificationAction {
  label: string
  run: () => void
}

export interface ToastInput {
  message: string
  kind?: NoticeKind
  durationMs?: number
  action?: NotificationAction
}

export interface ErrorBannerInput {
  message?: string
  scope?: string
  details?: string[]
  action?: NotificationAction
}

export interface ToastState
  extends Required<Pick<ToastInput, 'message' | 'kind' | 'durationMs'>> {
  id: number
  action?: NotificationAction
}

export interface ErrorBannerState {
  message: string
  errorCode: string | null
  traceId: string | null
  scope: string | null
  details: string[]
  action?: NotificationAction
}

type PauseReason = 'hover' | 'focus'

interface NotificationState {
  banner: ErrorBannerState | null
  toast: ToastState | null
  showError: (error: unknown, input?: ErrorBannerInput) => void
  dismissBanner: (scope?: string) => void
  showToast: (input: ToastInput) => void
  showAction: (actionMeta: ActionMeta, kind?: NoticeKind) => void
  clearToast: () => void
  pauseToast: (reason: PauseReason) => void
  resumeToast: (reason: PauseReason) => void
  /** 기존 화면에서 쓰던 호출 방식과의 호환용 별칭. */
  show: (message: string, kind?: NoticeKind) => void
  clear: () => void
}

const DEFAULT_TOAST_DURATION_MS = 3_500
let nextToastId = 0
let toastTimer: ReturnType<typeof setTimeout> | null = null
let toastStartedAt = 0
let toastRemainingMs = DEFAULT_TOAST_DURATION_MS
const pauseReasons = new Set<PauseReason>()

function stopToastTimer() {
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = null
}

export const useNotificationStore = create<NotificationState>((set, get) => {
  function startToastTimer(id: number) {
    stopToastTimer()
    toastStartedAt = Date.now()
    toastTimer = setTimeout(() => {
      toastTimer = null
      set((state) => (state.toast?.id === id ? { toast: null } : state))
    }, toastRemainingMs)
  }

  return {
    banner: null,
    toast: null,

    showError(error, input) {
      set({
        banner: {
          message: input?.message ?? toErrorMessage(error),
          errorCode: errorCode(error),
          traceId: errorTraceId(error),
          scope: input?.scope ?? null,
          details: (input?.details ?? []).filter(Boolean).slice(0, 20),
          action: input?.action,
        },
      })
    },

    dismissBanner(scope) {
      set((state) =>
        !scope || state.banner?.scope === scope ? { banner: null } : state,
      )
    },

    showToast(input) {
      const id = ++nextToastId
      const durationMs = Math.max(
        1_000,
        input.durationMs ?? DEFAULT_TOAST_DURATION_MS,
      )
      pauseReasons.clear()
      toastRemainingMs = durationMs
      set({
        toast: {
          id,
          message: input.message,
          kind: input.kind ?? 'info',
          durationMs,
          action: input.action,
        },
      })
      startToastTimer(id)
    },

    showAction(actionMeta, kind = 'success') {
      get().showToast({
        message: actionMeta.message,
        kind: actionMeta.successCode === 'PARTIAL_SUCCESS' ? 'warning' : kind,
      })
    },

    clearToast() {
      stopToastTimer()
      pauseReasons.clear()
      set({ toast: null })
    },

    pauseToast(reason) {
      pauseReasons.add(reason)
      if (!toastTimer) return
      toastRemainingMs = Math.max(
        0,
        toastRemainingMs - (Date.now() - toastStartedAt),
      )
      stopToastTimer()
    },

    resumeToast(reason) {
      pauseReasons.delete(reason)
      if (pauseReasons.size > 0 || toastTimer) return
      const toast = get().toast
      if (!toast || toastRemainingMs <= 0) {
        get().clearToast()
        return
      }
      startToastTimer(toast.id)
    },

    show(message, kind = 'info') {
      get().showToast({ message, kind })
    },

    clear() {
      get().clearToast()
    },
  }
})
