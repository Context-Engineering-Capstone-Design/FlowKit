import { api } from './client'
import type { BlockResponse, RefineJob, SendMessageResponse } from '@/types/api'

export async function sendMessage(
  chatId: string,
  branchId: string,
  userPrompt: string,
  contextBlockIds: string[] = [],
): Promise<SendMessageResponse> {
  const { data } = await api.post<SendMessageResponse>(
    `/api/chats/${chatId}/branches/${branchId}/messages`,
    { userPrompt, contextBlockIds },
  )
  return data
}

export async function regenerate(
  chatId: string,
  branchId: string,
  blockId: string,
): Promise<BlockResponse> {
  const { data } = await api.post<BlockResponse>(
    `/api/chats/${chatId}/branches/${branchId}/blocks/${blockId}/regenerate`,
  )
  return data
}

export async function editBlock(
  chatId: string,
  branchId: string,
  blockId: string,
  editedContent: string,
): Promise<BlockResponse> {
  const { data } = await api.patch<BlockResponse>(
    `/api/chats/${chatId}/branches/${branchId}/blocks/${blockId}`,
    { editedContent },
  )
  return data
}

export async function runRefine(
  chatId: string,
  branchId: string,
  selectedBlockIds: string[],
  instructionText: string,
): Promise<RefineJob> {
  const { data } = await api.post<RefineJob>(
    `/api/chats/${chatId}/branches/${branchId}/refine-jobs`,
    { selectedBlockIds, instructionText },
  )
  return data
}

export async function approveResult(
  chatId: string,
  branchId: string,
  jobId: string,
  resultId: string,
) {
  const { data } = await api.post(
    `/api/chats/${chatId}/branches/${branchId}/refine-jobs/${jobId}/results/${resultId}/approve`,
  )
  return data
}

export async function rejectResult(
  chatId: string,
  branchId: string,
  jobId: string,
  resultId: string,
) {
  const { data } = await api.post(
    `/api/chats/${chatId}/branches/${branchId}/refine-jobs/${jobId}/results/${resultId}/reject`,
  )
  return data
}

export async function approveAll(chatId: string, branchId: string, jobId: string) {
  const { data } = await api.post(
    `/api/chats/${chatId}/branches/${branchId}/refine-jobs/${jobId}/approve-all`,
  )
  return data
}

export async function cleanupJob(chatId: string, branchId: string, jobId: string) {
  const { data } = await api.post(
    `/api/chats/${chatId}/branches/${branchId}/refine-jobs/${jobId}/cleanup`,
  )
  return data
}
