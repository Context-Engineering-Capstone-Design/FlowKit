import { create } from 'zustand'
import * as chatApi from '@/api/chat'
import { errorCode, errorDetail, toErrorMessage } from '@/api/client'
import * as convApi from '@/api/conversation'
import * as inputAssistApi from '@/api/inputAssist'
import * as realtimeApi from '@/api/realtime'
import * as sideChatApi from '@/api/sideChat'
import { useSettingsStore } from '@/store/settingsStore'
import { useNotificationStore } from '@/store/notificationStore'
import { useConfirmStore } from '@/store/confirmStore'
import { withRequestTimeout } from '@/lib/requestTimeout'
import { validateAttachment } from '@/lib/attachmentValidation'
import type {
  AiResponseRating,
  AppliedContextOut,
  BranchListItem,
  ChatDetail,
  ChatKind,
  ChatMeta,
  ChatSummary,
  ContextRangeIn,
  MessageBlock,
  MessageRole,
  RefineJob,
  SideChatSummary,
  SourceContextItem,
  VersionItem,
  DraftAttachment,
  ModelOption,
  AiResponseFailureDetail,
  ReasoningEffort,
  SearchSource,
  WebSearchMode,
} from '@/types/api'

/** 열려 있는 채팅 탭 하나. 실제 대화 내용은 활성 탭일 때만 아래 singleton 필드에 채워진다.
 *  비활성 탭은 다시 활성화될 때까지 이 캐시된 값만으로 표시된다 (0820_08 B1). */
export interface ChatTab {
  /** 탭을 구분하는 키. 실제 채팅이면 chatId와 같고, 첫 메시지를 보내기 전 임시 탭이면 `draft:...`. */
  id: string
  chatId: string | null
  branchId: string | null
  title: string
  kind: ChatKind
  parentChatId: string | null
  isTemporary?: boolean
  /** 아직 서버에 만들지 않은 사이드 채팅 탭이 어디서 시작됐는지 (0820_13 C1).
   *  이 값이 있으면 첫 전송 때 채팅이 아니라 사이드 채팅으로 만든다. */
  draftSideChatAnchor?: { parentChatId: string; parentBranchId: string; anchorMessageBlockId?: string } | null
}

/** 한 메시지 안에서 드래그로 고른 부분 범위 태그 (0820_13). 하단 채팅 패널에 표시하고
 *  전송 시 Context로 보낸다. 원문이 나중에 바뀌어도 이 스냅샷 기준을 유지한다. */
export interface ContextRangeTag {
  id: string
  messageBlockId: string
  messageVersionId: string
  role: MessageRole
  /** 선택 당시 메시지 전체의 평면 텍스트 스냅샷. 태그 호버 강조의 기준이 된다. */
  snapshotText: string
  /** 실제로 고른 부분 (snapshotText.slice(startOffset, endOffset)과 같다). */
  selectedText: string
  startOffset: number
  endOffset: number
}

function newDraftId() {
  return `draft:${crypto.randomUUID()}`
}

let latestChatListRequestId: string | null = null
let latestChatMoreRequestId: string | null = null
let chatStatusPoll: ReturnType<typeof setInterval> | null = null

let chatsRefreshTimer: ReturnType<typeof setTimeout> | null = null
const CHATS_REFRESH_COALESCE_MS = 300

/**
 * 새 대화 생성·전송 완료·실시간 이벤트처럼 화면 밖에서 오는 신호로 채팅 목록을
 * 다시 불러올 때 쓴다. 메시지 하나를 보내고 응답을 받는 사이 이런 신호가 여러
 * 곳에서 거의 동시에 겹쳐 들어오는데, 신호마다 바로 불러오면 짧은 시간에 목록이
 * 여러 번 다시 그려져 화면이 깜빡인다. 짧은 시간 안에 겹친 신호는 하나로 합친다.
 */
function scheduleChatsRefresh(get: () => ChatState) {
  if (chatsRefreshTimer) return
  chatsRefreshTimer = setTimeout(() => {
    chatsRefreshTimer = null
    void get().loadChats(get().chatListKeyword || undefined)
  }, CHATS_REFRESH_COALESCE_MS)
}

function uniqueChats(chats: ChatSummary[]): ChatSummary[] {
  const seenChatIds = new Set<string>()
  return chats.filter((chat) => {
    if (seenChatIds.has(chat.chatId)) return false
    seenChatIds.add(chat.chatId)
    return true
  })
}

// 0821_05: 실시간 이벤트 채널이 주 경로다. 이 폴링은 연결이 끊겼다가 재연결
// 전까지 이벤트를 놓쳤을 때만 의미가 있는 안전망이라 간격을 크게 늘렸다.
const CHAT_STATUS_POLL_INTERVAL_MS = 60_000

function syncChatStatusPolling(get: () => ChatState) {
  const shouldPoll = get().chats.some((chat) => chat.isGenerating)
  if (shouldPoll && chatStatusPoll === null) {
    chatStatusPoll = setInterval(() => void get().loadChats(get().chatListKeyword || undefined), CHAT_STATUS_POLL_INTERVAL_MS)
  } else if (!shouldPoll && chatStatusPoll !== null) {
    clearInterval(chatStatusPoll)
    chatStatusPoll = null
  }
}

// 답변 블록별로 지금 붙어 있는 스트리밍 연결. AbortController는 직렬화할 수
// 없는 값이라 Zustand 상태 밖(모듈 스코프)에 둔다 .
const activeStreams = new Map<string, AbortController>()
const TEMPORARY_CHAT_STORAGE_KEY = 'flowkit:temporary-chat-ids'

/** 어느 패널에서 파생해도 새 사이드 대화는 우측 패널로 보낸다. */
let openSidePanel: ((chatId: string, branchId?: string) => Promise<void>) | null = null
export function setSidePanelOpener(opener: typeof openSidePanel) { openSidePanel = opener }
export async function openChatInSidePanel(chatId: string, branchId?: string) {
  if (openSidePanel) await openSidePanel(chatId, branchId)
}

async function refreshMainSideChatTree() {
  await useChatStore.getState().loadSideChatContext()
}

function temporaryChatIds(): string[] {
  try { return JSON.parse(sessionStorage.getItem(TEMPORARY_CHAT_STORAGE_KEY) ?? '[]') } catch { return [] }
}

function rememberTemporaryChat(chatId: string) {
  try { sessionStorage.setItem(TEMPORARY_CHAT_STORAGE_KEY, JSON.stringify([...new Set([...temporaryChatIds(), chatId])])) } catch {}
}

function forgetTemporaryChat(chatId: string) {
  try { sessionStorage.setItem(TEMPORARY_CHAT_STORAGE_KEY, JSON.stringify(temporaryChatIds().filter((id) => id !== chatId))) } catch {}
}

function stopStream(blockId: string) {
  activeStreams.get(blockId)?.abort()
  activeStreams.delete(blockId)
}

// 0820_06 마일스톤 C: 작업별 화면 전달 시간 측정값. 질문·답변 본문은 담지
// 않는다 — 시각과 재접속 횟수만 모아뒀다가 끝날 때 한 번에 보낸다.
interface DeliveryDraft {
  clickedAt?: number
  blockShownAt?: number
  streamConnectedAt?: number
  firstChunkShownAt?: number
  reconnectCount: number
}
const deliveryDrafts = new Map<string, DeliveryDraft>()

function beginDelivery(jobId: string, clickedAt?: number) {
  deliveryDrafts.set(jobId, { clickedAt, blockShownAt: Date.now(), reconnectCount: 0 })
}

function flushDeliveryTiming(
  chatId: string,
  branchId: string,
  jobId: string,
  finalOutcome: convApi.DeliveryOutcome,
) {
  const draft = deliveryDrafts.get(jobId)
  if (!draft) return // 이미 보냈거나 측정을 시작하지 않은 작업(예: 재접속 실패 후 중복 호출)
  deliveryDrafts.delete(jobId)
  const iso = (ms?: number) => (ms ? new Date(ms).toISOString() : null)
  void convApi
    .sendDeliveryTiming(chatId, branchId, jobId, {
      clickedAt: iso(draft.clickedAt),
      blockShownAt: iso(draft.blockShownAt),
      streamConnectedAt: iso(draft.streamConnectedAt),
      firstChunkShownAt: iso(draft.firstChunkShownAt),
      doneAt: new Date().toISOString(),
      reconnectCount: draft.reconnectCount,
      finalOutcome,
    })
    .catch(() => {}) // 개발·운영 조회용 신호라 실패해도 화면 흐름을 막지 않는다
}

// 목록 조회에 실패했을 때 보여줄 기본 모델 . 서버 목록과 어긋나면
// 전송 시점에 서버가 오류로 안내하므로 조용히 잘못된 모델로 보내지 않는다.
const FALLBACK_MODEL: ModelOption = {
  modelId: 'gpt-5.6-luna',
  displayName: 'Luna',
  provider: 'openai',
  supportsWebSearch: true,
  supportsAttachment: true,
  isDefault: true,
  isAvailable: true,
  description: '일반 채팅에 쓰는 균형 잡힌 기본 모델',
  tags: ['기본', '균형'],
}

export interface ChatState {
  chats: ChatSummary[]
  nextCursor: string | null
  isLoadingChats: boolean
  isLoadingMoreChats: boolean
  chatListError: string | null
  chatListKeyword: string

  chatId: string | null
  projectId: string | null
  chatTitle: string
  branchId: string | null
  branches: BranchListItem[]
  blocks: MessageBlock[]
  sourceContext: SourceContextItem[]

  /** 지금 열린 채팅의 사이드 채팅 트리 관계 (0820_08 A1, C1~C3). 메인 채팅이면 kind만 채워진다. */
  chatKind: ChatKind
  parentChatId: string | null
  parentBranchId: string | null
  parentMessageBlockId: string | null
  rootChatId: string | null
  rootBranchId: string | null
  isTemporary: boolean

  /** 열려 있는 메인·사이드 채팅 탭 (0820_08 B1). 메인·사이드는 동등한 탭이다. */
  tabs: ChatTab[]
  activeTabId: string | null
  /** 현재 열린 채팅·브랜치 흐름 중, 그 지점에서 만들어진 사이드 채팅 (blockId로 묶음, B4). */
  sideChatsByBlockId: Record<string, SideChatSummary[]>
  /** 좌측 트리 패널에 쓸, 현재 루트 메인 채팅 아래 전체 사이드 채팅 . */
  sideChatTree: SideChatSummary[]
  sideChatTreeRootId: string | null
  isCreatingSideChat: boolean

  /** 사용자가 Context 로 쓰려고 고른 블록. 전송 전까지는 화면 상태로만 둔다. */
  selectedBlockIds: string[]
  /** 전송 시 실제로 적용할 Context. 정제 승인 후 확정된다. */
  appliedBlockIds: string[]
  appliedContextLabel: string | null

  /** 드래그로 고른 부분 범위 태그 (0820_13). 전송하면 비워진다. */
  contextRangeTags: ContextRangeTag[]
  /** 드래그 범위 토글에서 연 단일 블록 정제 대상. */
  refineTargetBlockId: string | null

  refineJob: RefineJob | null
  /** 블록별로 원본을 보는 중인지 정제본을 보는 중인지  */
  inlineView: Record<string, 'original' | 'refined'>
  /** 서버에 저장된 현재 사용자의 AI 답변 평가 상태. */
  ratings: Record<string, AiResponseRating | undefined>
  versionsByBlock: Record<string, VersionItem[] | undefined>

  isSending: boolean
  isRefining: boolean
  lastRefineInstruction: string | null
  refineFailed: boolean
  isCreatingBranch: boolean
  deletingChatId: string | null
  error: string | null
  /** 값이 바뀔 때마다 입력창에 포커스를 옮긴다  */
  focusSignal: number

  draftText: string
  selectedModelId: string | null
  webSearchMode: WebSearchMode
  reasoningEffort: ReasoningEffort
  draftAttachments: DraftAttachment[]
  selectedLibraryResourceIds: string[]
  models: ModelOption[]
  isModelListLoading: boolean
  pendingByBlockId: Record<string, boolean>
  failedJobsByBlockId: Record<string, string>
  /** 패널을 닫았다 열어도 유지되는 Context 정제 지시문. */
  contextInstruction: string
  contextInstructionFocusSignal: number
  contextPanelSignal: number
  branchDraft: {
    baseBlockId: string
    contextBlockIds: string[]
    editedBaseContent?: string
    sourceMode: 'header' | 'block' | 'edited-block'
  } | null
  branchError: string | null
  editingBlockId: string | null
  editingDraft: string
  editingOriginal: string
  /** 수정 중인 메시지 버전에 붙일 범위 태그. 새 질문 태그와 분리한다. */
  editingContextTags: ContextRangeTag[]
  isSavingEdit: boolean
  sourceNavigationError: string | null

  loadChats: (keyword?: string) => Promise<void>
  loadMoreChats: () => Promise<void>
  newChat: (projectId?: string) => Promise<void>
  /** 로그인·새로고침 후 작업 화면에 들어오면 바로 빈 대화를 연다. */
  openDefaultChat: () => Promise<void>
  /** 로그아웃·세션 만료 때 이전 사용자의 대화 상태를 비운다. */
  resetSession: () => void
  openChat: (chatId: string, branchId?: string) => Promise<void>
  deleteChat: (chatId: string) => Promise<void>
  /** 대화 이름을 사용자가 직접 입력한 값으로 바꾼다 . */
  renameChat: (chatId: string, title: string) => Promise<boolean>
  switchBranch: (branchId: string) => Promise<boolean>
  toggleBlock: (blockId: string) => void
  clearSelection: () => void
  sendMessage: (prompt: string) => Promise<void>
  regenerate: (blockId: string) => Promise<void>
  /** 스트리밍 통로에 (다시) 붙어, 도착하는 조각으로 블록을 채워간다 (, 006). */
  attachToJob: (blockId: string, jobId: string, clickedAt?: number) => Promise<void>
  /** 열린 블록 중 아직 생성 중인 것에 자동으로 다시 붙는다 (새로고침·브랜치 재진입, C6). */
  reattachGeneratingBlocks: () => void
  /** 생성을 중단한다. 그때까지의 본문은 남는다 . */
  cancelGeneration: (blockId: string) => Promise<void>
  setFeedback: (blockId: string, rating: AiResponseRating) => Promise<void>
  loadVersions: (blockId: string) => Promise<void>
  setActiveVersion: (blockId: string, versionId: string) => Promise<void>
  editBlock: (blockId: string, content: string) => Promise<boolean>
  startEdit: (blockId: string, content: string) => Promise<void>
  setEditingDraft: (content: string) => void
  cancelEdit: () => void
  runRefine: (instruction: string) => Promise<void>
  retryRefine: () => Promise<void>
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
  createBranchAt: (baseBlockId: string) => Promise<boolean>
  /** Context pill 을 눌렀을 때 원본 블록 위치로 이동한다  */
  jumpToSource: (item: SourceContextItem) => Promise<void>
  /** 전송된 인용 태그를 눌렀을 때 원본 블록 위치로 이동하고 스니펫을 강조한다 (0821_10) */
  jumpToAppliedContext: (item: AppliedContextOut) => void
  highlightedBlockId: string | null
  highlightedRange: { blockId: string; versionId: string; startOffset: number; endOffset: number } | null
  applyContext: () => void
  clearAppliedContext: () => void
  dismissError: () => void
  loadInputAssist: () => Promise<void>
  setDraftText: (text: string) => void
  setSelectedModel: (modelId: string) => void
  setWebSearchMode: (mode: WebSearchMode) => void
  setReasoningEffort: (effort: ReasoningEffort) => void
  setSelectedLibraryResourceIds: (resourceIds: string[]) => void
  addFiles: (files: File[]) => Promise<void>
  removeAttachment: (localId: string) => Promise<void>
  retryAttachment: (localId: string) => Promise<void>
  uploadAttachment: (localId: string) => Promise<void>
  clearDraft: () => void
  retryAiResponseJob: (jobId: string) => Promise<void>
  setContextInstruction: (instruction: string) => void
  focusContextInstruction: () => void
  openBranchModal: (baseBlockId: string, editedBaseContent?: string, sourceMode?: 'header' | 'block' | 'edited-block') => void
  closeBranchModal: () => void
  openContextEditor: (blockId: string) => void
  openRefine: (blockId: string) => void
  clearSourceNavigationError: () => void

  /** 탭 바에서 다른 탭을 눌렀을 때 그 탭으로 전환한다 (0820_08 B1). */
  switchTab: (id: string) => Promise<void>
  /** 탭을 닫는다. 활성 탭을 닫으면 옆 탭 또는 새 임시 탭으로 옮겨간다. */
  closeTab: (id: string) => Promise<void>
  /** 주어진 탭(없으면 새 임시 탭)으로 화면을 옮긴다. 이미 확인이 끝난 뒤에만 부른다. */
  switchToTabOrDraft: (tab: ChatTab | null) => Promise<void>
  /** 현재 탭의 지점(anchor)에서 자식 사이드 채팅을 만들고 새 탭으로 연다 . */
  createSideChatTab: (anchorMessageBlockId?: string, title?: string, isTemporary?: boolean) => Promise<void>
  /** 지금 보이는 채팅·브랜치 기준으로 사이드 채팅 북마크·트리를 다시 불러온다. */
  loadSideChatContext: () => Promise<void>

  /** 선택한 사이드 채팅 블록을 부모 채팅으로 옮겨 다음 질문의 Context 로 적용한다 (0820_08 C1). */
  sendSelectedToParentAsContext: () => Promise<boolean>
  /** 선택한 사이드 채팅 블록을 부모 채팅 메시지로 실제로 복사해 가져온다 (0820_08 C2). */
  importSelectedToParentAsMessages: () => Promise<boolean>
  /** 사이드 채팅과 같은 지점에서 부모 아래 형제 브랜치를 만든다 (0820_08 C3). */
  createSiblingBranchFromSideChat: (branchName: string, editedBaseContent: string) => Promise<boolean>

  /** 드래그로 고른 범위를 하단 채팅 패널의 태그로 추가한다 (0820_13 A3, B1). */
  addContextRangeTag: (tag: Omit<ContextRangeTag, 'id'>) => void
  /** 태그를 제거한다 — 태그의 X 버튼, 또는 메시지 안 강조 표시를 다시 눌렀을 때 쓴다. */
  removeContextRangeTag: (id: string) => void
  removeEditingContextTag: (id: string) => void
  /** 선택 범위 태그를 포함한 빈 사이드 채팅 패널을 로컬로 연다. 첫 메시지를 보낼 때까지는
   *  서버에 아무 것도 만들지 않는다 (0820_13 C1, C2). */
  openDraftSideChatWithRange: (tag: Omit<ContextRangeTag, 'id'>) => Promise<void>
}

export interface ChatStoreOptions {
  /** 마지막 탭을 닫았을 때 패널을 접는 등, 화면 구조만 담당하는 콜백. */
  onEmptyTabs?: () => void
}

/** 패널마다 완전히 독립된 대화 상태를 만든다. */
export function createChatStore(options: ChatStoreOptions = {}) {
  return create<ChatState>((set, get) => ({
  chats: [],
  nextCursor: null,
  isLoadingChats: false,
  isLoadingMoreChats: false,
  chatListError: null,
  chatListKeyword: '',
  chatId: null,
  projectId: null,
  chatTitle: '',
  branchId: null,
  branches: [],
  blocks: [],
  sourceContext: [],
  chatKind: 'MAIN',
  parentChatId: null,
  parentBranchId: null,
  parentMessageBlockId: null,
  rootChatId: null,
  rootBranchId: null,
  isTemporary: false,
  tabs: [],
  activeTabId: null,
  sideChatsByBlockId: {},
  sideChatTree: [],
  sideChatTreeRootId: null,
  isCreatingSideChat: false,
  selectedBlockIds: [],
  appliedBlockIds: [],
  appliedContextLabel: null,
  contextRangeTags: [],
  refineTargetBlockId: null,
  refineJob: null,
  inlineView: {},
  ratings: {},
  versionsByBlock: {},
  isSending: false,
  isRefining: false,
  lastRefineInstruction: null,
  refineFailed: false,
  isCreatingBranch: false,
  deletingChatId: null,
  highlightedBlockId: null,
  highlightedRange: null,
  error: null,
  focusSignal: 0,
  draftText: '',
  selectedModelId: null,
  webSearchMode: 'auto',
  reasoningEffort: 'medium',
  draftAttachments: [],
  selectedLibraryResourceIds: [],
  models: [],
  isModelListLoading: false,
  pendingByBlockId: {},
  failedJobsByBlockId: {},
  contextInstruction: '',
  contextInstructionFocusSignal: 0,
  contextPanelSignal: 0,
  branchDraft: null,
  branchError: null,
  editingBlockId: null,
  editingDraft: '',
  editingOriginal: '',
  editingContextTags: [],
  isSavingEdit: false,
  sourceNavigationError: null,

  async loadChats(keyword) {
    const normalizedKeyword = keyword?.trim() || undefined
    latestChatMoreRequestId = null
    set({ isLoadingChats: true, isLoadingMoreChats: false, chatListError: null })
    let requestId: string | null = null
    try {
      const res = await withRequestTimeout(async ({ signal, requestId: id }) => {
        requestId = id
        latestChatListRequestId = id
        const result = await chatApi.fetchChats(
          { keyword: normalizedKeyword, limit: 10 },
          signal,
        )
        return { result, requestId: id }
      })
      if (latestChatListRequestId !== res.requestId) return
      useNotificationStore.getState().dismissBanner('chat-list')
      set({ chats: uniqueChats(res.result.chats), nextCursor: res.result.nextCursor, chatListKeyword: normalizedKeyword ?? '' })
      syncChatStatusPolling(get)
    } catch (e) {
      if (requestId && latestChatListRequestId !== requestId) return
      set({ chatListError: toErrorMessage(e) })
      showChatError(e, 'chat-list', () => void get().loadChats(normalizedKeyword))
    } finally {
      if (!requestId || latestChatListRequestId === requestId) {
        set({ isLoadingChats: false })
      }
    }
  },

  async loadMoreChats() {
    const { nextCursor, isLoadingChats, isLoadingMoreChats, chatListKeyword } = get()
    if (!nextCursor || isLoadingChats || isLoadingMoreChats) return
    set({ isLoadingMoreChats: true, chatListError: null })
    let requestId: string | null = null
    try {
      const res = await withRequestTimeout(async ({ signal, requestId: id }) => {
        requestId = id
        latestChatMoreRequestId = id
        const result = await chatApi.fetchChats(
          { cursor: nextCursor, keyword: chatListKeyword || undefined, limit: 10 },
          signal,
        )
        return { result, requestId: id }
      })
      if (latestChatMoreRequestId !== res.requestId) return
      useNotificationStore.getState().dismissBanner('chat-list')
      set((s) => ({
        chats: [...s.chats, ...res.result.chats.filter((item) => !s.chats.some((chat) => chat.chatId === item.chatId))],
        nextCursor: res.result.nextCursor,
      }))
      syncChatStatusPolling(get)
    } catch (e) {
      if (requestId && latestChatMoreRequestId !== requestId) return
      set({ chatListError: toErrorMessage(e) })
      showChatError(e, 'chat-list', () => void get().loadMoreChats())
    } finally {
      if (!requestId || latestChatMoreRequestId === requestId) {
        set({ isLoadingMoreChats: false })
      }
    }
  },

  async newChat(projectId) {
    if (!(await confirmPendingDiscard(get()))) return
    if (projectId) {
      try {
        const created = await chatApi.createChat(projectId)
        captureActiveTabSnapshot(set, get)
        applyDetail(set, created)
        upsertTab(set, get, created.chatMeta, created.branchMeta.branchId)
        scheduleChatsRefresh(get)
      } catch (e) { set({ error: toErrorMessage(e) }) }
      return
    }
    captureActiveTabSnapshot(set, get)
    resetToDraft(set, get, newDraftId())
  },

  async openDefaultChat() {
    // 새로고침 뒤에도 열려 있던 탭 목록은 세션 상태라 유지하지 않는다 — 탭이 하나도
    // 없을 때만 빈 대화 탭 하나를 만든다.
    const staleTemporaryIds = temporaryChatIds()
    if (staleTemporaryIds.length) {
      await Promise.all(staleTemporaryIds.map((chatId) => chatApi.deleteChat(chatId).catch(() => undefined)))
      try { sessionStorage.removeItem(TEMPORARY_CHAT_STORAGE_KEY) } catch {}
    }
    if (get().tabs.length > 0) return
    resetToDraft(set, get, newDraftId())
  },

  resetSession() {
    get().clearDraft()
    set({
      chats: [],
      nextCursor: null,
      chatId: null,
      projectId: null,
      chatTitle: '',
      branchId: null,
      branches: [],
      blocks: [],
      sourceContext: [],
      tabs: [],
      activeTabId: null,
      sideChatsByBlockId: {},
      sideChatTree: [],
      sideChatTreeRootId: null,
      isCreatingSideChat: false,
      selectedBlockIds: [],
      appliedBlockIds: [],
      appliedContextLabel: null,
      contextRangeTags: [],
      refineJob: null,
      inlineView: {},
      ratings: {},
      versionsByBlock: {},
      isSending: false,
      isRefining: false,
      lastRefineInstruction: null,
      refineFailed: false,
      isCreatingBranch: false,
      deletingChatId: null,
      highlightedBlockId: null,
      highlightedRange: null,
      error: null,
      models: [],
      selectedModelId: null,
      webSearchMode: 'auto',
      reasoningEffort: 'medium',
      isModelListLoading: false,
      pendingByBlockId: {},
      failedJobsByBlockId: {},
      contextInstruction: '',
      contextInstructionFocusSignal: 0,
      contextPanelSignal: 0,
      branchDraft: null,
      branchError: null,
      editingBlockId: null,
      editingDraft: '',
      editingOriginal: '',
      editingContextTags: [],
      isSavingEdit: false,
      sourceNavigationError: null,
      chatListError: null,
      chatListKeyword: '',
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
      const selected = get().selectedModelId
      set({
        models: [FALLBACK_MODEL],
        selectedModelId: selected ?? FALLBACK_MODEL.modelId,
        error: toErrorMessage(e),
      })
    } finally {
      set({ isModelListLoading: false })
    }
  },

  setDraftText(text) { set({ draftText: text }) },

  setContextInstruction(instruction) { set({ contextInstruction: instruction.slice(0, 2000) }) },
  focusContextInstruction() { set((s) => ({ contextInstructionFocusSignal: s.contextInstructionFocusSignal + 1 })) },
  openBranchModal(baseBlockId, editedBaseContent, sourceMode) {
    useNotificationStore.getState().dismissBanner('branch')
    set((state) => ({
      branchDraft: {
        baseBlockId,
        contextBlockIds: [...state.selectedBlockIds],
        editedBaseContent,
        sourceMode: sourceMode ?? (editedBaseContent === undefined ? 'block' : 'edited-block'),
      },
      branchError: null,
    }))
  },
  closeBranchModal() {
    useNotificationStore.getState().dismissBanner('branch')
    set({ branchDraft: null, branchError: null })
  },
  openContextEditor(blockId) {
    set((s) => ({
      selectedBlockIds: s.selectedBlockIds.includes(blockId)
        ? s.selectedBlockIds
        : [...s.selectedBlockIds, blockId],
      contextPanelSignal: s.contextPanelSignal + 1,
      contextInstructionFocusSignal: s.contextInstructionFocusSignal + 1,
    }))
  },
  openRefine(blockId) {
    set((s) => ({ refineTargetBlockId: blockId, contextPanelSignal: s.contextPanelSignal + 1, contextInstructionFocusSignal: s.contextInstructionFocusSignal + 1 }))
  },

  setSelectedModel(modelId) {
    const model = get().models.find((item) => item.modelId === modelId)
    set({ selectedModelId: modelId, webSearchMode: model?.supportsWebSearch ? get().webSearchMode : 'off' })
  },

  setWebSearchMode(mode) { set({ webSearchMode: mode }) },
  setReasoningEffort(effort) { set({ reasoningEffort: effort }) },
  setSelectedLibraryResourceIds(resourceIds) { set({ selectedLibraryResourceIds: resourceIds }) },

  async addFiles(files) {
    const rejected = files
      .map((file) => ({ file, reason: validateAttachment(file) }))
      .filter((item): item is { file: File; reason: string } => Boolean(item.reason))
    if (rejected.length) {
      useNotificationStore.getState().show(
        rejected.map((item) => item.file.name + ': ' + item.reason).join(' '),
        'error',
      )
    }
    const validFiles = files.filter((file) => !validateAttachment(file))
    if (!validFiles.length) return
    // 새 대화에서 붙여넣기·드래그로 첫 파일을 올리는 경우, 첫 메시지 전송과 같은 방식으로
    // 채팅을 먼저 만든다. 잘못된 파일만 왔을 때는 채팅을 만들지 않는다(위에서 이미 걸러졌다).
    // 이미 채팅이 있으면 await 을 타지 않는다.
    if (!get().chatId && !(await ensureChat(set, get))) return
    const entries = validFiles.map((file) => ({
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
    if (get().chatId !== chatId && !(await confirmPendingDiscard(get()))) return
    try {
      if (get().chatId !== chatId) {
        captureActiveTabSnapshot(set, get)
        get().clearDraft()
      }
      const detail = await chatApi.fetchChat(chatId, branchId)
      applyDetail(set, detail)
      upsertTab(set, get, detail.chatMeta, detail.branchMeta.branchId)
      get().reattachGeneratingBlocks()
      void get().loadSideChatContext()
      await refreshFeedbacks(
        set,
        detail.chatMeta.chatId,
        detail.branchMeta.branchId,
        detail.messageBlocks,
      )
    } catch (e) {
      if (errorCode(e) === 'CHAT_ACCESS_DENIED' || errorCode(e) === 'CHAT_NOT_FOUND') {
        set((s) => ({ chats: s.chats.filter((item) => item.chatId !== chatId), error: toErrorMessage(e) }))
      } else {
        set({ error: toErrorMessage(e) })
      }
    }
  },

  async deleteChat(chatId) {
    if (get().deletingChatId) return
    const title =
      get().chats.find((item) => item.chatId === chatId)?.title ??
      get().sideChatTree.find((item) => item.chatId === chatId)?.title ??
      get().tabs.find((item) => item.chatId === chatId)?.title ??
      '이 대화'
    const confirmed = await useConfirmStore.getState().request(
      `"${title}" 대화를 삭제할까요? 삭제한 뒤에는 되돌릴 수 없습니다.`,
      { confirmLabel: '삭제' },
    )
    if (!confirmed) return

    const wasCurrent = get().chatId === chatId
    set({ deletingChatId: chatId })
    try {
      const result = await chatApi.deleteChat(chatId)
      set((s) => ({
        chats: s.chats.filter((item) => item.chatId !== chatId),
        tabs: s.tabs.filter((t) => t.chatId !== chatId),
      }))
      useNotificationStore.getState().showAction(result.actionMeta)
      if (wasCurrent) await get().switchToTabOrDraft(get().tabs[0] ?? null)
      else void get().loadSideChatContext()
    } catch (e) {
      if (errorCode(e) === 'CHAT_ACCESS_DENIED' || errorCode(e) === 'CHAT_NOT_FOUND') {
        set((s) => ({
          chats: s.chats.filter((item) => item.chatId !== chatId),
          tabs: s.tabs.filter((t) => t.chatId !== chatId),
        }))
        if (wasCurrent) await get().switchToTabOrDraft(get().tabs[0] ?? null)
      } else {
        set({ error: toErrorMessage(e) })
        showChatError(e, 'chat-delete', () => void get().deleteChat(chatId))
      }
    } finally {
      set({ deletingChatId: null })
    }
  },

  async renameChat(chatId, title) {
    const trimmed = title.trim()
    if (!trimmed) return false
    const current = get().chats.find((item) => item.chatId === chatId)
    if (current && current.title === trimmed) return true
    try {
      const meta = await chatApi.updateChatTitle(chatId, trimmed)
      set((s) => ({
        chats: s.chats.map((item) => (item.chatId === chatId ? { ...item, title: meta.title } : item)),
        chatTitle: s.chatId === chatId ? meta.title : s.chatTitle,
        tabs: s.tabs.map((t) => (t.chatId === chatId ? { ...t, title: meta.title } : t)),
      }))
      return true
    } catch (e) {
      set({ error: toErrorMessage(e) })
      return false
    }
  },

  async switchBranch(branchId) {
    const { chatId } = get()
    if (!chatId) return false
    if (get().branchId !== branchId && !(await confirmPendingDiscard(get()))) return false
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
        contextRangeTags: [],
        refineJob: null,
        inlineView: {},
        ratings: {},
        versionsByBlock: {},
        contextInstruction: '',
        appliedContextLabel: null,
        lastRefineInstruction: null,
        refineFailed: false,
        editingBlockId: null,
        editingDraft: '',
        editingOriginal: '',
        editingContextTags: [],
        sourceNavigationError: null,
        branches: get().branches.map((b) => ({
          ...b,
          isActive: b.branchId === branchId,
        })),
        tabs: get().tabs.map((t) => (t.chatId === chatId ? { ...t, branchId } : t)),
      })
      get().reattachGeneratingBlocks()
      void get().loadSideChatContext()
      await refreshFeedbacks(set, chatId, branchId, detail.messageBlocks)
      return true
    } catch (e) {
      set({ error: toErrorMessage(e) })
      return false
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
    set((s) => ({
      appliedBlockIds: [...s.selectedBlockIds],
      appliedContextLabel: s.contextInstruction.trim().slice(0, 30) || '선택한 Context',
      focusSignal: s.focusSignal + 1,
    }))
    useNotificationStore.getState().show('Context를 적용했습니다.', 'success')
  },

  clearAppliedContext() {
    set({ appliedBlockIds: [], appliedContextLabel: null })
    useNotificationStore.getState().show('Context 적용을 해제했습니다.', 'info')
  },

  addContextRangeTag(tag) {
    set((s) => ({
      ...(s.editingBlockId
        ? { editingContextTags: [...s.editingContextTags, { ...tag, id: crypto.randomUUID() }] }
        : { contextRangeTags: [...s.contextRangeTags, { ...tag, id: crypto.randomUUID() }] }),
    }))
  },

  removeContextRangeTag(id) {
    set((s) => ({ contextRangeTags: s.contextRangeTags.filter((t) => t.id !== id) }))
  },

  removeEditingContextTag(id) {
    set((s) => ({ editingContextTags: s.editingContextTags.filter((t) => t.id !== id) }))
  },

  async openDraftSideChatWithRange(tag) {
    const { chatId, branchId } = get()
    if (!chatId || !branchId) return
    if (!(await confirmPendingDiscard(get()))) return
    captureActiveTabSnapshot(set, get)
    const draftId = newDraftId()
    resetToDraftFields(set, get)
    set({
      tabs: [
        ...get().tabs,
        {
          id: draftId,
          chatId: null,
          branchId: null,
          title: '새 사이드 채팅',
          kind: 'SIDE',
          parentChatId: chatId,
          draftSideChatAnchor: { parentChatId: chatId, parentBranchId: branchId, anchorMessageBlockId: tag.messageBlockId },
        },
      ],
      activeTabId: draftId,
      chatKind: 'SIDE',
      parentChatId: chatId,
      parentBranchId: branchId,
      parentMessageBlockId: tag.messageBlockId,
      contextRangeTags: [{ ...tag, id: crypto.randomUUID() }],
    })
  },

  async sendMessage(prompt) {
    if (!prompt.trim()) return
    if (get().isSending) return // 새 채팅 생성이 끝나기 전 두 번째 전송이 겹치면 서로 다른 채팅이 만들어진다
    set({ isSending: true })
    const clickedAt = Date.now() // 0820_06 C1: 전송 클릭 시각(네트워크 요청 전에 잰다)
    // 대화는 화면을 열 때가 아니라 사용자가 첫 메시지를 보낼 때 만든다 (새로고침마다 빈 대화가 쌓이는 문제 방지).
    // 이미 채팅이 있으면 await 을 타지 않아, 아래 임시 질문 블록이 여전히 동기적으로 바로 보인다.
    let { chatId, branchId } = get()
    if (!chatId || !branchId) {
      const ensured = await ensureChat(set, get)
      if (!ensured) { set({ isSending: false }); return }
      chatId = ensured.chatId
      branchId = ensured.branchId
    }
    const { appliedBlockIds, contextRangeTags, selectedModelId, webSearchMode, reasoningEffort, draftAttachments, selectedLibraryResourceIds } = get()
    if (draftAttachments.some((item) => item.status === 'uploading')) {
      set({ error: '파일 업로드가 끝난 뒤 전송할 수 있습니다.', isSending: false })
      return
    }
    if (draftAttachments.some((item) => item.status === 'failed')) {
      set({ error: '업로드에 실패한 파일을 제거하거나 다시 시도해주세요.', isSending: false })
      return
    }

    // 응답을 기다리는 동안에도 방금 보낸 질문이 바로 보이게 임시 블록을 먼저 넣는다
    const tempBlockId = `temp-${crypto.randomUUID()}`
    const tempBlock: MessageBlock = {
      blockId: tempBlockId,
      branchId,
      role: 'user',
      content: prompt,
      currentVersionId: null,
      orderIndex: get().blocks.length,
      createdAt: new Date().toISOString(),
      attachments: draftAttachments.map((item) => ({
        attachmentId: item.attachmentId ?? item.localId,
        fileName: item.fileName,
        mimeType: item.mimeType,
        fileSize: item.file.size,
        status: 'attached' as const,
        expiresAt: null,
        previewUrl: item.localUrl,
      })),
      searchSources: [],
      generationStatus: 'complete',
    }
    const dropTempBlock = (s: ChatState) => s.blocks.filter((b) => b.blockId !== tempBlockId)

    set((s) => ({ isSending: true, error: null, blocks: [...s.blocks, tempBlock] }))
    try {
      const res = await convApi.sendMessage(
        chatId,
        branchId,
        prompt,
        appliedBlockIds,
        { selectedModelId, webSearchMode, reasoningEffort, attachmentIds: draftAttachments.flatMap((item) => item.attachmentId ? [item.attachmentId] : []), libraryResourceIds: selectedLibraryResourceIds },
        contextRangeTags.map((tag): ContextRangeIn => ({
          blockId: tag.messageBlockId,
          versionId: tag.messageVersionId,
          snippetText: tag.selectedText,
          startOffset: tag.startOffset,
          endOffset: tag.endOffset,
        })),
      )
      set((s) => ({
        // 전송 응답에는 인용 스니펫 내용(appliedContext)이 userBlock과 별도로 온다
        blocks: [...dropTempBlock(s), { ...res.userBlock, appliedContext: res.appliedContext }, res.assistantBlock],
        chatTitle: res.chatTitle,
        tabs: s.tabs.map((t) => (t.chatId === chatId ? { ...t, title: res.chatTitle } : t)),
        // 한 번 쓴 Context 는 자동으로 해제한다. 남겨두면 다음 질문까지
        // 같은 맥락에 묶여, 사용자가 의도하지 않은 답이 나온다.
        appliedBlockIds: [],
        appliedContextLabel: null,
        selectedBlockIds: [],
        contextRangeTags: [],
        selectedLibraryResourceIds: [],
        failedJobsByBlockId: Object.fromEntries(Object.entries(s.failedJobsByBlockId).filter(([id]) => id !== res.userBlock.blockId)),
      }))
      get().clearDraft()
      useNotificationStore.getState().dismissBanner('api-key-required')
      void get().attachToJob(res.assistantBlock.blockId, res.aiResponseJobId, clickedAt)
      if (res.titleGenerated) scheduleChatsRefresh(get)
    } catch (e) {
      if (openApiKeyWhenMissing(e)) {
        set((s) => ({ error: null, blocks: dropTempBlock(s) }))
      } else if (errorCode(e) === 'WEB_SEARCH_NOT_SUPPORTED') {
        // 선택한 모델이 검색을 지원하지 않으면 다시 눌러도 같은 오류가 반복되므로 끄기로 되돌린다
        set((s) => ({ webSearchMode: 'off', error: toErrorMessage(e), blocks: dropTempBlock(s) }))
      } else {
        const detail = errorDetail<AiResponseFailureDetail>(e)
        if (detail) {
          // 질문은 이미 서버에 저장됐으므로 화면을 다시 맞춘다(임시 블록은 이 조회 결과로 자연히 교체된다)
          await get().openChat(chatId, branchId)
          set((s) => ({ error: toErrorMessage(e), failedJobsByBlockId: detail.retryable ? { ...s.failedJobsByBlockId, [detail.userMessageBlockId]: detail.aiResponseJobId } : s.failedJobsByBlockId }))
        } else {
          // 질문이 저장되기 전 실패이므로 입력 내용과 첨부를 그대로 남겨 다시 보낼 수 있게 한다
          set((s) => ({ error: toErrorMessage(e), blocks: dropTempBlock(s) }))
        }
      }
    } finally {
      set({ isSending: false })
    }
  },

  async regenerate(blockId) {
    const clickedAt = Date.now() // 0820_06 C1
    const { chatId, branchId } = get()
    if (!chatId || !branchId) return
    set((s) => ({ isSending: true, pendingByBlockId: { ...s.pendingByBlockId, [blockId]: true } }))
    try {
      const block = await convApi.regenerate(chatId, branchId, blockId)
      useNotificationStore.getState().dismissBanner('api-key-required')
      set((s) => ({
        blocks: s.blocks.map((b) =>
          b.blockId === blockId ? { ...b, ...block } : b,
        ),
      }))
      void get().attachToJob(blockId, block.aiResponseJobId, clickedAt)
      await get().loadVersions(blockId)
    } catch (e) {
      if (openApiKeyWhenMissing(e)) set({ error: null })
      else set({ error: toErrorMessage(e) })
    } finally {
      set((s) => { const pendingByBlockId = { ...s.pendingByBlockId }; delete pendingByBlockId[blockId]; return { isSending: false, pendingByBlockId } })
    }
  },

  async retryAiResponseJob(jobId) {
    const clickedAt = Date.now() // 0820_06 C1
    const { chatId, branchId } = get()
    if (!chatId || !branchId) return
    set({ isSending: true, error: null })
    try {
      const result = await convApi.retryAiResponseJob(chatId, branchId, jobId)
      set((s) => ({ blocks: [...s.blocks, result.assistantBlock], chatTitle: result.chatTitle,
        failedJobsByBlockId: Object.fromEntries(Object.entries(s.failedJobsByBlockId).filter(([, id]) => id !== jobId)) }))
      void get().attachToJob(result.assistantBlock.blockId, result.aiResponseJobId, clickedAt)
      scheduleChatsRefresh(get)
    } catch (e) { set({ error: toErrorMessage(e) }) }
    finally { set({ isSending: false }) }
  },

  async attachToJob(blockId, jobId, clickedAt) {
    const { chatId, branchId } = get()
    if (!chatId || !branchId) return
    stopStream(blockId)
    const controller = new AbortController()
    activeStreams.set(blockId, controller)
    beginDelivery(jobId, clickedAt)
    let firstChunkSeen = false

    const handlers: convApi.AiStreamHandlers = {
      onOpen: () => {
        const draft = deliveryDrafts.get(jobId)
        if (draft && draft.streamConnectedAt === undefined) draft.streamConnectedAt = Date.now()
      },
      onText: (delta) => {
        if (!firstChunkSeen) {
          firstChunkSeen = true
          const draft = deliveryDrafts.get(jobId)
          if (draft) draft.firstChunkShownAt = Date.now()
        }
        set((s) => ({
          blocks: s.blocks.map((b) => b.blockId === blockId ? { ...b, content: b.content + delta } : b),
        }))
      },
      onSources: (sources: SearchSource[]) => {
        set((s) => ({ blocks: s.blocks.map((b) => b.blockId === blockId ? { ...b, searchSources: sources } : b) }))
      },
      onDone: (payload) => {
        set((s) => ({
          blocks: s.blocks.map((b) =>
            b.blockId === blockId
              ? {
                  ...b,
                  content: payload.content,
                  searchSources: payload.sources,
                  generationStatus: payload.status === 'completed' ? 'complete' : payload.status,
                  generationJobId: null,
                }
              : b,
          ),
        }))
        if (payload.status === 'failed' && payload.error) {
          useNotificationStore.getState().show(payload.error.message, 'error')
        }
        scheduleChatsRefresh(get)
        flushDeliveryTiming(chatId, branchId, jobId, payload.status)
      },
    }

    try {
      await convApi.openAiResponseStream(chatId, branchId, jobId, handlers, controller.signal)
    } catch {
      if (controller.signal.aborted) return
      await reconnectStreamWithBackoff(chatId, branchId, jobId, handlers, controller.signal)
    } finally {
      if (activeStreams.get(blockId) === controller) activeStreams.delete(blockId)
    }
  },

  reattachGeneratingBlocks() {
    for (const block of get().blocks) {
      // 이미 이 블록에 붙어 있는 스트림이 있으면 다시 붙지 않는다 — 이 창 자신이
      // 방금 보낸 요청이면 attachToJob이 이미 실행 중이다 (0821_05, 다른 창의
      // chat_activity 신호로 다시 불려도 중복 연결하지 않기 위함).
      if (block.generationStatus === 'generating' && block.generationJobId && !activeStreams.has(block.blockId)) {
        void get().attachToJob(block.blockId, block.generationJobId)
      }
    }
  },

  async cancelGeneration(blockId) {
    const { chatId, branchId, blocks } = get()
    const jobId = blocks.find((b) => b.blockId === blockId)?.generationJobId
    if (!chatId || !branchId || !jobId) return
    try {
      const updated = await convApi.cancelAiResponseJob(chatId, branchId, jobId)
      stopStream(blockId)
      set((s) => ({
        blocks: s.blocks.map((b) => (b.blockId === blockId ? { ...b, ...updated, generationJobId: null } : b)),
      }))
      // 스트림이 중단으로 끊기면 onDone이 못 올 수 있어 여기서도 남긴다 —
      // 이미 onDone이 먼저 보냈다면 flushDeliveryTiming이 조용히 넘어간다.
      flushDeliveryTiming(chatId, branchId, jobId, 'cancelled')
    } catch (e) {
      set({ error: toErrorMessage(e) })
    }
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
      set({ isSavingEdit: true })
      const contextRanges = get().editingContextTags.map((tag): ContextRangeIn => ({
        blockId: tag.messageBlockId,
        versionId: tag.messageVersionId,
        snippetText: tag.selectedText,
        startOffset: tag.startOffset,
        endOffset: tag.endOffset,
      }))
      const block = await convApi.editBlock(chatId, branchId, blockId, content, contextRanges)
      set((s) => ({ blocks: s.blocks.map((item) => item.blockId === blockId ? { ...item, ...block } : item) }))
      await get().loadVersions(blockId)
      set({ editingBlockId: null, editingDraft: '', editingOriginal: '', editingContextTags: [] })
      useNotificationStore.getState().show('메시지를 수정했습니다.', 'success')
      return true
    } catch (e) { set({ error: toErrorMessage(e) }); return false }
    finally { set({ isSavingEdit: false }) }
  },

  async startEdit(blockId, content) {
    const state = get()
    if (state.editingBlockId && state.editingBlockId !== blockId && state.editingDraft !== state.editingOriginal && !(await useConfirmStore.getState().request('다른 메시지의 수정 내용을 버릴까요?'))) return
    const block = state.blocks.find((item) => item.blockId === blockId)
    const editingContextTags = (block?.appliedContext ?? []).map((item) => ({
      id: crypto.randomUUID(),
      messageBlockId: item.blockId,
      messageVersionId: item.versionId,
      role: state.blocks.find((source) => source.blockId === item.blockId)?.role ?? 'assistant',
      snapshotText: item.content,
      selectedText: item.content,
      startOffset: item.startOffset ?? 0,
      endOffset: item.endOffset ?? item.content.length,
    }))
    set({ editingBlockId: blockId, editingDraft: content, editingOriginal: content, editingContextTags })
  },

  setEditingDraft(content) { set({ editingDraft: content }) },
  cancelEdit() { set({ editingBlockId: null, editingDraft: '', editingOriginal: '', editingContextTags: [] }) },

  async runRefine(instruction) {
    const { chatId, branchId, refineTargetBlockId } = get()
    if (!chatId || !branchId || !refineTargetBlockId) return

    set({ isRefining: true, error: null, refineFailed: false, lastRefineInstruction: instruction })
    try {
      const job = await convApi.runRefine(
        chatId,
        branchId,
        [refineTargetBlockId],
        instruction,
      )
      set({
        refineJob: job,
        lastRefineInstruction: instruction,
        refineFailed: false,
        inlineView: Object.fromEntries(
          job.results.map((r) => [r.blockId, 'refined' as const]),
        ),
      })
      useNotificationStore.getState().dismissBanner('api-key-required')
      requestAnimationFrame(() => document.getElementById(`block-${job.results[0]?.blockId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
    } catch (e) {
      if (openApiKeyWhenMissing(e)) set({ error: null })
      else set({ error: toErrorMessage(e), refineFailed: true })
    } finally {
      set({ isRefining: false })
    }
  },

  async retryRefine() {
    const instruction = get().lastRefineInstruction ?? get().contextInstruction
    if (instruction.trim()) await get().runRefine(instruction)
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
      useNotificationStore.getState().show('정제 결과를 반영했습니다.', 'success')
    } catch (e) {
      set({ error: toErrorMessage(e) })
      // 이미 처리된 결과 등 서버와 어긋난 상태일 수 있으므로 최신 상태로 다시 맞춘다
      await refreshRefineJob(set, chatId, branchId, refineJob.refineJobId)
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
      useNotificationStore.getState().show('정제 결과를 거절했습니다.', 'info')
    } catch (e) {
      set({ error: toErrorMessage(e) })
      await refreshRefineJob(set, chatId, branchId, refineJob.refineJobId)
    }
  },

  async approveAll() {
    const { chatId, branchId, refineJob } = get()
    if (!chatId || !branchId || !refineJob) return
    try {
      const { processed, failed, actionMeta } = await convApi.approveAll(
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
        error: null,
      }))
      showBulkResult(actionMeta, failed, () => void get().approveAll())
    } catch (e) {
      set({ error: toErrorMessage(e) })
    }
  },

  async rejectAll() {
    const { chatId, branchId, refineJob } = get()
    if (!chatId || !branchId || !refineJob) return
    try {
      const { processed, failed, actionMeta } = await convApi.rejectAll(chatId, branchId, refineJob.refineJobId)
      const byId = new Map(processed.map((item) => [item.resultId, item]))
      set((s) => ({ refineJob: s.refineJob && { ...s.refineJob, results: s.refineJob.results.map((item) => byId.get(item.resultId) ?? item) }, error: null }))
      showBulkResult(actionMeta, failed, () => void get().rejectAll())
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
    const state = get()
    const hasOtherUnsavedEdit = Boolean(
      state.editingBlockId &&
      state.editingDraft !== state.editingOriginal &&
      editedBaseContent === undefined,
    )
    if (hasOtherUnsavedEdit && !(await useConfirmStore.getState().request('저장하지 않은 메시지 수정 내용을 버리고 브랜치를 만들까요?'))) return false

    set({ isCreatingBranch: true, branchError: null })
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
      // 분기 전 이탈 확인을 마쳤거나 수정본이 새 브랜치에 저장됐으므로 초안을 정리한다.
      set({ editingBlockId: null, editingDraft: '', editingOriginal: '', editingContextTags: [] })
      const switched = await get().switchBranch(created.branchId)
      if (!switched) return false
      useNotificationStore.getState().show('브랜치를 만들었습니다.', 'success')
      useNotificationStore.getState().dismissBanner('branch')
      return true
    } catch (e) {
      set({ branchError: toErrorMessage(e) })
      showChatError(e, 'branch', () => void get().createBranch(name, baseBlockId, contextBlockIds, editedBaseContent))
      return false
    } finally {
      set({ isCreatingBranch: false })
    }
  },
  async createBranchAt(baseBlockId) {
    const { chatId } = get()
    if (!chatId) return false
    if (!(await confirmPendingDiscard(get()))) return false
    set({ isCreatingBranch: true, branchError: null })
    try {
      const created = await chatApi.createConversationNode(chatId, { baseMessageBlockId: baseBlockId })
      if (openSidePanel) await openSidePanel(created.chatMeta.chatId, created.branchMeta.branchId)
      else {
        applyDetail(set, created)
        upsertTab(set, get, created.chatMeta, created.branchMeta.branchId)
        void get().loadSideChatContext()
      }
      await refreshMainSideChatTree()
      useNotificationStore.getState().show('분기 대화를 만들었습니다.', 'success')
      return true
    } catch (e) {
      set({ branchError: toErrorMessage(e) })
      showChatError(e, 'branch', () => void get().createBranchAt(baseBlockId))
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
      const switched = await get().switchBranch(item.sourceBranchId)
      if (!switched) return
    }
    set({ highlightedBlockId: item.sourceMessageBlockId })

    // 브랜치 전환 뒤 새 블록 목록이 렌더링된 다음에 위치를 찾는다.
    requestAnimationFrame(() => {
      const target = document.getElementById(`block-${item.sourceMessageBlockId}`)
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      else set({ sourceNavigationError: '원본 메시지를 찾을 수 없습니다.' })
    })

    // 강조는 잠깐만 남긴다. 계속 켜두면 어디를 보라는 건지 흐려진다
    setTimeout(() => {
      if (get().highlightedBlockId === item.sourceMessageBlockId) {
        set({ highlightedBlockId: null })
      }
    }, 2000)
  },

  jumpToAppliedContext(item) {
    set({
      highlightedBlockId: item.blockId,
      highlightedRange:
        item.startOffset != null && item.endOffset != null
          ? {
              blockId: item.blockId,
              versionId: item.versionId,
              startOffset: item.startOffset,
              endOffset: item.endOffset,
            }
          : null,
    })

    requestAnimationFrame(() => {
      const target = document.getElementById(`block-${item.blockId}`)
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      } else {
        set({ sourceNavigationError: '원본 메시지를 찾을 수 없습니다.' })
      }
    })

    setTimeout(() => {
      if (get().highlightedBlockId === item.blockId) {
        set({ highlightedBlockId: null, highlightedRange: null })
      }
    }, 2500)
  },

  setInlineView(blockId, view) {
    set((s) => ({ inlineView: { ...s.inlineView, [blockId]: view } }))
  },

  dismissError() {
    set({ error: null })
  },

  clearSourceNavigationError() { set({ sourceNavigationError: null }) },

  async switchTab(id) {
    const tab = get().tabs.find((t) => t.id === id)
    if (!tab || id === get().activeTabId) return
    if (!(await confirmPendingDiscard(get()))) return
    captureActiveTabSnapshot(set, get)
    get().clearDraft()
    set({ editingBlockId: null, editingDraft: '', editingOriginal: '', editingContextTags: [] })
    if (tab.chatId && tab.branchId) {
      await get().openChat(tab.chatId, tab.branchId)
      return
    }
    resetToDraftFields(set, get)
    set({ activeTabId: id })
  },

  async closeTab(id) {
    const { tabs, activeTabId } = get()
    const index = tabs.findIndex((t) => t.id === id)
    if (index === -1) return

    const closing = tabs[index]
    if (id !== activeTabId) {
      set((s) => ({ tabs: s.tabs.filter((t) => t.id !== id) }))
      if (closing.isTemporary && closing.chatId) {
        forgetTemporaryChat(closing.chatId)
        void chatApi.deleteChat(closing.chatId).catch(() => undefined)
      }
      return
    }

    if (!(await confirmPendingDiscard(get()))) return
    get().clearDraft()
    set((s) => ({
      editingBlockId: null,
      editingDraft: '',
      editingOriginal: '',
      editingContextTags: [],
      tabs: s.tabs.filter((t) => t.id !== id),
    }))
    if (closing.isTemporary && closing.chatId) {
      forgetTemporaryChat(closing.chatId)
      void chatApi.deleteChat(closing.chatId).catch(() => undefined)
    }
    const remaining = get().tabs
    if (remaining.length === 0 && options.onEmptyTabs) {
      options.onEmptyTabs()
      return
    }
    const next = remaining[index] ?? remaining[index - 1] ?? null
    await get().switchToTabOrDraft(next)
  },

  async switchToTabOrDraft(tab) {
    if (tab?.chatId && tab.branchId) {
      await get().openChat(tab.chatId, tab.branchId)
      return
    }
    if (tab) {
      resetToDraftFields(set, get)
      set({ activeTabId: tab.id })
      return
    }
    resetToDraft(set, get, newDraftId())
  },

  async createSideChatTab(anchorMessageBlockId, title, isTemporary = false) {
    const { chatId, branchId } = get()
    if (!chatId || !branchId) return
    if (!(await confirmPendingDiscard(get()))) return
    captureActiveTabSnapshot(set, get)
    get().clearDraft()
    set({ editingBlockId: null, editingDraft: '', editingOriginal: '', editingContextTags: [], isCreatingSideChat: true })
    try {
      const created = await sideChatApi.createSideChat(
        chatId,
        branchId,
        isTemporary ? { anchorMessageBlockId, title, isTemporary: true } : { anchorMessageBlockId, title },
      )
      if (openSidePanel) await openSidePanel(created.chatMeta.chatId, created.branchMeta.branchId)
      else {
        applyDetail(set, created)
        upsertTab(set, get, created.chatMeta, created.branchMeta.branchId)
      }
      if (created.chatMeta.isTemporary) rememberTemporaryChat(created.chatMeta.chatId)
      await refreshMainSideChatTree()
      useNotificationStore.getState().show(created.chatMeta.isTemporary ? 'Temporary Chat을 만들었습니다. 탭을 닫으면 삭제됩니다.' : '사이드 채팅을 만들었습니다.', 'success')
    } catch (e) {
      set({ error: toErrorMessage(e) })
    } finally {
      set({ isCreatingSideChat: false })
    }
  },

  async loadSideChatContext() {
    const { chatId, branchId } = get()
    if (!chatId) return
    try {
      const tree = await sideChatApi.fetchSideChatTree(chatId)
      const byBlock: Record<string, SideChatSummary[]> = {}
      for (const child of tree.chats) {
        if (child.parentChatId !== chatId || child.parentBranchId !== branchId) continue
        if (!child.parentMessageBlockId) continue
        ;(byBlock[child.parentMessageBlockId] ??= []).push(child)
      }
      // 요청이 진행되는 동안 사용자가 다른 탭으로 옮겼을 수 있으니 다시 확인한다
      if (get().chatId !== chatId) return
      set({ sideChatsByBlockId: byBlock, sideChatTree: tree.chats, sideChatTreeRootId: tree.rootChatId })
    } catch {
      // 트리 조회 실패는 화면을 막을 만한 문제가 아니다 — 다음 조회 때 다시 시도된다
    }
  },

  async sendSelectedToParentAsContext() {
    const { parentChatId, parentBranchId, selectedBlockIds } = get()
    if (!parentChatId || !parentBranchId || selectedBlockIds.length === 0) return false
    const blockIds = [...selectedBlockIds]
    const parentTab = get().tabs.find((t) => t.chatId === parentChatId)
    await get().openChat(parentChatId, parentTab?.branchId ?? parentBranchId)
    set({
      appliedBlockIds: blockIds,
      appliedContextLabel: '사이드 채팅에서 가져온 Context',
      focusSignal: get().focusSignal + 1,
    })
    useNotificationStore.getState().show('사이드 채팅 내용을 부모 채팅의 Context로 추가했습니다.', 'success')
    return true
  },

  async importSelectedToParentAsMessages() {
    const { parentChatId, parentBranchId, selectedBlockIds } = get()
    if (!parentChatId || !parentBranchId || selectedBlockIds.length === 0) return false
    const blockIds = [...selectedBlockIds]
    try {
      const result = await sideChatApi.importBlocksAsMessages(parentChatId, parentBranchId, blockIds)
      const parentTab = get().tabs.find((t) => t.chatId === parentChatId)
      await get().openChat(parentChatId, parentTab?.branchId ?? parentBranchId)
      useNotificationStore.getState().showAction(result.actionMeta)
      return true
    } catch (e) {
      set({ error: toErrorMessage(e) })
      return false
    }
  },

  async createSiblingBranchFromSideChat(branchName, editedBaseContent) {
    const { parentChatId, parentBranchId, parentMessageBlockId } = get()
    if (!parentChatId || !parentBranchId || !parentMessageBlockId) return false
    set({ isCreatingBranch: true, branchError: null })
    try {
      const created = await chatApi.createBranch(parentChatId, {
        branchName,
        baseBranchId: parentBranchId,
        baseMessageBlockId: parentMessageBlockId,
        contextBlockIds: [],
        editedBaseContent,
      })
      await get().openChat(parentChatId, created.branchId)
      useNotificationStore.getState().show('부모 아래 형제 브랜치를 만들었습니다.', 'success')
      return true
    } catch (e) {
      set({ branchError: toErrorMessage(e) })
      return false
    } finally {
      set({ isCreatingBranch: false })
    }
  },
  }))
}

/** 좌측 사이드바와 전역 메뉴가 쓰는 기본(메인) 패널 상태. */
export const useChatStore = createChatStore()

// 0821_05: 같은 계정의 다른 창에서 생긴 변화를 받는 실시간 채널. 로그인 하나당
// 연결 하나만 유지한다 — 여러 패널이 있어도 채널은 공유한다.
let realtimeController: AbortController | null = null
let realtimeReconnectTimer: ReturnType<typeof setTimeout> | null = null
const REALTIME_RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000]

/** 로그인한 동안 계속 열어 둔다. 끊기면 지수 백오프로 다시 연결한다. */
export function connectRealtime() {
  if (realtimeController) return
  realtimeController = new AbortController()
  void runRealtimeLoop(realtimeController.signal, 0)
}

/** 로그아웃 시 연결을 닫는다. */
export function disconnectRealtime() {
  realtimeController?.abort()
  realtimeController = null
  if (realtimeReconnectTimer) {
    clearTimeout(realtimeReconnectTimer)
    realtimeReconnectTimer = null
  }
}

async function runRealtimeLoop(signal: AbortSignal, attempt: number): Promise<void> {
  if (signal.aborted) return
  let connectedThisAttempt = false
  try {
    await realtimeApi.openRealtimeStream(
      {
        onOpen: () => { connectedThisAttempt = true },
        onChatsChanged: handleRealtimeChatsChanged,
        onChatActivity: (data) => void handleRealtimeChatActivity(data),
      },
      signal,
    )
  } catch {
    // 연결 실패·중간 끊김 모두 아래 재연결 로직을 탄다
  }
  if (signal.aborted) return
  // 재연결 직후에는 끊긴 동안 놓쳤을 변화를 보정하기 위해 목록을 강제로 다시 불러온다.
  handleRealtimeChatsChanged()
  const nextAttempt = connectedThisAttempt ? 0 : attempt + 1
  const delay = REALTIME_RECONNECT_DELAYS_MS[Math.min(attempt, REALTIME_RECONNECT_DELAYS_MS.length - 1)]
  realtimeReconnectTimer = setTimeout(() => {
    realtimeReconnectTimer = null
    void runRealtimeLoop(signal, nextAttempt)
  }, delay)
}

function handleRealtimeChatsChanged() {
  scheduleChatsRefresh(useChatStore.getState)
}

/** 지금 열려 있는 대화와 같은 chatId·branchId일 때만 조용히 다시 불러오고, 생성 중인 블록에 다시 붙는다. */
async function handleRealtimeChatActivity(data: realtimeApi.RealtimeChatActivity) {
  const before = useChatStore.getState()
  if (before.chatId !== data.chatId || before.branchId !== data.branchId) return
  try {
    const detail = await chatApi.fetchChat(data.chatId, data.branchId)
    const current = useChatStore.getState()
    if (current.chatId !== data.chatId || current.branchId !== data.branchId) return
    useChatStore.setState({ blocks: detail.messageBlocks, chatTitle: detail.chatMeta.title })
  } catch {
    return // 조회 실패는 조용히 넘어간다 — 다음 이벤트나 안전망 폴링이 보정한다
  }
  useChatStore.getState().reattachGeneratingBlocks()
}

/** 대화 관련 필드만 빈 상태로 되돌린다. 탭 목록 자체는 건드리지 않는다. */
function resetToDraftFields(
  set: (partial: Partial<ChatState>) => void,
  get: () => ChatState,
) {
  get().clearDraft()
  set({
    chatId: null,
    projectId: null,
    chatTitle: '',
    branchId: null,
    branches: [],
    blocks: [],
    sourceContext: [],
    chatKind: 'MAIN',
    parentChatId: null,
    parentBranchId: null,
    parentMessageBlockId: null,
    rootChatId: null,
    rootBranchId: null,
    sideChatsByBlockId: {},
    sideChatTree: [],
    sideChatTreeRootId: null,
    selectedBlockIds: [],
    appliedBlockIds: [],
    appliedContextLabel: null,
    contextRangeTags: [],
    refineJob: null,
    lastRefineInstruction: null,
    refineFailed: false,
    inlineView: {},
    ratings: {},
    versionsByBlock: {},
    contextInstruction: '',
    error: null,
    pendingByBlockId: {},
    failedJobsByBlockId: {},
    editingBlockId: null,
    editingDraft: '',
    editingOriginal: '',
    editingContextTags: [],
    isSavingEdit: false,
    sourceNavigationError: null,
    branchError: null,
    focusSignal: get().focusSignal + 1,
  })
}

/** 빈 새 대화 화면으로 되돌린다. 실제 대화는 사용자가 첫 메시지를 보낼 때(sendMessage) 만든다.
 *  draftId 를 주면 임시 탭 하나를 새로 만들어 그 탭으로 연다 (0820_08 B1). */
function resetToDraft(
  set: (partial: Partial<ChatState>) => void,
  get: () => ChatState,
  draftId?: string,
) {
  resetToDraftFields(set, get)
  if (!draftId) return
  set({
    tabs: [...get().tabs, { id: draftId, chatId: null, branchId: null, title: '새 대화', kind: 'MAIN', parentChatId: null }],
    activeTabId: draftId,
  })
}

function applyDetail(
  set: (partial: Partial<ChatState>) => void,
  detail: ChatDetail,
) {
  set({
    chatId: detail.chatMeta.chatId,
    projectId: detail.chatMeta.projectId ?? null,
    chatTitle: detail.chatMeta.title,
    branchId: detail.branchMeta.branchId,
    branches: detail.branchList,
    blocks: detail.messageBlocks,
    sourceContext: [],
    chatKind: detail.chatMeta.kind,
    parentChatId: detail.chatMeta.parentChatId,
    parentBranchId: detail.chatMeta.parentBranchId,
    parentMessageBlockId: detail.chatMeta.parentMessageBlockId,
    rootChatId: detail.chatMeta.rootChatId,
    rootBranchId: detail.chatMeta.rootBranchId,
    isTemporary: detail.chatMeta.isTemporary ?? false,
    sideChatsByBlockId: {},
    sideChatTree: [],
    sideChatTreeRootId: null,
    selectedBlockIds: [],
    appliedBlockIds: [],
    appliedContextLabel: null,
    contextRangeTags: [],
    refineJob: null,
    lastRefineInstruction: null,
    refineFailed: false,
    inlineView: {},
    ratings: {},
        versionsByBlock: {},
        contextInstruction: '',
    error: null,
    draftText: '',
    draftAttachments: [],
    pendingByBlockId: {},
    failedJobsByBlockId: {},
    editingBlockId: null,
    editingDraft: '',
    editingOriginal: '',
    editingContextTags: [],
    isSavingEdit: false,
    sourceNavigationError: null,
    branchError: null,
  })
}

/** 탭 목록에 chatId 를 upsert 하고 그 탭을 활성 탭으로 표시한다. */
function upsertTab(
  set: (partial: Partial<ChatState>) => void,
  get: () => ChatState,
  meta: ChatMeta,
  branchId: string,
) {
  const tabs = get().tabs
  const index = tabs.findIndex((t) => t.chatId === meta.chatId)
  const tab: ChatTab = {
    id: meta.chatId,
    chatId: meta.chatId,
    branchId,
    title: meta.title,
    kind: meta.kind,
    parentChatId: meta.parentChatId,
    isTemporary: meta.isTemporary ?? false,
  }
  set({
    tabs: index === -1 ? [...tabs, tab] : tabs.map((t, i) => (i === index ? tab : t)),
    activeTabId: meta.chatId,
  })
}

/** 방금 실제로 만들어진 채팅으로 draft 탭 자리를 그대로 대체한다 (sendMessage 첫 전송). */
function promoteDraftTab(
  tabs: ChatTab[],
  draftId: string | null,
  meta: ChatMeta,
  branchId: string,
): ChatTab[] {
  const tab: ChatTab = {
    id: meta.chatId,
    chatId: meta.chatId,
    branchId,
    title: meta.title,
    kind: meta.kind,
    parentChatId: meta.parentChatId,
    isTemporary: meta.isTemporary ?? false,
  }
  const index = draftId ? tabs.findIndex((t) => t.id === draftId) : -1
  return index === -1 ? [...tabs, tab] : tabs.map((t, i) => (i === index ? tab : t))
}

/** 아직 채팅이 없으면(새 대화 draft 상태) 만들고, 있으면 그대로 돌려준다.
 *  sendMessage 첫 전송과 addFiles 의 첫 첨부가 똑같은 생성 흐름을 타야
 *  사이드 채팅 앵커·탭 승격이 어긋나지 않는다. 실패하면 error 를 세팅하고 null 을 돌려준다. */
async function ensureChat(
  set: (partial: Partial<ChatState>) => void,
  get: () => ChatState,
): Promise<{ chatId: string; branchId: string } | null> {
  const existing = get()
  if (existing.chatId && existing.branchId) return { chatId: existing.chatId, branchId: existing.branchId }

  const draftId = get().activeTabId
  const draftAnchor = get().tabs.find((t) => t.id === draftId)?.draftSideChatAnchor
  try {
    if (draftAnchor) {
      // 사이드 채팅에 질문(0820_13 C1, C2): 패널을 여는 시점이 아니라 첫 전송에서만 서버에 만든다
      const created = await sideChatApi.createSideChat(draftAnchor.parentChatId, draftAnchor.parentBranchId, {
        anchorMessageBlockId: draftAnchor.anchorMessageBlockId,
      })
      const chatId = created.chatMeta.chatId
      const branchId = created.branchMeta.branchId
      set({
        chatId, chatTitle: created.chatMeta.title, branchId, branches: created.branchList, blocks: created.messageBlocks,
        chatKind: created.chatMeta.kind,
        parentChatId: created.chatMeta.parentChatId,
        parentBranchId: created.chatMeta.parentBranchId,
        parentMessageBlockId: created.chatMeta.parentMessageBlockId,
        rootChatId: created.chatMeta.rootChatId,
        rootBranchId: created.chatMeta.rootBranchId,
        tabs: promoteDraftTab(get().tabs, draftId, created.chatMeta, created.branchMeta.branchId),
        activeTabId: chatId,
      })
      void get().loadSideChatContext()
      return { chatId, branchId }
    }
    const created = await chatApi.createChat()
    const chatId = created.chatMeta.chatId
    const branchId = created.branchMeta.branchId
    set({
      chatId, projectId: created.chatMeta.projectId ?? null, chatTitle: created.chatMeta.title, branchId, branches: created.branchList, blocks: created.messageBlocks,
      tabs: promoteDraftTab(get().tabs, draftId, created.chatMeta, created.branchMeta.branchId),
      activeTabId: chatId,
    })
    scheduleChatsRefresh(get)
    return { chatId, branchId }
  } catch (e) {
    set({ error: toErrorMessage(e) })
    return null
  }
}

/** 지금 활성 탭이 실제 채팅이면, 떠나기 전에 최신 브랜치·제목을 캐시에 남긴다. */
function captureActiveTabSnapshot(
  set: (partial: Partial<ChatState>) => void,
  get: () => ChatState,
) {
  const { activeTabId, chatId, branchId, chatTitle } = get()
  if (!activeTabId || !chatId || !branchId) return
  set({
    tabs: get().tabs.map((t) =>
      t.id === activeTabId ? { ...t, branchId, title: chatTitle || t.title } : t,
    ),
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

// 승인·거절이 실패하면(이미 처리된 결과 등) 서버 상태로 다시 맞춘다
async function refreshRefineJob(
  set: (partial: Partial<ChatState>) => void,
  chatId: string,
  branchId: string,
  jobId: string,
) {
  try {
    const job = await convApi.fetchRefineJob(chatId, branchId, jobId)
    set({ refineJob: job })
  } catch {
    // 재조회마저 실패하면 기존 오류 안내만 남기고 화면 상태는 그대로 둔다
  }
}

function openApiKeyWhenMissing(error: unknown): boolean {
  if (errorCode(error) !== 'API_KEY_NOT_REGISTERED') return false
  const message = 'AI 기능을 사용하려면 먼저 OpenAI API 키를 등록해주세요.'
  useNotificationStore.getState().showError(error, {
    message,
    scope: 'api-key-required',
    action: {
      label: 'API 키 설정',
      run: () => {
        useNotificationStore.getState().dismissBanner('api-key-required')
        useSettingsStore.getState().openApiKey(message)
      },
    },
  })
  return true
}

// 연결이 끊기면 몇 번 다시 붙어보고, 안 되면 새로고침 안내로 넘긴다 (문서 C8).
const STREAM_RECONNECT_DELAYS_MS = [1000, 2000, 4000]

async function reconnectStreamWithBackoff(
  chatId: string,
  branchId: string,
  jobId: string,
  handlers: convApi.AiStreamHandlers,
  signal: AbortSignal,
  attempt = 0,
): Promise<void> {
  if (signal.aborted) return
  if (attempt >= STREAM_RECONNECT_DELAYS_MS.length) {
    // 0820_06 C3: 재시도를 다 썼는데도 안 되면 연결 실패로 남긴다.
    flushDeliveryTiming(chatId, branchId, jobId, 'connection_failed')
    useNotificationStore.getState().show(
      '연결이 끊겼습니다. 새로고침하면 이어서 볼 수 있습니다.',
      'error',
    )
    return
  }
  const draft = deliveryDrafts.get(jobId)
  if (draft) draft.reconnectCount += 1
  await new Promise((resolve) => setTimeout(resolve, STREAM_RECONNECT_DELAYS_MS[attempt]))
  if (signal.aborted) return
  try {
    await convApi.openAiResponseStream(chatId, branchId, jobId, handlers, signal)
  } catch {
    await reconnectStreamWithBackoff(chatId, branchId, jobId, handlers, signal, attempt + 1)
  }
}

function showChatError(error: unknown, scope: string, retry?: () => void) {
  useNotificationStore.getState().showError(error, {
    scope,
    action:
      retry && errorCode(error) === 'REQUEST_TIMEOUT'
        ? { label: '다시 시도', run: retry }
        : undefined,
  })
}

function showBulkResult(
  actionMeta: { message: string; successCode: string },
  failed: { message: string }[],
  retry: () => void,
) {
  const notifications = useNotificationStore.getState()
  if (failed.length === 0) {
    notifications.dismissBanner('bulk-refine')
    notifications.show(actionMeta.message, 'success')
    return
  }
  notifications.show(actionMeta.message, 'warning')
  notifications.showError(new Error('bulk-refine-partial-failure'), {
    message: '처리하지 못한 항목을 확인해주세요.',
    scope: 'bulk-refine',
    details: failed.map((item, index) => `${index + 1}. ${item.message}`),
    action: { label: '실패 항목 다시 시도', run: retry },
  })
}

async function confirmPendingDiscard(state: ChatState): Promise<boolean> {
  const hasComposerDraft = state.draftText.trim() || state.draftAttachments.length > 0
  const hasMessageEdit = state.editingBlockId && state.editingDraft !== state.editingOriginal
  if (!hasComposerDraft && !hasMessageEdit) return true
  return useConfirmStore.getState().request('저장하지 않은 입력 또는 수정 내용이 있습니다. 이동하면 사라집니다.', { confirmLabel: '버리기' })
}
