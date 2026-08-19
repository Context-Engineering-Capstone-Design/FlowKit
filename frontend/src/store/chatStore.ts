import { create } from 'zustand'
import * as chatApi from '@/api/chat'
import { errorCode, errorDetail, toErrorMessage } from '@/api/client'
import * as convApi from '@/api/conversation'
import * as inputAssistApi from '@/api/inputAssist'
import { useSettingsStore } from '@/store/settingsStore'
import type {
  AiResponseRating,
  BranchListItem,
  ChatDetail,
  ChatSummary,
  MessageBlock,
  RefineJob,
  SourceContextItem,
  VersionItem,
  DraftAttachment,
  ModelOption,
  AiResponseFailureDetail,
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
  /** 서버에 저장된 현재 사용자의 AI 답변 평가 상태. */
  ratings: Record<string, AiResponseRating | undefined>
  versionsByBlock: Record<string, VersionItem[] | undefined>

  isSending: boolean
  isRefining: boolean
  isCreatingBranch: boolean
  /** 로그인 직후 기본 대화를 여는 중인지. 빈 화면이 잠깐 보이지 않게 한다. */
  isOpeningDefaultChat: boolean
  error: string | null
  /** 값이 바뀔 때마다 입력창에 포커스를 옮긴다 (REQ-004) */
  focusSignal: number

  draftText: string
  selectedModelId: string | null
  webSearchEnabled: boolean
  draftAttachments: DraftAttachment[]
  models: ModelOption[]
  isModelListLoading: boolean
  pendingByBlockId: Record<string, boolean>
  failedJobsByBlockId: Record<string, string>

  loadChats: (keyword?: string) => Promise<void>
  newChat: () => Promise<void>
  /** 로그인·새로고침 후 작업 화면에 들어오면 바로 빈 대화를 연다. */
  openDefaultChat: () => Promise<void>
  /** 로그아웃·세션 만료 때 이전 사용자의 대화 상태를 비운다. */
  resetSession: () => void
  openChat: (chatId: string, branchId?: string) => Promise<void>
  switchBranch: (branchId: string) => Promise<void>
  toggleBlock: (blockId: string) => void
  clearSelection: () => void
  sendMessage: (prompt: string) => Promise<void>
  regenerate: (blockId: string) => Promise<void>
  setFeedback: (blockId: string, rating: AiResponseRating) => Promise<void>
  loadVersions: (blockId: string) => Promise<void>
  setActiveVersion: (blockId: string, versionId: string) => Promise<void>
  editBlock: (blockId: string, content: string) => Promise<boolean>
  runRefine: (instruction: string) => Promise<void>
  approveResult: (resultId: string) => Promise<void>
  rejectResult: (resultId: string) => Promise<void>
  approveAll: () => Promise<void>
  rejectAll: () => Promise<void>
  closeRefine: () => Promise<void>
  setInlineView: (blockId: string, view: 'original' | 'refined') => void
  createBranch: (
    name: string,
    baseBlockId: string,
    contextBlockIds: string[],
    editedBaseContent?: string,
  ) => Promise<boolean>
  /** Context pill 을 눌렀을 때 원본 블록 위치로 이동한다 (REQ-012) */
  jumpToSource: (item: SourceContextItem) => Promise<void>
  highlightedBlockId: string | null
  applyContext: () => void
  clearAppliedContext: () => void
  dismissError: () => void
  loadInputAssist: () => Promise<void>
  setDraftText: (text: string) => void
  setSelectedModel: (modelId: string) => void
  setWebSearchEnabled: (enabled: boolean) => void
  addFiles: (files: File[]) => Promise<void>
  removeAttachment: (localId: string) => Promise<void>
  retryAttachment: (localId: string) => Promise<void>
  uploadAttachment: (localId: string) => Promise<void>
  clearDraft: () => void
  retryAiResponseJob: (jobId: string) => Promise<void>
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
  ratings: {},
  versionsByBlock: {},
  isSending: false,
  isRefining: false,
  isCreatingBranch: false,
  isOpeningDefaultChat: false,
  highlightedBlockId: null,
  error: null,
  focusSignal: 0,
  draftText: '',
  selectedModelId: null,
  webSearchEnabled: false,
  draftAttachments: [],
  models: [],
  isModelListLoading: false,
  pendingByBlockId: {},
  failedJobsByBlockId: {},

  async loadChats(keyword) {
    try {
      const res = await chatApi.fetchChats({ keyword })
      set({ chats: res.chats, nextCursor: res.nextCursor })
    } catch (e) {
      set({ error: toErrorMessage(e) })
    }
  },

  async newChat() {
    if (!confirmDraftDiscard(get())) return
    await createFreshChat(set, get)
  },

  async openDefaultChat() {
    if (get().chatId || get().isOpeningDefaultChat) return
    set({ isOpeningDefaultChat: true, error: null })
    try {
      await createFreshChat(set, get)
    } finally {
      set({ isOpeningDefaultChat: false })
    }
  },

  resetSession() {
    get().clearDraft()
    set({
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
      ratings: {},
      versionsByBlock: {},
      isSending: false,
      isRefining: false,
      isCreatingBranch: false,
      isOpeningDefaultChat: false,
      highlightedBlockId: null,
      error: null,
      models: [],
      selectedModelId: null,
      webSearchEnabled: false,
      isModelListLoading: false,
      pendingByBlockId: {},
      failedJobsByBlockId: {},
    })
  },

  async loadInputAssist() {
    if (get().isModelListLoading || get().models.length) return
    set({ isModelListLoading: true })
    try {
      const models = await inputAssistApi.fetchModels()
      const selected = get().selectedModelId
      set({
        models,
        selectedModelId: selected && models.some((m) => m.modelId === selected)
          ? selected
          : (models.find((m) => m.isDefault)?.modelId ?? selected),
      })
    } catch (e) {
      set({ error: toErrorMessage(e) })
    } finally {
      set({ isModelListLoading: false })
    }
  },

  setDraftText(text) { set({ draftText: text }) },

  setSelectedModel(modelId) {
    const model = get().models.find((item) => item.modelId === modelId)
    set({ selectedModelId: modelId, webSearchEnabled: model?.supportsWebSearch ? get().webSearchEnabled : false })
  },

  setWebSearchEnabled(enabled) { set({ webSearchEnabled: enabled }) },

  async addFiles(files) {
    const { chatId } = get()
    if (!chatId) return
    const entries = files.map((file) => ({
      localId: crypto.randomUUID(), attachmentId: null, file, fileName: file.name,
      mimeType: file.type, localUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      status: 'uploading' as const, error: null,
    }))
    set((s) => ({ draftAttachments: [...s.draftAttachments, ...entries] }))
    await Promise.all(entries.map((entry) => get().uploadAttachment(entry.localId)))
  },

  async retryAttachment(localId) { await get().uploadAttachment(localId) },

  async uploadAttachment(localId) {
    const { chatId, draftAttachments } = get()
    const entry = draftAttachments.find((item) => item.localId === localId)
    if (!chatId || !entry) return
    set((s) => ({ draftAttachments: s.draftAttachments.map((item) => item.localId === localId ? { ...item, status: 'uploading', error: null } : item) }))
    try {
      const saved = await inputAssistApi.uploadAttachment(chatId, entry.file)
      set((s) => ({ draftAttachments: s.draftAttachments.map((item) => item.localId === localId ? { ...item, attachmentId: saved.attachmentId, mimeType: saved.mimeType, status: 'uploaded', error: null } : item) }))
    } catch (e) {
      set((s) => ({ draftAttachments: s.draftAttachments.map((item) => item.localId === localId ? { ...item, status: 'failed', error: toErrorMessage(e) } : item) }))
    }
  },

  async removeAttachment(localId) {
    const entry = get().draftAttachments.find((item) => item.localId === localId)
    if (!entry) return
    set((s) => ({ draftAttachments: s.draftAttachments.filter((item) => item.localId !== localId) }))
    if (entry.localUrl) URL.revokeObjectURL(entry.localUrl)
    if (!entry.attachmentId || !get().chatId) return
    try { await inputAssistApi.deleteAttachment(get().chatId!, entry.attachmentId) }
    catch (e) { set({ error: `${entry.fileName} 파일 삭제에 실패했습니다. ${toErrorMessage(e)}` }) }
  },

  clearDraft() {
    for (const item of get().draftAttachments) if (item.localUrl) URL.revokeObjectURL(item.localUrl)
    set({ draftText: '', draftAttachments: [] })
  },

  async openChat(chatId, branchId) {
    if (get().chatId !== chatId && !confirmDraftDiscard(get())) return
    try {
      if (get().chatId !== chatId) get().clearDraft()
      const detail = await chatApi.fetchChat(chatId, branchId)
      applyDetail(set, detail)
      await refreshFeedbacks(
        set,
        detail.chatMeta.chatId,
        detail.branchMeta.branchId,
        detail.messageBlocks,
      )
    } catch (e) {
      set({ error: toErrorMessage(e) })
    }
  },

  async switchBranch(branchId) {
    const { chatId } = get()
    if (!chatId) return
    if (get().branchId !== branchId && !confirmDraftDiscard(get())) return
    try {
      if (get().branchId !== branchId) get().clearDraft()
      const detail = await chatApi.fetchBranch(chatId, branchId)
      set({
        branchId: detail.branchMeta.branchId,
        blocks: detail.messageBlocks,
        sourceContext: detail.sourceContextInfo,
        // 브랜치가 바뀌면 이전 브랜치의 선택은 의미가 없다
        selectedBlockIds: [],
        failedJobsByBlockId: {},
        appliedBlockIds: [],
        refineJob: null,
        inlineView: {},
        ratings: {},
        versionsByBlock: {},
        branches: get().branches.map((b) => ({
          ...b,
          isActive: b.branchId === branchId,
        })),
      })
      await refreshFeedbacks(set, chatId, branchId, detail.messageBlocks)
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
    const { chatId, branchId, appliedBlockIds, selectedModelId, webSearchEnabled, draftAttachments } = get()
    if (!chatId || !branchId || !prompt.trim()) return
    if (draftAttachments.some((item) => item.status === 'uploading')) {
      set({ error: '파일 업로드가 끝난 뒤 전송할 수 있습니다.' })
      return
    }
    if (draftAttachments.some((item) => item.status === 'failed')) {
      set({ error: '업로드에 실패한 파일을 제거하거나 다시 시도해주세요.' })
      return
    }

    set({ isSending: true, error: null })
    try {
      const res = await convApi.sendMessage(
        chatId,
        branchId,
        prompt,
        appliedBlockIds,
        { selectedModelId, webSearchEnabled, attachmentIds: draftAttachments.flatMap((item) => item.attachmentId ? [item.attachmentId] : []) },
      )
      set((s) => ({
        blocks: [...s.blocks, res.userBlock, res.assistantBlock],
        chatTitle: res.chatTitle,
        // 한 번 쓴 Context 는 자동으로 해제한다. 남겨두면 다음 질문까지
        // 같은 맥락에 묶여, 사용자가 의도하지 않은 답이 나온다.
        appliedBlockIds: [],
        selectedBlockIds: [],
        failedJobsByBlockId: Object.fromEntries(Object.entries(s.failedJobsByBlockId).filter(([id]) => id !== res.userBlock.blockId)),
      }))
      get().clearDraft()
      if (res.titleGenerated) await get().loadChats()
    } catch (e) {
      if (openApiKeyWhenMissing(e)) {
        set({ error: null })
      } else {
        // 모델 호출 중 실패했다면 질문은 서버에 남아 있으므로 화면을 다시 맞춘다
        const detail = errorDetail<AiResponseFailureDetail>(e)
        await get().openChat(chatId, branchId)
        set((s) => ({ error: toErrorMessage(e), failedJobsByBlockId: detail?.retryable ? { ...s.failedJobsByBlockId, [detail.userMessageBlockId]: detail.aiResponseJobId } : s.failedJobsByBlockId }))
      }
    } finally {
      set({ isSending: false })
    }
  },

  async regenerate(blockId) {
    const { chatId, branchId } = get()
    if (!chatId || !branchId) return
    set((s) => ({ isSending: true, pendingByBlockId: { ...s.pendingByBlockId, [blockId]: true } }))
    try {
      const block = await convApi.regenerate(chatId, branchId, blockId)
      set((s) => ({
        blocks: s.blocks.map((b) =>
          b.blockId === blockId ? { ...b, ...block } : b,
        ),
      }))
      await get().loadVersions(blockId)
    } catch (e) {
      if (openApiKeyWhenMissing(e)) set({ error: null })
      else set({ error: toErrorMessage(e) })
    } finally {
      set((s) => { const pendingByBlockId = { ...s.pendingByBlockId }; delete pendingByBlockId[blockId]; return { isSending: false, pendingByBlockId } })
    }
  },

  async retryAiResponseJob(jobId) {
    const { chatId, branchId } = get()
    if (!chatId || !branchId) return
    set({ isSending: true, error: null })
    try {
      const result = await convApi.retryAiResponseJob(chatId, branchId, jobId)
      set((s) => ({ blocks: [...s.blocks, result.assistantBlock], chatTitle: result.chatTitle,
        failedJobsByBlockId: Object.fromEntries(Object.entries(s.failedJobsByBlockId).filter(([, id]) => id !== jobId)) }))
      await get().loadChats()
    } catch (e) { set({ error: toErrorMessage(e) }) }
    finally { set({ isSending: false }) }
  },

  async setFeedback(blockId, rating) {
    const { chatId, branchId, ratings } = get()
    if (!chatId || !branchId) return
    try {
      // 같은 버튼을 다시 누르면 평가를 해제한다.
      const nextRating = ratings[blockId] === rating ? null : rating
      const result = await convApi.setFeedback(chatId, branchId, blockId, nextRating)
      set((s) => ({
        ratings: { ...s.ratings, [blockId]: result.rating ?? undefined },
      }))
    } catch (e) {
      set({ error: toErrorMessage(e) })
    }
  },

  async loadVersions(blockId) {
    const { chatId, branchId } = get()
    if (!chatId || !branchId) return
    try {
      const versions = await convApi.fetchVersions(chatId, branchId, blockId)
      set((s) => ({
        versionsByBlock: { ...s.versionsByBlock, [blockId]: versions },
      }))
    } catch (e) {
      set({ error: toErrorMessage(e) })
    }
  },

  async setActiveVersion(blockId, versionId) {
    const { chatId, branchId } = get()
    if (!chatId || !branchId) return
    try {
      const block = await convApi.setActiveVersion(chatId, branchId, blockId, versionId)
      set((s) => ({
        blocks: s.blocks.map((item) =>
          item.blockId === blockId ? { ...item, ...block } : item,
        ),
        versionsByBlock: {
          ...s.versionsByBlock,
          [blockId]: (s.versionsByBlock[blockId] ?? []).map((version) => ({
            ...version,
            isCurrent: version.versionId === versionId,
          })),
        },
      }))
    } catch (e) {
      set({ error: toErrorMessage(e) })
    }
  },

  async editBlock(blockId, content) {
    const { chatId, branchId } = get()
    if (!chatId || !branchId || !content.trim()) return false
    try {
      const block = await convApi.editBlock(chatId, branchId, blockId, content)
      set((s) => ({ blocks: s.blocks.map((item) => item.blockId === blockId ? { ...item, ...block } : item) }))
      await get().loadVersions(blockId)
      return true
    } catch (e) { set({ error: toErrorMessage(e) }); return false }
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
      if (openApiKeyWhenMissing(e)) set({ error: null })
      else set({ error: toErrorMessage(e) })
    } finally {
      set({ isRefining: false })
    }
  },

  async approveResult(resultId) {
    const { chatId, branchId, refineJob } = get()
    if (!chatId || !branchId || !refineJob) return
    try {
      // 승인은 블록의 활성 버전을 바꾸므로 블록 목록을 다시 받아온다
      const updated = await convApi.approveResult(
        chatId,
        branchId,
        refineJob.refineJobId,
        resultId,
      )
      const detail = await chatApi.fetchChat(chatId, branchId)
      set((s) => ({
        blocks: detail.messageBlocks,
        refineJob: s.refineJob && {
          ...s.refineJob,
          results: s.refineJob.results.map((r) => (r.resultId === resultId ? updated : r)),
        },
      }))
    } catch (e) {
      set({ error: toErrorMessage(e) })
    }
  },

  async rejectResult(resultId) {
    const { chatId, branchId, refineJob } = get()
    if (!chatId || !branchId || !refineJob) return
    try {
      // 거절은 블록 내용을 바꾸지 않으므로 결과 상태만 반영한다
      const updated = await convApi.rejectResult(chatId, branchId, refineJob.refineJobId, resultId)
      set((s) => ({
        refineJob: s.refineJob && {
          ...s.refineJob,
          results: s.refineJob.results.map((r) => (r.resultId === resultId ? updated : r)),
        },
      }))
    } catch (e) {
      set({ error: toErrorMessage(e) })
    }
  },

  async approveAll() {
    const { chatId, branchId, refineJob } = get()
    if (!chatId || !branchId || !refineJob) return
    try {
      const { processed, failed } = await convApi.approveAll(
        chatId,
        branchId,
        refineJob.refineJobId,
      )
      const detail = await chatApi.fetchChat(chatId, branchId)
      const processedById = new Map(processed.map((r) => [r.resultId, r]))
      set((s) => ({
        blocks: detail.messageBlocks,
        refineJob: s.refineJob && {
          ...s.refineJob,
          results: s.refineJob.results.map((r) => processedById.get(r.resultId) ?? r),
        },
        error:
          failed.length > 0
            ? `${failed.length}개 블록은 승인에 실패했습니다. 나머지 항목에서 다시 시도해주세요.`
            : s.error,
      }))
    } catch (e) {
      set({ error: toErrorMessage(e) })
    }
  },

  async rejectAll() {
    const { chatId, branchId, refineJob } = get()
    if (!chatId || !branchId || !refineJob) return
    try {
      const { processed, failed } = await convApi.rejectAll(chatId, branchId, refineJob.refineJobId)
      const byId = new Map(processed.map((item) => [item.resultId, item]))
      set((s) => ({ refineJob: s.refineJob && { ...s.refineJob, results: s.refineJob.results.map((item) => byId.get(item.resultId) ?? item) }, error: failed.length ? `${failed.length}개 항목을 거절하지 못했습니다.` : s.error }))
    } catch (e) { set({ error: toErrorMessage(e) }) }
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

  async createBranch(name, baseBlockId, contextBlockIds, editedBaseContent) {
    const { chatId, branchId } = get()
    if (!chatId || !branchId) return false

    set({ isCreatingBranch: true, error: null })
    try {
      const created = await chatApi.createBranch(chatId, {
        branchName: name,
        baseBranchId: branchId,
        baseMessageBlockId: baseBlockId,
        contextBlockIds,
        editedBaseContent,
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

async function createFreshChat(
  set: (partial: Partial<ChatState>) => void,
  get: () => ChatState,
) {
  try {
    get().clearDraft()
    applyDetail(set, await chatApi.createChat())
    set({ focusSignal: get().focusSignal + 1 })
    await get().loadChats()
  } catch (e) {
    set({ error: toErrorMessage(e) })
  }
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
    ratings: {},
    versionsByBlock: {},
    error: null,
    draftText: '',
    draftAttachments: [],
    pendingByBlockId: {},
    failedJobsByBlockId: {},
  })
}

async function refreshFeedbacks(
  set: (partial: Partial<ChatState>) => void,
  chatId: string,
  branchId: string,
  blocks: MessageBlock[],
) {
  const assistantBlocks = blocks.filter((block) => block.role === 'assistant')
  const results = await Promise.all(
    assistantBlocks.map((block) =>
      convApi.fetchFeedback(chatId, branchId, block.blockId),
    ),
  )
  set({
    ratings: Object.fromEntries(
      results.flatMap((result) =>
        result.rating ? [[result.aiMessageBlockId, result.rating] as const] : [],
      ),
    ),
  })
}

function openApiKeyWhenMissing(error: unknown): boolean {
  if (errorCode(error) !== 'API_KEY_NOT_REGISTERED') return false
  useSettingsStore
    .getState()
    .openApiKey('AI 기능을 사용하려면 먼저 Google AI API 키를 등록해주세요.')
  return true
}

function confirmDraftDiscard(state: ChatState): boolean {
  if (!state.draftText.trim() && state.draftAttachments.length === 0) return true
  return window.confirm('전송하지 않은 입력과 첨부 파일이 있습니다. 이동하면 입력 내용이 사라집니다.')
}
