import { create } from 'zustand'
import * as chatApi from '@/api/chat'
import { toErrorMessage } from '@/api/client'
import type {
  BranchListItem,
  ChatDetail,
  ChatSummary,
  MessageBlock,
  SourceContextItem,
} from '@/types/api'

interface ChatState {
  chats: ChatSummary[]
  nextCursor: string | null

  chatId: string | null
  chatTitle: string
  branchId: string | null
  branches: BranchListItem[]
  blocks: MessageBlock[]
  sourceContext: SourceContextItem[]

  /** 사용자가 Context 로 쓰려고 고른 블록. 전송 전까지는 화면 상태로만 둔다. */
  selectedBlockIds: string[]

  isLoading: boolean
  error: string | null

  loadChats: (keyword?: string) => Promise<void>
  loadMoreChats: () => Promise<void>
  newChat: () => Promise<void>
  openChat: (chatId: string, branchId?: string) => Promise<void>
  switchBranch: (branchId: string) => Promise<void>
  toggleBlock: (blockId: string) => void
  clearSelection: () => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  chats: [],
  nextCursor: null,
  chatId: null,
  chatTitle: '',
  branchId: null,
  branches: [],
  blocks: [],
  sourceContext: [],
  selectedBlockIds: [],
  isLoading: false,
  error: null,

  async loadChats(keyword) {
    try {
      const res = await chatApi.fetchChats({ keyword })
      set({ chats: res.chats, nextCursor: res.nextCursor, error: null })
    } catch (e) {
      set({ error: toErrorMessage(e) })
    }
  },

  async loadMoreChats() {
    const cursor = get().nextCursor
    if (!cursor) return
    try {
      const res = await chatApi.fetchChats({ cursor })
      set((s) => ({
        chats: [...s.chats, ...res.chats],
        nextCursor: res.nextCursor,
      }))
    } catch (e) {
      set({ error: toErrorMessage(e) })
    }
  },

  async newChat() {
    set({ isLoading: true })
    try {
      const detail = await chatApi.createChat()
      applyDetail(set, detail)
      await get().loadChats()
    } catch (e) {
      set({ error: toErrorMessage(e) })
    } finally {
      set({ isLoading: false })
    }
  },

  async openChat(chatId, branchId) {
    set({ isLoading: true })
    try {
      const detail = await chatApi.fetchChat(chatId, branchId)
      applyDetail(set, detail)
    } catch (e) {
      set({ error: toErrorMessage(e) })
    } finally {
      set({ isLoading: false })
    }
  },

  async switchBranch(branchId) {
    const chatId = get().chatId
    if (!chatId) return
    set({ isLoading: true })
    try {
      const detail = await chatApi.fetchBranch(chatId, branchId)
      set({
        branchId: detail.branchMeta.branchId,
        blocks: detail.messageBlocks,
        sourceContext: detail.sourceContextInfo,
        // 브랜치가 바뀌면 이전 브랜치의 블록 선택은 의미가 없다
        selectedBlockIds: [],
        branches: get().branches.map((b) => ({
          ...b,
          isActive: b.branchId === branchId,
        })),
        error: null,
      })
    } catch (e) {
      set({ error: toErrorMessage(e) })
    } finally {
      set({ isLoading: false })
    }
  },

  toggleBlock(blockId) {
    set((s) => ({
      selectedBlockIds: s.selectedBlockIds.includes(blockId)
        ? s.selectedBlockIds.filter((id) => id !== blockId)
        : [...s.selectedBlockIds, blockId],
    }))
  },

  clearSelection() {
    set({ selectedBlockIds: [] })
  },
}))

function applyDetail(
  set: (partial: Partial<ChatState>) => void,
  detail: ChatDetail,
) {
  set({
    chatId: detail.chatMeta.chatId,
    chatTitle: detail.chatMeta.title,
    branchId: detail.branchMeta.branchId,
    branches: detail.branchList,
    blocks: detail.messageBlocks,
    sourceContext: [],
    selectedBlockIds: [],
    error: null,
  })
}
