import { create } from 'zustand'

interface ConfirmState {
  message: string | null
  request: (message: string) => Promise<boolean>
  accept: () => void
  cancel: () => void
}

let pendingResolve: ((value: boolean) => void) | null = null

export const useConfirmStore = create<ConfirmState>((set) => ({
  message: null,
  request(message) {
    pendingResolve?.(false)
    return new Promise<boolean>((resolve) => {
      pendingResolve = resolve
      set({ message })
    })
  },
  accept() {
    pendingResolve?.(true)
    pendingResolve = null
    set({ message: null })
  },
  cancel() {
    pendingResolve?.(false)
    pendingResolve = null
    set({ message: null })
  },
}))
