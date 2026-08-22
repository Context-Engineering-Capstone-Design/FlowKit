// @vitest-environment jsdom

/**
 * 0821_05 마일스톤 C, D3: 다른 창의 실시간 이벤트를 받아 chatStore가 반영하는지 확인한다.
 *
 * openRealtimeStream을 흉내내는 가짜 구현으로 handlers를 붙잡아 두고, 서버가
 * 이벤트를 보낸 것처럼 그 handlers를 직접 호출해 검증한다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RealtimeChatActivity, RealtimeHandlers } from '@/api/realtime'

const chatApi = vi.hoisted(() => ({
  fetchChats: vi.fn(),
  fetchChat: vi.fn(),
}))
const convApi = vi.hoisted(() => ({
  openAiResponseStream: vi.fn(),
}))
const realtimeApiMock = vi.hoisted(() => ({
  openRealtimeStream: vi.fn(),
}))

vi.mock('@/api/chat', () => chatApi)
vi.mock('@/api/conversation', () => convApi)
vi.mock('@/api/realtime', () => realtimeApiMock)
vi.mock('@/api/inputAssist', () => ({}))

import { connectRealtime, disconnectRealtime, useChatStore } from '@/store/chatStore'

/** openRealtimeStream이 실제 SSE처럼 계속 열려 있다가 abort될 때만 끝나는 것처럼 흉내낸다. */
function stubOpenConnection(): () => RealtimeHandlers {
  let captured: RealtimeHandlers | null = null
  realtimeApiMock.openRealtimeStream.mockImplementation(
    (handlers: RealtimeHandlers, signal: AbortSignal) =>
      new Promise<void>((resolve) => {
        captured = handlers
        handlers.onOpen?.()
        signal.addEventListener('abort', () => resolve())
      }),
  )
  return () => {
    if (!captured) throw new Error('openRealtimeStream이 아직 호출되지 않았다')
    return captured
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

describe('chatStore 실시간 이벤트 (0821_05)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chatApi.fetchChats.mockResolvedValue({ chats: [], nextCursor: null })
    useChatStore.setState({
      chats: [],
      nextCursor: null,
      chatListKeyword: '',
      chatId: null,
      branchId: null,
      blocks: [],
      chatTitle: '',
    })
  })

  afterEach(() => {
    disconnectRealtime()
  })

  it('connectRealtime을 여러 번 불러도 연결은 하나만 연다', () => {
    const getHandlers = stubOpenConnection()
    connectRealtime()
    connectRealtime()
    expect(realtimeApiMock.openRealtimeStream).toHaveBeenCalledTimes(1)
    expect(getHandlers()).toBeTruthy()
  })

  it('chats_changed를 받으면 사이드바 목록을 다시 불러온다', async () => {
    const getHandlers = stubOpenConnection()
    connectRealtime()
    getHandlers().onChatsChanged?.()
    await vi.waitFor(() => expect(chatApi.fetchChats).toHaveBeenCalled())
  })

  it('지금 열려 있지 않은 대화의 chat_activity는 무시한다', () => {
    useChatStore.setState({ chatId: 'chat-1', branchId: 'branch-1' })
    const getHandlers = stubOpenConnection()
    connectRealtime()
    getHandlers().onChatActivity?.({ chatId: 'chat-2', branchId: 'branch-2', jobId: null } satisfies RealtimeChatActivity)
    expect(chatApi.fetchChat).not.toHaveBeenCalled()
  })

  it('지금 열려 있는 대화의 chat_activity는 블록과 제목을 조용히 다시 불러온다', async () => {
    useChatStore.setState({ chatId: 'chat-1', branchId: 'branch-1', chatTitle: '이전 제목', blocks: [] })
    chatApi.fetchChat.mockResolvedValue({
      chatMeta: { title: '새 제목' },
      messageBlocks: [{ blockId: 'b1', role: 'assistant', generationStatus: 'complete' }],
    })
    const getHandlers = stubOpenConnection()
    connectRealtime()

    getHandlers().onChatActivity?.({ chatId: 'chat-1', branchId: 'branch-1', jobId: null } satisfies RealtimeChatActivity)

    await vi.waitFor(() => expect(useChatStore.getState().chatTitle).toBe('새 제목'))
    expect(chatApi.fetchChat).toHaveBeenCalledWith('chat-1', 'branch-1')
    expect(useChatStore.getState().blocks).toEqual([
      { blockId: 'b1', role: 'assistant', generationStatus: 'complete' },
    ])
  })

  it('늦게 도착한 이전 chat_activity 조회가 최신 상태를 덮지 않는다', async () => {
    useChatStore.setState({ chatId: 'chat-1', branchId: 'branch-1', activeTabId: 'chat-1', chatTitle: '이전', blocks: [] })
    const first = deferred<unknown>()
    const second = deferred<unknown>()
    chatApi.fetchChat.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const getHandlers = stubOpenConnection()
    connectRealtime()

    getHandlers().onChatActivity?.({ chatId: 'chat-1', branchId: 'branch-1', jobId: 'job-1' } satisfies RealtimeChatActivity)
    getHandlers().onChatActivity?.({ chatId: 'chat-1', branchId: 'branch-1', jobId: null } satisfies RealtimeChatActivity)
    second.resolve({
      chatMeta: { title: '완료된 Self-Attention' },
      messageBlocks: [{ blockId: 'new', role: 'assistant', generationStatus: 'complete' }],
    })
    await vi.waitFor(() => expect(useChatStore.getState().chatTitle).toBe('완료된 Self-Attention'))

    first.resolve({
      chatMeta: { title: '생성 중인 이전 상태' },
      messageBlocks: [{ blockId: 'old', role: 'assistant', generationStatus: 'generating' }],
    })
    await Promise.resolve()

    expect(useChatStore.getState().chatTitle).toBe('완료된 Self-Attention')
    expect(useChatStore.getState().blocks).toEqual([
      { blockId: 'new', role: 'assistant', generationStatus: 'complete' },
    ])
  })

  it('jobId가 있는 chat_activity를 받으면 생성 중인 블록에 다시 붙는다', async () => {
    useChatStore.setState({ chatId: 'chat-1', branchId: 'branch-1', blocks: [] })
    chatApi.fetchChat.mockResolvedValue({
      chatMeta: { title: '제목' },
      messageBlocks: [
        { blockId: 'b1', role: 'assistant', generationStatus: 'generating', generationJobId: 'job-1' },
      ],
    })
    convApi.openAiResponseStream.mockReturnValue(new Promise(() => undefined))
    const getHandlers = stubOpenConnection()
    connectRealtime()

    getHandlers().onChatActivity?.({ chatId: 'chat-1', branchId: 'branch-1', jobId: 'job-1' } satisfies RealtimeChatActivity)

    await vi.waitFor(() =>
      expect(convApi.openAiResponseStream).toHaveBeenCalledWith(
        'chat-1',
        'branch-1',
        'job-1',
        expect.anything(),
        expect.anything(),
      ),
    )
  })

  it('이미 그 블록에 스트림이 붙어 있으면 chat_activity로 중복 연결하지 않는다', async () => {
    useChatStore.setState({ chatId: 'chat-1', branchId: 'branch-1', blocks: [] })
    chatApi.fetchChat.mockResolvedValue({
      chatMeta: { title: '제목' },
      messageBlocks: [
        { blockId: 'b1', role: 'assistant', generationStatus: 'generating', generationJobId: 'job-1' },
      ],
    })
    convApi.openAiResponseStream.mockReturnValue(new Promise(() => undefined))
    const getHandlers = stubOpenConnection()
    connectRealtime()

    // 이 창 자신이 이미 이 블록에 붙어 있는 상태를 흉내낸다.
    void useChatStore.getState().attachToJob('b1', 'job-1')
    await vi.waitFor(() => expect(convApi.openAiResponseStream).toHaveBeenCalledTimes(1))

    getHandlers().onChatActivity?.({ chatId: 'chat-1', branchId: 'branch-1', jobId: 'job-1' } satisfies RealtimeChatActivity)
    await vi.waitFor(() => expect(chatApi.fetchChat).toHaveBeenCalled())

    // 재조회는 했지만, 이미 붙어 있던 스트림이라 다시 연결하지는 않는다.
    expect(convApi.openAiResponseStream).toHaveBeenCalledTimes(1)
  })
})
