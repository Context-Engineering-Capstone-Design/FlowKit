import { api } from './client'
import type { CreateSideChatResponse, SideChatSummary, SideChatTreeResponse } from '@/types/api'

export async function createSideChat(
  chatId: string,
  branchId: string,
  payload: { anchorMessageBlockId?: string; title?: string } = {},
): Promise<CreateSideChatResponse> {
  const { data } = await api.post<CreateSideChatResponse>(
    `/api/chats/${chatId}/branches/${branchId}/side-chats`,
    payload,
  )
  return data
}

export async function fetchSideChatChildren(chatId: string): Promise<SideChatSummary[]> {
  const { data } = await api.get<SideChatSummary[]>(`/api/chats/${chatId}/side-chats`)
  return data
}

export async function fetchSideChatTree(chatId: string): Promise<SideChatTreeResponse> {
  const { data } = await api.get<SideChatTreeResponse>(`/api/chats/${chatId}/side-chat-tree`)
  return data
}
