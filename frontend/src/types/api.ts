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

export interface ChatSummary {
  chatId: string
  title: string
}

export interface ChatListResponse {
  chats: ChatSummary[]
  nextCursor: string | null
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
}

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

export interface VersionItem {
  versionId: string
  versionNo: number
  content: string
  sourceType: string
  createdAt: string
  isCurrent: boolean
}
