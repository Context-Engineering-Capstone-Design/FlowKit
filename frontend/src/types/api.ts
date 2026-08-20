/** 백엔드 응답 형식. 서버가 camelCase 로 내보내므로 그대로 받는다. */

export interface UserProfile {
  userId: string
  name: string
  email: string
  profileImage: string | null
  memo: string | null
}

export interface AuthStatus {
  isAuthenticated: boolean
  user: UserProfile | null
}

export interface TokenResponse {
  accessToken: string
  refreshToken: string
  expiresAt: string
  user: UserProfile
  isNewUser: boolean
}

export type ApiKeyConnectionStatus = 'unchecked' | 'connected' | 'failed'

export interface ApiKeyStatus {
  hasApiKey: boolean
  provider: string
  last4: string | null
  connectedStatus: ApiKeyConnectionStatus | null
  checkedAt: string | null
  message: string | null
}

export interface UserSettingResponse {
  userProfile: UserProfile
  apiKeyStatus: ApiKeyStatus
}

export interface DeleteApiKeyResponse {
  deleteSuccess: boolean
  apiKeyStatus: ApiKeyStatus
}

export interface ChatSummary {
  chatId: string
  title: string
  projectId?: string | null
}

export interface ProjectSummary { projectId: string; name: string; chatCount: number }
export interface ProjectMemory { memoryId: string; content: string; createdAt: string }
export interface ProjectLibraryResource { resourceId: string; title: string; content: string; sourceUrl: string | null }
export interface ProjectDetail extends ProjectSummary { instructions: string; memories: ProjectMemory[]; libraryResources: ProjectLibraryResource[] }

export interface ChatListResponse {
  chats: ChatSummary[]
  nextCursor: string | null
}

export interface DeleteChatResponse {
  deleteSuccess: boolean
  actionMeta: ActionMeta
}

export type ChatKind = 'MAIN' | 'SIDE'

export interface ChatMeta {
  chatId: string
  title: string
  createdAt: string
  /** 사이드 채팅 트리 (0820_08). 메인 채팅은 kind만 있고 나머지는 비어 있다. */
  kind: ChatKind
  parentChatId: string | null
  parentBranchId: string | null
  parentMessageBlockId: string | null
  rootChatId: string | null
  rootBranchId: string | null
  isTemporary?: boolean
}

export type BranchType = 'MAIN' | 'CHILD'

export interface BranchMeta {
  branchId: string
  branchName: string
  branchType: BranchType
  parentBranchId: string | null
  /** 브랜치 생성 응답에만 실린다. 출발 Context 참조 ID. */
  sourceContextRefId?: string
}

export interface BranchListItem extends BranchMeta {
  isActive: boolean
}

export type MessageRole = 'user' | 'assistant'

/** 답변 생성 진행 상태 (BE-AIRESP-007~009). 사용자 블록은 항상 complete다. */
export type GenerationStatus = 'generating' | 'complete' | 'cancelled' | 'failed'

export interface MessageBlock {
  blockId: string
  branchId: string
  role: MessageRole
  content: string
  currentVersionId: string | null
  /** 채팅 상세 조회에는 없고, 블록 단위 응답에만 담긴다 */
  versionNo?: number | null
  orderIndex: number
  createdAt: string
  attachments: AttachmentResponse[]
  searchSources: SearchSource[]
  generationStatus: GenerationStatus
  /** generating일 때만 값이 있다. 스트리밍 통로에 (다시) 붙을 때 쓴다. */
  generationJobId?: string | null
}

export interface ChatDetail {
  chatMeta: ChatMeta
  branchMeta: BranchMeta
  messageBlocks: MessageBlock[]
  branchList: BranchListItem[]
}

/** 브랜치가 어떤 Context 에서 출발했는지. pill 을 누르면 원본 위치로 이동한다. */
export interface SourceContextItem {
  contextBlockId: string
  previewText: string
  role: 'user' | 'assistant'
  sourceMessageBlockId: string
  sourceBranchId: string | null
  scrollTargetIndex: number | null
}

export interface BranchDetail {
  branchMeta: BranchMeta
  messageBlocks: MessageBlock[]
  sourceContextInfo: SourceContextItem[]
}

/** 백엔드 공통 오류 형식 (app/exceptions.py) */
export interface ApiError {
  errorCode: string
  message: string
  detail: unknown
  traceId: string
}

export interface ActionMeta {
  actionType: string
  successCode: string
  message: string
  affectedResourceId: string | null
}

export type ServiceFeedbackType =
  | 'error'
  | 'usability'
  | 'context'
  | 'branch'
  | 'other'

export interface ServiceFeedbackContext {
  page?: string
  chatId?: string
  branchId?: string
}

export interface ServiceFeedbackResponse {
  feedbackId: string
  submittedAt: string
  actionMeta: ActionMeta
}

export interface ClientErrorContext {
  page?: string
  feature?: string
  chatId?: string
  branchId?: string
  resourceId?: string
}

export type ClientErrorType =
  | 'window_error'
  | 'unhandled_rejection'
  | 'react_render_error'
  | 'api_response_error'

export interface ClientErrorResponse {
  logId: string
  receivedAt: string
}

export interface BlockResponse {
  blockId: string
  branchId: string
  role: MessageRole
  content: string
  currentVersionId: string | null
  versionNo: number | null
  orderIndex: number
  createdAt: string
  attachments: AttachmentResponse[]
  searchSources: SearchSource[]
  generationStatus: GenerationStatus
}

export interface AppliedContextOut {
  blockId: string
  versionId: string
  orderIndex: number
}

export interface SendMessageResponse {
  userBlock: BlockResponse
  assistantBlock: BlockResponse
  appliedContext: AppliedContextOut[]
  chatTitle: string
  titleGenerated: boolean
  selectedModel: string
  webSearchMode: WebSearchMode
  reasoningEffort: ReasoningEffort
  attachments: AttachmentResponse[]
  searchSources: SearchSource[]
  aiResponseJobId: string
  jobStatus: string
}

export interface AiResponseFailureDetail { aiResponseJobId: string; userMessageBlockId: string; retryable: boolean }
export interface RegenerateResponse extends BlockResponse { aiResponseJobId: string; jobStatus: string }

export interface ModelOption { modelId: string; displayName: string; provider: string; supportsWebSearch: boolean; supportsAttachment: boolean; isDefault: boolean; isAvailable: boolean; description: string; tags: string[] }
export interface AttachmentResponse { attachmentId: string; fileName: string; mimeType: string; fileSize: number; status: 'temporary' | 'attached' | 'expired'; expiresAt: string | null; previewUrl?: string | null }
export interface SearchSource { title: string; url: string }
export interface DraftAttachment { localId: string; attachmentId: string | null; file: File; fileName: string; mimeType: string; localUrl: string | null; status: 'uploading' | 'uploaded' | 'failed'; error: string | null }

export type AiResponseRating = 'like' | 'dislike'
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type WebSearchMode = 'off' | 'auto' | 'always'

export interface FeedbackResponse {
  aiMessageBlockId: string
  rating: AiResponseRating | null
  updatedAt: string | null
}

export type RefineStatus = 'pending' | 'approved' | 'rejected'

export interface RefineResultItem {
  resultId: string
  blockId: string
  baseVersionId: string
  baseContent: string
  refinedContent: string
  status: RefineStatus
  approvedVersionId: string | null
  orderIndex: number
  updatedAt: string
}

export interface RefineJob {
  refineJobId: string
  status: string
  instructionText: string
  results: RefineResultItem[]
}

/** 전체 승인·전체 거절처럼 여러 항목을 처리할 때, 일부만 실패할 수 있다 */
export interface BulkRefineResult {
  processed: RefineResultItem[]
  failed: {
    resourceId: string
    errorCode: string
    message: string
    resultId: string
    reason: string
  }[]
  actionMeta: ActionMeta
}

export interface VersionItem {
  versionId: string
  versionNo: number
  content: string
  sourceType: string
  createdAt: string
  isCurrent: boolean
}

/** 좌측 트리 그래프의 노드 하나, 우측 패널의 자식 목록 항목 (0820_08). */
export interface SideChatSummary {
  chatId: string
  title: string
  kind: ChatKind
  parentChatId: string | null
  parentBranchId: string | null
  parentMessageBlockId: string | null
  rootChatId: string | null
  isTemporary?: boolean
}

export interface SideChatTreeResponse {
  rootChatId: string | null
  chats: SideChatSummary[]
}

export interface CreateSideChatResponse extends ChatDetail {
  actionMeta: ActionMeta
}

/** 사이드 채팅의 메시지를 부모 채팅으로 가져온 결과 (0820_08 C2). */
export interface ImportBlocksResponse {
  importedBlocks: MessageBlock[]
  actionMeta: ActionMeta
}
