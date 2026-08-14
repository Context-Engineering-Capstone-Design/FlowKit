import { create } from 'zustand'
import * as chatApi from '@/api/chat'
import { toErrorMessage } from '@/api/client'
import * as convApi from '@/api/conversation'
import type {
  BranchListItem,
  ChatDetail,
  ChatSummary,
  MessageBlock,
  RefineJob,
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
  /** 전송 시 실제로 적용할 Context. 정제 승인 후 확정된다. */
  appliedBlockIds: string[]

  refineJob: RefineJob | null
  /** 블록별로 원본을 보는 중인지 정제본을 보는 중인지 (REQ-031) */
  inlineView: Record<string, 'original' | 'refined'>

  isSending: boolean
  isRefining: boolean
  isCreatingBranch: boolean
  error: string | null

  loadChats: (keyword?: string) => Promise<void>
  newChat: () => Promise<void>
  openChat: (chatId: string, branchId?: string) => Promise<void>
  switchBranch: (branchId: string) => Promise<void>
  toggleBlock: (blockId: string) => void
  clearSelection: () => void
  sendMessage: (prompt: string) => Promise<void>
  regenerate: (blockId: string) => Promise<void>
  runRefine: (instruction: string) => Promise<void>
  approveResult: (resultId: string) => Promise<void>
  rejectResult: (resultId: string) => Promise<void>
  approveAll: () => Promise<void>
  closeRefine: () => Promise<void>
  setInlineView: (blockId: string, view: 'original' | 'refined') => void
  createBranch: (
    name: string,
    baseBlockId: string,
    contextBlockIds: string[],
  ) => Promise<boolean>
  /** Context pill 을 눌렀을 때 원본 블록 위치로 이동한다 (REQ-012) */
  jumpToSource: (item: SourceContextItem) => Promise<void>
  highlightedBlockId: string | null
  applyContext: () => void
  clearAppliedContext: () => void
  dismissError: () => void
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
  appliedBlockIds: [],
  refineJob: null,
  inlineView: {},
  isSending: false,
  isRefining: false,
  isCreatingBranch: false,
  highlightedBlockId: null,
  error: null,

  async loadChats(keyword) {
    try {
      const res = await chatApi.fetchChats({ keyword })
      set({ chats: res.chats, nextCursor: res.nextCursor })
    } catch (e) {
      set({ error: toErrorMessage(e) })
    }
  },

  async newChat() {
    try {
      applyDetail(set, await chatApi.createChat())
      await get().loadChats()
    } catch (e) {
      set({ error: toErrorMessage(e) })
    }
  },

  async openChat(chatId, branchId) {
    try {
      applyDetail(set, await chatApi.fetchChat(chatId, branchId))
    } catch (e) {
      set({ error: toErrorMessage(e) })
    }
  },

  async switchBranch(branchId) {
    const { chatId } = get()
    if (!chatId) return
    try {
      const detail = await chatApi.fetchBranch(chatId, branchId)
      set({
        branchId: detail.branchMeta.branchId,
        blocks: detail.messageBlocks,
        sourceContext: detail.sourceContextInfo,
        // 브랜치가 바뀌면 이전 브랜치의 선택은 의미가 없다
        selectedBlockIds: [],
        appliedBlockIds: [],
        refineJob: null,
        inlineView: {},
        branches: get().branches.map((b) => ({
          ...b,
          isActive: b.branchId === branchId,
        })),
      })
    } catch (e) {
      set({ error: toErrorMessage(e) })
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

  applyContext() {
    set((s) => ({ appliedBlockIds: [...s.selectedBlockIds] }))
  },

  clearAppliedContext() {
    set({ appliedBlockIds: [] })
  },

  async sendMessage(prompt) {
    const { chatId, branchId, appliedBlockIds } = get()
    if (!chatId || !branchId || !prompt.trim()) return

    set({ isSending: true, error: null })
    try {
      const res = await convApi.sendMessage(
        chatId,
        branchId,
        prompt,
        appliedBlockIds,
      )
      set((s) => ({
        blocks: [...s.blocks, res.userBlock, res.assistantBlock],
        chatTitle: res.chatTitle,
        // 한 번 쓴 Context 는 자동으로 해제한다. 남겨두면 다음 질문까지
        // 같은 맥락에 묶여, 사용자가 의도하지 않은 답이 나온다.
        appliedBlockIds: [],
        selectedBlockIds: [],
      }))
      if (res.titleGenerated) await get().loadChats()
    } catch (e) {
      // 질문은 서버에 남아 있으므로 화면을 다시 맞춘다
      set({ error: toErrorMessage(e) })
      await get().openChat(chatId, branchId)
    } finally {
      set({ isSending: false })
    }
  },

  async regenerate(blockId) {
    const { chatId, branchId } = get()
    if (!chatId || !branchId) return
    set({ isSending: true })
    try {
      const block = await convApi.regenerate(chatId, branchId, blockId)
      set((s) => ({
        blocks: s.blocks.map((b) =>
          b.blockId === blockId ? { ...b, content: block.content } : b,
        ),
      }))
    } catch (e) {
      set({ error: toErrorMessage(e) })
    } finally {
      set({ isSending: false })
    }
  },

  async runRefine(instruction) {
    const { chatId, branchId, selectedBlockIds } = get()
    if (!chatId || !branchId || selectedBlockIds.length === 0) return

    set({ isRefining: true, error: null })
    try {
      const job = await convApi.runRefine(
        chatId,
        branchId,
        selectedBlockIds,
        instruction,
      )
      set({
        refineJob: job,
        inlineView: Object.fromEntries(
          job.results.map((r) => [r.blockId, 'refined' as const]),
        ),
      })
    } catch (e) {
      set({ error: toErrorMessage(e) })
    } finally {
      set({ isRefining: false })
    }
  },

  async approveResult(resultId) {
    const { chatId, branchId, refineJob } = get()
    if (!chatId || !branchId || !refineJob) return
    try {
      await convApi.approveResult(chatId, branchId, refineJob.refineJobId, resultId)
      await refreshAfterDecision(set, get, resultId)
    } catch (e) {
      set({ error: toErrorMessage(e) })
    }
  },

  async rejectResult(resultId) {
    const { chatId, branchId, refineJob } = get()
    if (!chatId || !branchId || !refineJob) return
    try {
      await convApi.rejectResult(chatId, branchId, refineJob.refineJobId, resultId)
      await refreshAfterDecision(set, get, resultId)
    } catch (e) {
      set({ error: toErrorMessage(e) })
    }
  },

  async approveAll() {
    const { chatId, branchId, refineJob } = get()
    if (!chatId || !branchId || !refineJob) return
    try {
      await convApi.approveAll(chatId, branchId, refineJob.refineJobId)
      await get().openChat(chatId, branchId)
      set({ refineJob: null, inlineView: {} })
    } catch (e) {
      set({ error: toErrorMessage(e) })
    }
  },

  async closeRefine() {
    const { chatId, branchId, refineJob } = get()
    if (chatId && branchId && refineJob) {
      // 남은 대기 항목을 정리하지 않으면 다음에 열었을 때 되살아난 것처럼 보인다
      try {
        await convApi.cleanupJob(chatId, branchId, refineJob.refineJobId)
      } catch {
        /* 정리 실패는 화면을 막을 만한 문제가 아니다 */
      }
    }
    set({ refineJob: null, inlineView: {} })
  },

  async createBranch(name, baseBlockId, contextBlockIds) {
    const { chatId, branchId } = get()
    if (!chatId || !branchId) return false

    set({ isCreatingBranch: true, error: null })
    try {
      const created = await chatApi.createBranch(chatId, {
        branchName: name,
        baseBranchId: branchId,
        baseMessageBlockId: baseBlockId,
        contextBlockIds,
      })
      // 만든 브랜치로 바로 들어간다. 목록만 갱신하면 어디로 갔는지 알기 어렵다
      set({ branches: await chatApi.fetchBranches(chatId) })
      await get().switchBranch(created.branchId)
      return true
    } catch (e) {
      set({ error: toErrorMessage(e) })
      return false
    } finally {
      set({ isCreatingBranch: false })
    }
  },

  async jumpToSource(item) {
    const { chatId, branchId } = get()
    if (!chatId) return

    // 원본이 다른 브랜치에 있으면 그 브랜치로 먼저 옮긴다
    if (item.sourceBranchId && item.sourceBranchId !== branchId) {
      await get().switchBranch(item.sourceBranchId)
    }
    set({ highlightedBlockId: item.sourceMessageBlockId })

    document
      .getElementById(`block-${item.sourceMessageBlockId}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })

    // 강조는 잠깐만 남긴다. 계속 켜두면 어디를 보라는 건지 흐려진다
    setTimeout(() => {
      if (get().highlightedBlockId === item.sourceMessageBlockId) {
        set({ highlightedBlockId: null })
      }
    }, 2000)
  },

  setInlineView(blockId, view) {
    set((s) => ({ inlineView: { ...s.inlineView, [blockId]: view } }))
  },

  dismissError() {
    set({ error: null })
  },
}))

/** 승인·거절 후 본문과 남은 결과를 다시 맞춘다. */
async function refreshAfterDecision(
  set: (partial: Partial<ChatState>) => void,
  get: () => ChatState,
  resultId: string,
) {
  const { chatId, branchId, refineJob } = get()
  if (!chatId || !branchId || !refineJob) return

  const detail = await chatApi.fetchChat(chatId, branchId)
  const remaining = refineJob.results.filter((r) => r.resultId !== resultId)

  set({
    blocks: detail.messageBlocks,
    refineJob: remaining.length
      ? { ...refineJob, results: remaining }
      : null,
  })
}

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
    appliedBlockIds: [],
    refineJob: null,
    inlineView: {},
    error: null,
  })
}
