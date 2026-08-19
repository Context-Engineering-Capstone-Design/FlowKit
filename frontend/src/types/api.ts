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
}

export interface ChatListResponse {
  chats: ChatSummary[]
  nextCursor: string | null
}

export interface DeleteChatResponse {
  deleteSuccess: boolean
  actionMeta: ActionMeta
}

export interface ChatMeta {
  chatId: string
  title: string
  createdAt: string
}

export type BranchType = 'MAIN' | 'CHILD'

export interface BranchMeta {
  branchId: string
  branchName: string
  branchType: BranchType
  parentBranchId: string | null
}

export interface BranchListItem extends BranchMeta {
  isActive: boolean
}

export type MessageRole = 'user' | 'assistant'

export interface MessageBlock {
  blockId: string
  role: MessageRole
  content: string
  currentVersionId: string | null
  /** 채팅 상세 조회에는 없고, 블록 단위 응답에만 담긴다 */
  versionNo?: number | null
  orderIndex: number
  createdAt: string
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
  role: MessageRole
  content: string
  currentVersionId: string | null
  versionNo: number | null
  orderIndex: number
  createdAt: string
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
  webSearchEnabled: boolean
  attachments: AttachmentResponse[]
  searchSources: SearchSource[]
  aiResponseJobId: string
  jobStatus: string
}

export interface AiResponseFailureDetail { aiResponseJobId: string; userMessageBlockId: string; retryable: boolean }
export interface RegenerateResponse extends BlockResponse { searchSources: SearchSource[]; aiResponseJobId: string; jobStatus: string }

export interface ModelOption { modelId: string; displayName: string; provider: string; supportsWebSearch: boolean; supportsAttachment: boolean; isDefault: boolean; isAvailable: boolean }
export interface AttachmentResponse { attachmentId: string; fileName: string; mimeType: string; fileSize: number; status: 'temporary' | 'attached' | 'expired'; expiresAt: string | null }
export interface SearchSource { title: string; url: string }
export interface DraftAttachment { localId: string; attachmentId: string | null; file: File; fileName: string; mimeType: string; localUrl: string | null; status: 'uploading' | 'uploaded' | 'failed'; error: string | null }

export type AiResponseRating = 'like' | 'dislike'

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
