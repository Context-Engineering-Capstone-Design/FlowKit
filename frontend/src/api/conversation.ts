import { api } from './client'
import type {
  AiResponseRating,
  BlockResponse,
  RegenerateResponse,
  BulkRefineResult,
  FeedbackResponse,
  RefineJob,
  RefineResultItem,
  SendMessageResponse,
  VersionItem,
} from '@/types/api'

export async function sendMessage(
  chatId: string,
  branchId: string,
  userPrompt: string,
  contextBlockIds: string[] = [],
  options: { selectedModelId: string | null; webSearchEnabled: boolean; attachmentIds: string[] } = { selectedModelId: null, webSearchEnabled: false, attachmentIds: [] },
): Promise<SendMessageResponse> {
  const { data } = await api.post<SendMessageResponse>(
    `/api/chats/${chatId}/branches/${branchId}/messages`,
    { userPrompt, contextBlockIds, ...options },
  )
  return data
}

export async function regenerate(
  chatId: string,
  branchId: string,
  blockId: string,
): Promise<RegenerateResponse> {
  const { data } = await api.post<RegenerateResponse>(
    `/api/chats/${chatId}/branches/${branchId}/blocks/${blockId}/regenerate`,
  )
  return data
}

export async function retryAiResponseJob(chatId: string, branchId: string, jobId: string): Promise<SendMessageResponse> {
  const { data } = await api.post<SendMessageResponse>(`/api/chats/${chatId}/branches/${branchId}/ai-response-jobs/${jobId}/retry`)
  return data
}

export async function fetchFeedback(
  chatId: string,
  branchId: string,
  blockId: string,
): Promise<FeedbackResponse> {
  const { data } = await api.get<FeedbackResponse>(
    `/api/chats/${chatId}/branches/${branchId}/blocks/${blockId}/feedback`,
  )
  return data
}

export async function setFeedback(
  chatId: string,
  branchId: string,
  blockId: string,
  rating: AiResponseRating | null,
): Promise<FeedbackResponse> {
  const { data } = await api.put<FeedbackResponse>(
    `/api/chats/${chatId}/branches/${branchId}/blocks/${blockId}/feedback`,
    { rating },
  )
  return data
}

export async function fetchVersions(
  chatId: string,
  branchId: string,
  blockId: string,
): Promise<VersionItem[]> {
  const { data } = await api.get<VersionItem[]>(
    `/api/chats/${chatId}/branches/${branchId}/blocks/${blockId}/versions`,
  )
  return data
}

export async function setActiveVersion(
  chatId: string,
  branchId: string,
  blockId: string,
  targetVersionId: string,
): Promise<BlockResponse> {
  const { data } = await api.patch<BlockResponse>(
    `/api/chats/${chatId}/branches/${branchId}/blocks/${blockId}/version`,
    { targetVersionId },
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
): Promise<RefineResultItem> {
  const { data } = await api.post<RefineResultItem>(
    `/api/chats/${chatId}/branches/${branchId}/refine-jobs/${jobId}/results/${resultId}/approve`,
  )
  return data
}

export async function rejectResult(
  chatId: string,
  branchId: string,
  jobId: string,
  resultId: string,
): Promise<RefineResultItem> {
  const { data } = await api.post<RefineResultItem>(
    `/api/chats/${chatId}/branches/${branchId}/refine-jobs/${jobId}/results/${resultId}/reject`,
  )
  return data
}

export async function approveAll(
  chatId: string,
  branchId: string,
  jobId: string,
): Promise<BulkRefineResult> {
  const { data } = await api.post<BulkRefineResult>(
    `/api/chats/${chatId}/branches/${branchId}/refine-jobs/${jobId}/approve-all`,
  )
  return data
}

export async function rejectAll(chatId: string, branchId: string, jobId: string): Promise<BulkRefineResult> {
  const { data } = await api.post<BulkRefineResult>(`/api/chats/${chatId}/branches/${branchId}/refine-jobs/${jobId}/reject-all`)
  return data
}

export async function cleanupJob(chatId: string, branchId: string, jobId: string) {
  const { data } = await api.post(
    `/api/chats/${chatId}/branches/${branchId}/refine-jobs/${jobId}/cleanup`,
  )
  return data
}
