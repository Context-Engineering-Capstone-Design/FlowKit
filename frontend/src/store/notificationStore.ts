import { create } from 'zustand'
export type NoticeKind = 'success' | 'error' | 'info'
interface State { message: string | null; kind: NoticeKind; show: (message: string, kind?: NoticeKind) => void; clear: () => void }
let timer: number | null = null
export const useNotificationStore = create<State>((set) => ({
  message: null, kind: 'info',
  show(message, kind = 'info') { if (timer) window.clearTimeout(timer); set({ message, kind }); timer = window.setTimeout(() => set({ message: null }), 3500) },
  clear() { if (timer) window.clearTimeout(timer); set({ message: null }) },
}))
