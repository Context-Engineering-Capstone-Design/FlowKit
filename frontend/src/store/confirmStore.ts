import { create } from 'zustand'

interface ConfirmOptions {
  confirmLabel?: string
}

interface ConfirmState {
  message: string | null
  confirmLabel: string
  request: (message: string, options?: ConfirmOptions) => Promise<boolean>
  accept: () => void
  cancel: () => void
}

const DEFAULT_CONFIRM_LABEL = '확인'

let pendingResolve: ((value: boolean) => void) | null = null

export const useConfirmStore = create<ConfirmState>((set) => ({
  message: null,
  confirmLabel: DEFAULT_CONFIRM_LABEL,
  request(message, options) {
    pendingResolve?.(false)
    return new Promise<boolean>((resolve) => {
      pendingResolve = resolve
      set({
        message,
        confirmLabel: options?.confirmLabel ?? DEFAULT_CONFIRM_LABEL,
      })
    })
  },
  accept() {
    pendingResolve?.(true)
    pendingResolve = null
    set({ message: null, confirmLabel: DEFAULT_CONFIRM_LABEL })
  },
  cancel() {
    pendingResolve?.(false)
    pendingResolve = null
    set({ message: null, confirmLabel: DEFAULT_CONFIRM_LABEL })
  },
}))
