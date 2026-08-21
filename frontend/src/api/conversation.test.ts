// @vitest-environment jsdom

import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { openAiResponseStream } from '@/api/conversation'

function sseResponse(events: string[]) {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(event))
      controller.close()
    },
  }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  })
})

it('재접속 스냅샷은 누적 본문과 구분해 전달한다', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([
    'event: snapshot\ndata: {"content":"Self-Attention","sources":[]}\n\n',
    'event: text\ndata: {"delta":"은 토큰 관계를 계산합니다."}\n\n',
    'event: status\ndata: {"status":"completed","content":"Self-Attention은 토큰 관계를 계산합니다.","sources":[],"error":null}\n\n',
  ])))
  const snapshots: string[] = []
  const deltas: string[] = []

  await openAiResponseStream('chat-1', 'branch-1', 'job-1', {
    onSnapshot: (content) => snapshots.push(content),
    onText: (delta) => deltas.push(delta),
  })

  expect(snapshots).toEqual(['Self-Attention'])
  expect(deltas).toEqual(['은 토큰 관계를 계산합니다.'])
})

it('완료 상태 없이 끝난 스트림은 재접속 경로로 넘긴다', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([
    'event: text\ndata: {"delta":"중간 본문"}\n\n',
  ])))

  await expect(openAiResponseStream('chat-1', 'branch-1', 'job-1', {})).rejects.toThrow('완료 상태 없이')
})
