import { api, tokenStore } from './client'

export interface RealtimeChatActivity {
  chatId: string
  branchId: string
  jobId: string | null
}

export interface RealtimeHandlers {
  onOpen?: () => void
  onChatsChanged?: () => void
  onChatActivity?: (data: RealtimeChatActivity) => void
}

/**
 * 0821_05: 같은 계정의 다른 창에 생긴 변화를 "다시 확인해봐" 신호로 받는다.
 *
 * openAiResponseStream 과 같은 이유로 EventSource 대신 fetch 로 직접 읽는다 —
 * 인증 헤더를 실어야 한다.
 */
export async function openRealtimeStream(
  handlers: RealtimeHandlers,
  signal: AbortSignal,
): Promise<void> {
  const url = `${api.defaults.baseURL}/api/realtime/stream`
  const res = await fetch(url, {
    headers: tokenStore.access ? { Authorization: `Bearer ${tokenStore.access}` } : undefined,
    signal,
  })
  if (!res.ok || !res.body) {
    throw new Error(`실시간 연결에 실패했습니다 (${res.status}).`)
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
      dispatchRealtimeEvent(buffer.slice(0, sepIndex), handlers)
      buffer = buffer.slice(sepIndex + 2)
      sepIndex = buffer.indexOf('\n\n')
    }
  }
}

function dispatchRealtimeEvent(raw: string, handlers: RealtimeHandlers) {
  let event = 'message'
  let dataLine = ''
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim()
    else if (line.startsWith('data:')) dataLine += line.slice('data:'.length).trim()
  }
  if (!dataLine) return // ": ping" 같은 하트비트 줄에는 data가 없다
  const data = JSON.parse(dataLine) as Record<string, unknown>
  if (event === 'chats_changed') handlers.onChatsChanged?.()
  else if (event === 'chat_activity') {
    handlers.onChatActivity?.({
      chatId: data.chatId as string,
      branchId: data.branchId as string,
      jobId: (data.jobId as string | undefined) ?? null,
    })
  }
}
