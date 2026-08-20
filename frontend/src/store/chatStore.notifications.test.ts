// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError } from 'axios'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '@/lib/requestTimeout'

const chatApi = vi.hoisted(() => ({
  fetchChats: vi.fn(),
  fetchChat: vi.fn(),
  createChat: vi.fn(),
  fetchBranch: vi.fn(),
  fetchBranches: vi.fn(),
  createBranch: vi.fn(),
}))
const conversationApi = vi.hoisted(() => ({
  fetchFeedback: vi.fn(),
  runRefine: vi.fn(),
  approveAll: vi.fn(),
  rejectAll: vi.fn(),
}))

vi.mock('@/api/chat', () => chatApi)
vi.mock('@/api/conversation', () => conversationApi)
vi.mock('@/api/inputAssist', () => ({}))

import { useChatStore } from '@/store/chatStore'
import { useNotificationStore } from '@/store/notificationStore'
import { useSettingsStore } from '@/store/settingsStore'

const originalOpenApiKey = useSettingsStore.getState().openApiKey

describe('chatStore 공통 오류 안내', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useNotificationStore.getState().clearToast()
    useNotificationStore.getState().dismissBanner()
    useSettingsStore.setState({ activeModal: null, openApiKey: originalOpenApiKey })
    useChatStore.setState({
      chats: [],
      nextCursor: null,
      chatListKeyword: '',
      chatListError: null,
      isLoadingChats: false,
      isLoadingMoreChats: false,
      chatId: 'chat-1',
      branchId: 'branch-1',
      branches: [],
      blocks: [],
      selectedBlockIds: ['block-1'],
      refineJob: null,
      error: null,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    useSettingsStore.setState({ openApiKey: originalOpenApiKey })
  })

  it('검색 시간이 초과되면 AbortSignal을 전달하고 다시 시도 action을 제공한다', async () => {
    vi.useFakeTimers()
    chatApi.fetchChats.mockReturnValue(new Promise(() => undefined))

    const pending = useChatStore.getState().loadChats('느린 검색')
    await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS)
    await pending

    const banner = useNotificationStore.getState().banner
    expect(chatApi.fetchChats).toHaveBeenCalledWith(
      { keyword: '느린 검색' },
      expect.any(AbortSignal),
    )
    expect(banner).toMatchObject({
      errorCode: 'REQUEST_TIMEOUT',
      scope: 'chat-list',
      action: { label: '다시 시도' },
    })
  })

  it('늦게 끝난 이전 검색이 최신 검색 결과를 덮지 않는다', async () => {
    let finishOld: (value: unknown) => void = () => undefined
    let finishNew: (value: unknown) => void = () => undefined
    chatApi.fetchChats
      .mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { finishNew = resolve }))

    const oldRequest = useChatStore.getState().loadChats('이전')
    const newRequest = useChatStore.getState().loadChats('최신')
    finishNew({ chats: [{ chatId: 'new', title: '최신 결과' }], nextCursor: null })
    await newRequest
    finishOld({ chats: [{ chatId: 'old', title: '이전 결과' }], nextCursor: null })
    await oldRequest

    expect(useChatStore.getState().chats).toEqual([
      { chatId: 'new', title: '최신 결과' },
    ])
    expect(useChatStore.getState().chatListKeyword).toBe('최신')
  })

  it('API 키가 없으면 모달 대신 설정 action이 있는 배너를 보여준다', async () => {
    const openApiKey = vi.fn()
    useSettingsStore.setState({ openApiKey })
    const error = new AxiosError('API key missing')
    Object.assign(error, {
      response: {
        status: 400,
        data: {
          errorCode: 'API_KEY_NOT_REGISTERED',
          message: 'API 키가 없습니다.',
          detail: null,
          traceId: 'trace-1',
        },
        headers: {},
      },
    })
    conversationApi.runRefine.mockRejectedValue(error)

    useChatStore.setState({ refineTargetBlockId: 'block-1' })
    await useChatStore.getState().runRefine('요약')

    const banner = useNotificationStore.getState().banner
    expect(openApiKey).not.toHaveBeenCalled()
    expect(banner).toMatchObject({
      errorCode: 'API_KEY_NOT_REGISTERED',
      scope: 'api-key-required',
      action: { label: 'API 키 설정' },
    })
    banner?.action?.run()
    expect(openApiKey).toHaveBeenCalledOnce()
  })

  it('전체 처리의 부분 실패 사유를 항목별로 배너에 표시한다', async () => {
    useChatStore.setState({
      refineJob: {
        refineJobId: 'job-1',
        status: 'pending',
        instructionText: '요약',
        results: [],
      },
    })
    conversationApi.approveAll.mockResolvedValue({
      processed: [],
      failed: [
        { resourceId: '1', resultId: '1', errorCode: 'ITEM_NOT_FOUND', message: '첫 번째 항목을 찾을 수 없습니다.', reason: '첫 번째 항목을 찾을 수 없습니다.' },
        { resourceId: '2', resultId: '2', errorCode: 'VERSION_CONFLICT', message: '두 번째 항목이 이미 변경되었습니다.', reason: '두 번째 항목이 이미 변경되었습니다.' },
      ],
      actionMeta: {
        actionType: 'bulk_refine_approve',
        successCode: 'PARTIAL_SUCCESS',
        message: '2개 중 0개를 처리했습니다.',
        affectedResourceId: 'job-1',
      },
    })
    chatApi.fetchChat.mockResolvedValue({ messageBlocks: [] })

    await useChatStore.getState().approveAll()

    expect(useNotificationStore.getState().banner).toMatchObject({
      scope: 'bulk-refine',
      details: [
        '1. 첫 번째 항목을 찾을 수 없습니다.',
        '2. 두 번째 항목이 이미 변경되었습니다.',
      ],
      action: { label: '실패 항목 다시 시도' },
    })
  })
})
