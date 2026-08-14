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
