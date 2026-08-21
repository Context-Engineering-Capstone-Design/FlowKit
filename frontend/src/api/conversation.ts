import { api, tokenStore } from './client'
import { AI_REQUEST_TIMEOUT_MS } from '@/lib/requestTimeout'
import type {
  AiResponseRating,
  BlockResponse,
  RegenerateResponse,
  BulkRefineResult,
  ContextRangeIn,
  FeedbackResponse,
  RefineJob,
  RefineResultItem,
  SearchSource,
  SendMessageResponse,
  VersionItem,
  ReasoningEffort,
  WebSearchMode,
} from '@/types/api'

export async function sendMessage(
  chatId: string,
  branchId: string,
  userPrompt: string,
  contextBlockIds: string[] = [],
  options: { selectedModelId: string | null; webSearchMode: WebSearchMode; reasoningEffort: ReasoningEffort; attachmentIds: string[]; libraryResourceIds: string[] } = { selectedModelId: null, webSearchMode: 'auto', reasoningEffort: 'medium', attachmentIds: [], libraryResourceIds: [] },
  contextRanges: ContextRangeIn[] = [],
): Promise<SendMessageResponse> {
  const { data } = await api.post<SendMessageResponse>(
    `/api/chats/${chatId}/branches/${branchId}/messages`,
    { userPrompt, contextBlockIds, contextRanges, ...options },
    { timeout: AI_REQUEST_TIMEOUT_MS },
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
    undefined,
    { timeout: AI_REQUEST_TIMEOUT_MS },
  )
  return data
}

export async function retryAiResponseJob(chatId: string, branchId: string, jobId: string): Promise<SendMessageResponse> {
  const { data } = await api.post<SendMessageResponse>(
    `/api/chats/${chatId}/branches/${branchId}/ai-response-jobs/${jobId}/retry`,
    undefined,
    { timeout: AI_REQUEST_TIMEOUT_MS },
  )
  return data
}

/** : 생성 중인 답변을 중단한다. 그때까지의 본문은 남는다. */
export async function cancelAiResponseJob(
  chatId: string,
  branchId: string,
  jobId: string,
): Promise<BlockResponse> {
  const { data } = await api.post<BlockResponse>(
    `/api/chats/${chatId}/branches/${branchId}/ai-response-jobs/${jobId}/cancel`,
  )
  return data
}

export type AiStreamStatus = 'completed' | 'failed' | 'cancelled'

export interface AiStreamDonePayload {
  status: AiStreamStatus
  content: string
  sources: SearchSource[]
  error: { errorCode: string; message: string } | null
}

export interface AiStreamHandlers {
  /** 0820_06 마일스톤 C: 스트림 연결이 열린 시각을 잰다. 재접속마다 다시 불린다. */
  onOpen?: () => void
  onText?: (delta: string) => void
  onSources?: (sources: SearchSource[]) => void
  onDone?: (payload: AiStreamDonePayload) => void
}

/**
 * , 009: 답변 조각을 실시간으로 받는다.
 *
 * 인증 헤더를 실어야 해서 EventSource 대신 fetch 로 직접 스트림을 읽는다
 * (문서 C2 참고). 도중에 붙어도 서버가 지금까지의 본문을 먼저 보내준다.
 */
export async function openAiResponseStream(
  chatId: string,
  branchId: string,
  jobId: string,
  handlers: AiStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const url = `${api.defaults.baseURL}/api/chats/${chatId}/branches/${branchId}/ai-response-jobs/${jobId}/stream`
  const res = await fetch(url, {
    headers: tokenStore.access ? { Authorization: `Bearer ${tokenStore.access}` } : undefined,
    signal,
  })
  if (!res.ok || !res.body) {
    throw new Error(`AI 응답 스트림 연결에 실패했습니다 (${res.status}).`)
  }
  handlers.onOpen?.()

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let sepIndex = buffer.indexOf('\n\n')
    while (sepIndex !== -1) {
      dispatchStreamEvent(buffer.slice(0, sepIndex), handlers)
      buffer = buffer.slice(sepIndex + 2)
      sepIndex = buffer.indexOf('\n\n')
    }
  }
}

function dispatchStreamEvent(raw: string, handlers: AiStreamHandlers) {
  let event = 'message'
  let dataLine = ''
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim()
    else if (line.startsWith('data:')) dataLine += line.slice('data:'.length).trim()
  }
  if (!dataLine) return // ": ping" 같은 하트비트 줄에는 data가 없다
  const data = JSON.parse(dataLine) as Record<string, unknown>
  if (event === 'text') handlers.onText?.(data.delta as string)
  else if (event === 'sources') handlers.onSources?.(data.sources as SearchSource[])
  else if (event === 'status') handlers.onDone?.(data as unknown as AiStreamDonePayload)
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
  contextRanges: ContextRangeIn[] = [],
): Promise<BlockResponse> {
  const { data } = await api.patch<BlockResponse>(
    `/api/chats/${chatId}/branches/${branchId}/blocks/${blockId}`,
    { editedContent, contextRanges },
  )
  return data
}

export async function fetchRefineJob(
  chatId: string,
  branchId: string,
  jobId: string,
): Promise<RefineJob> {
  const { data } = await api.get<RefineJob>(
    `/api/chats/${chatId}/branches/${branchId}/refine-jobs/${jobId}`,
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
    { timeout: AI_REQUEST_TIMEOUT_MS },
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

export type DeliveryOutcome = 'completed' | 'cancelled' | 'failed' | 'connection_failed'

export interface DeliveryTimingPayload {
  clickedAt: string | null
  blockShownAt: string | null
  streamConnectedAt: string | null
  firstChunkShownAt: string | null
  doneAt: string | null
  reconnectCount: number
  finalOutcome: DeliveryOutcome
}

/**
 * 0820_06 마일스톤 C: 화면이 잰 전달 시간을 서버에 남긴다. 질문·답변 본문은
 * 싣지 않는다. 개발·운영 조회용이라 실패해도 화면 흐름을 막지 않는다.
 */
export async function sendDeliveryTiming(
  chatId: string,
  branchId: string,
  jobId: string,
  payload: DeliveryTimingPayload,
): Promise<void> {
  await api.post(
    `/api/chats/${chatId}/branches/${branchId}/ai-response-jobs/${jobId}/delivery-timing`,
    payload,
  )
}
