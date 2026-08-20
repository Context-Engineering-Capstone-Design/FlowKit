import { api } from './client'
import type {
  BranchDetail,
  BranchListItem,
  BranchMeta,
  ChatDetail,
  ChatListResponse,
  ChatMeta,
  DeleteChatResponse,
} from '@/types/api'

export async function createChat(projectId?: string | null): Promise<ChatDetail> {
  const { data } = await api.post<ChatDetail>('/api/chats', { projectId: projectId ?? null })
  return data
}

export async function fetchChats(params?: {
  cursor?: string
  limit?: number
  keyword?: string
}, signal?: AbortSignal): Promise<ChatListResponse> {
  const { data } = await api.get<ChatListResponse>('/api/chats', {
    params,
    signal,
  })
  return data
}

export async function fetchChat(
  chatId: string,
  branchId?: string,
): Promise<ChatDetail> {
  const { data } = await api.get<ChatDetail>(`/api/chats/${chatId}`, {
    params: branchId ? { branchId } : undefined,
  })
  return data
}

export async function updateChatTitle(
  chatId: string,
  generatedTitle: string,
): Promise<ChatMeta> {
  const { data } = await api.patch<ChatMeta>(`/api/chats/${chatId}/title`, {
    generatedTitle,
  })
  return data
}

export async function fetchBranches(chatId: string): Promise<BranchListItem[]> {
  const { data } = await api.get<BranchListItem[]>(`/api/chats/${chatId}/branches`)
  return data
}

export async function fetchBranch(
  chatId: string,
  branchId: string,
): Promise<BranchDetail> {
  const { data } = await api.get<BranchDetail>(
    `/api/chats/${chatId}/branches/${branchId}`,
  )
  return data
}

export async function createBranch(
  chatId: string,
  payload: {
    branchName?: string
    baseBranchId: string
    baseMessageBlockId: string
    contextBlockIds: string[]
    editedBaseContent?: string
  },
): Promise<BranchMeta> {
  const { data } = await api.post<BranchMeta>(
    `/api/chats/${chatId}/branches`,
    payload,
  )
  return data
}

/** 메시지 시점에서 독립된 통합 대화 노드를 만든다. */
export async function createConversationNode(
  chatId: string,
  payload: { baseMessageBlockId?: string; title?: string; isTemporary?: boolean },
): Promise<ChatDetail> {
  const { data } = await api.post<ChatDetail>(`/api/chats/${chatId}/nodes`, payload)
  return data
}

export async function deleteChat(chatId: string): Promise<DeleteChatResponse> {
  const { data } = await api.delete<DeleteChatResponse>(`/api/chats/${chatId}`)
  return data
}
