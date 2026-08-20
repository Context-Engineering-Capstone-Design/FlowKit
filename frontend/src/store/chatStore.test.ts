// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

const chatApi = vi.hoisted(() => ({
  fetchChats: vi.fn(),
  createChat: vi.fn(),
  fetchChat: vi.fn(),
  fetchBranch: vi.fn(),
  fetchBranches: vi.fn(),
  createBranch: vi.fn(),
  deleteChat: vi.fn(),
}))

const convApi = vi.hoisted(() => ({
  fetchFeedback: vi.fn(),
  sendMessage: vi.fn(),
  regenerate: vi.fn(),
  retryAiResponseJob: vi.fn(),
  cancelAiResponseJob: vi.fn(),
  openAiResponseStream: vi.fn().mockResolvedValue(undefined),
  sendDeliveryTiming: vi.fn().mockResolvedValue(undefined),
  fetchRefineJob: vi.fn(),
  approveResult: vi.fn(),
  rejectResult: vi.fn(),
}))

const sideChatApi = vi.hoisted(() => ({
  createSideChat: vi.fn(),
  fetchSideChatChildren: vi.fn(),
  fetchSideChatTree: vi.fn().mockResolvedValue({ rootChatId: null, chats: [] }),
  importBlocksAsMessages: vi.fn(),
}))

vi.mock('@/api/chat', () => chatApi)
vi.mock('@/api/conversation', () => convApi)
vi.mock('@/api/inputAssist', () => ({}))
vi.mock('@/api/sideChat', () => sideChatApi)

import { useChatStore } from '@/store/chatStore'
import { useConfirmStore } from '@/store/confirmStore'

describe('chatStore 화면 상태', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useChatStore.setState({
      chats: [], nextCursor: null, chatListKeyword: '', chatListError: null,
      chatId: 'chat-1', branchId: 'branch-1', branches: [], blocks: [],
      selectedBlockIds: [], appliedBlockIds: [], appliedContextLabel: null,
      contextInstruction: '', draftText: '', draftAttachments: [],
      editingBlockId: null, editingDraft: '', editingOriginal: '',
      deletingChatId: null,
      tabs: [{ id: 'chat-1', chatId: 'chat-1', branchId: 'branch-1', title: '대화', kind: 'MAIN', parentChatId: null }],
      activeTabId: 'chat-1',
      sideChatsByBlockId: {}, sideChatTree: [], sideChatTreeRootId: null, isCreatingSideChat: false,
    })
  })

  it('검색 cursor 다음 페이지를 중복 없이 이어 붙인다', async () => {
    chatApi.fetchChats
      .mockResolvedValueOnce({ chats: [{ chatId: '1', title: '첫째' }], nextCursor: 'cursor-1' })
      .mockResolvedValueOnce({ chats: [{ chatId: '1', title: '첫째' }, { chatId: '2', title: '둘째' }], nextCursor: null })

    await useChatStore.getState().loadChats('검색어')
    await useChatStore.getState().loadMoreChats()

    expect(chatApi.fetchChats).toHaveBeenLastCalledWith(
      { cursor: 'cursor-1', keyword: '검색어' },
      expect.any(AbortSignal),
    )
    expect(useChatStore.getState().chats.map((item) => item.chatId)).toEqual(['1', '2'])
  })

  it('검색어 앞뒤 공백을 제거하고 공백만 입력하면 전체 목록을 요청한다', async () => {
    chatApi.fetchChats.mockResolvedValue({ chats: [], nextCursor: null })

    await useChatStore.getState().loadChats('  검색어  ')
    expect(chatApi.fetchChats).toHaveBeenLastCalledWith(
      { keyword: '검색어' },
      expect.any(AbortSignal),
    )

    await useChatStore.getState().loadChats('   ')
    expect(chatApi.fetchChats).toHaveBeenLastCalledWith(
      { keyword: undefined },
      expect.any(AbortSignal),
    )
  })

  it('Context 이름을 적용하고 해제해도 선택은 유지한다', () => {
    useChatStore.setState({ selectedBlockIds: ['block-1'], contextInstruction: '  핵심만 요약  ', focusSignal: 0 })

    useChatStore.getState().applyContext()
    expect(useChatStore.getState()).toMatchObject({ appliedBlockIds: ['block-1'], appliedContextLabel: '핵심만 요약', focusSignal: 1 })

    useChatStore.getState().clearAppliedContext()
    expect(useChatStore.getState()).toMatchObject({ appliedBlockIds: [], selectedBlockIds: ['block-1'] })
  })

  it('수정 중인 메시지가 있으면 채팅 이탈을 확인한다', async () => {
    const request = vi.fn().mockResolvedValue(false)
    useConfirmStore.setState({ request })
    await useChatStore.getState().startEdit('block-1', '원본')
    useChatStore.getState().setEditingDraft('수정 중')

    await useChatStore.getState().newChat()

    expect(request).toHaveBeenCalledOnce()
    expect(chatApi.createChat).not.toHaveBeenCalled()
  })

  it('브랜치를 바꾸면 Context 지시와 편집 초안을 초기화한다', async () => {
    chatApi.fetchBranch.mockResolvedValue({
      branchMeta: { branchId: 'branch-2' }, messageBlocks: [], sourceContextInfo: [],
    })
    useChatStore.setState({ contextInstruction: '유지되면 안 됨', editingBlockId: 'block-1', editingDraft: '원본', editingOriginal: '원본' })

    await useChatStore.getState().switchBranch('branch-2')

    expect(useChatStore.getState()).toMatchObject({ branchId: 'branch-2', contextInstruction: '', editingBlockId: null })
  })

  it('확인을 취소하면 대화를 삭제하지 않는다', async () => {
    const request = vi.fn().mockResolvedValue(false)
    useConfirmStore.setState({ request })
    useChatStore.setState({ chats: [{ chatId: 'chat-1', title: '새 대화' }] })

    await useChatStore.getState().deleteChat('chat-1')

    expect(chatApi.deleteChat).not.toHaveBeenCalled()
    expect(useChatStore.getState().chats).toEqual([{ chatId: 'chat-1', title: '새 대화' }])
  })

  it('다른 대화를 삭제하면 목록에서만 뺀다', async () => {
    const request = vi.fn().mockResolvedValue(true)
    useConfirmStore.setState({ request })
    chatApi.deleteChat.mockResolvedValue({
      deleteSuccess: true,
      actionMeta: { actionType: 'chat_delete', successCode: 'CHAT_DELETED', message: '대화를 삭제했습니다.', affectedResourceId: 'chat-2' },
    })
    useChatStore.setState({
      chatId: 'chat-1',
      chats: [
        { chatId: 'chat-1', title: '현재' },
        { chatId: 'chat-2', title: '다른 대화' },
      ],
    })

    await useChatStore.getState().deleteChat('chat-2')

    expect(chatApi.deleteChat).toHaveBeenCalledWith('chat-2')
    expect(chatApi.createChat).not.toHaveBeenCalled()
    expect(useChatStore.getState().chats).toEqual([{ chatId: 'chat-1', title: '현재' }])
    expect(useChatStore.getState().chatId).toBe('chat-1')
  })

  it('지금 열린 대화를 삭제하면 빈 새 대화 화면으로 돌아간다', async () => {
    const request = vi.fn().mockResolvedValue(true)
    useConfirmStore.setState({ request })
    chatApi.deleteChat.mockResolvedValue({
      deleteSuccess: true,
      actionMeta: { actionType: 'chat_delete', successCode: 'CHAT_DELETED', message: '대화를 삭제했습니다.', affectedResourceId: 'chat-1' },
    })
    useChatStore.setState({
      chatId: 'chat-1',
      chats: [{ chatId: 'chat-1', title: '새 대화' }],
    })

    await useChatStore.getState().deleteChat('chat-1')

    expect(chatApi.deleteChat).toHaveBeenCalledWith('chat-1')
    // 실제 대화는 사용자가 첫 메시지를 보낼 때 만든다. 삭제 직후 API로 새로 만들지 않는다.
    expect(chatApi.createChat).not.toHaveBeenCalled()
    expect(useChatStore.getState().chatId).toBeNull()
  })

  it('전송에 성공하면 임시 질문 블록을 실제 블록으로 바꾼다 (FE-AIRESP-001)', async () => {
    convApi.sendMessage.mockResolvedValue({
      userBlock: { blockId: 'u1', branchId: 'branch-1', role: 'user', content: '질문', currentVersionId: null, orderIndex: 0, createdAt: 't', attachments: [], searchSources: [] },
      assistantBlock: { blockId: 'a1', branchId: 'branch-1', role: 'assistant', content: '답변', currentVersionId: 'v1', orderIndex: 1, createdAt: 't', attachments: [], searchSources: [] },
      chatTitle: '대화',
      titleGenerated: false,
    })

    const promise = useChatStore.getState().sendMessage('질문')
    expect(useChatStore.getState().blocks).toHaveLength(1)
    expect(useChatStore.getState().blocks[0].content).toBe('질문')

    await promise

    expect(useChatStore.getState().blocks.map((b) => b.blockId)).toEqual(['u1', 'a1'])
  })

  it('기본 웹 검색 상태는 끄기이고, 고른 상태 그대로 전송한다 (AI-SEARCH-001)', async () => {
    convApi.sendMessage.mockResolvedValue({
      userBlock: { blockId: 'u1', branchId: 'branch-1', role: 'user', content: '질문', currentVersionId: null, orderIndex: 0, createdAt: 't', attachments: [], searchSources: [] },
      assistantBlock: { blockId: 'a1', branchId: 'branch-1', role: 'assistant', content: '답변', currentVersionId: 'v1', orderIndex: 1, createdAt: 't', attachments: [], searchSources: [] },
      chatTitle: '대화',
      titleGenerated: false,
    })
    expect(useChatStore.getState().webSearchMode).toBe('off')

    await useChatStore.getState().sendMessage('질문')

    expect(convApi.sendMessage).toHaveBeenCalledWith(
      'chat-1', 'branch-1', '질문', [],
      expect.objectContaining({ webSearchMode: 'off' }),
    )

    useChatStore.getState().setWebSearchMode('always')
    await useChatStore.getState().sendMessage('질문')

    expect(convApi.sendMessage).toHaveBeenLastCalledWith(
      'chat-1', 'branch-1', '질문', [],
      expect.objectContaining({ webSearchMode: 'always' }),
    )
  })

  it('질문이 저장되기 전에 실패하면 입력 내용을 그대로 남긴다 (FE-INPUT-006)', async () => {
    convApi.sendMessage.mockRejectedValue({
      isAxiosError: true,
      response: { data: { errorCode: 'MODEL_NOT_SUPPORTED', message: '지원하지 않는 모델입니다.' } },
    })
    useChatStore.setState({ draftText: '질문 내용', blocks: [] })

    await useChatStore.getState().sendMessage('질문 내용')

    const state = useChatStore.getState()
    expect(state.blocks).toEqual([])
    expect(state.draftText).toBe('질문 내용')
    expect(state.error).toBeTruthy()
    expect(chatApi.fetchChat).not.toHaveBeenCalled()
  })

  it('질문이 저장된 뒤 실패하면 화면을 다시 불러와 입력을 비운다', async () => {
    convApi.sendMessage.mockRejectedValue({
      isAxiosError: true,
      response: {
        data: {
          errorCode: 'AI_RESPONSE_FAILED',
          message: '답변 생성 실패',
          detail: { aiResponseJobId: 'job-1', userMessageBlockId: 'user-1', retryable: true },
        },
      },
    })
    chatApi.fetchChat.mockResolvedValue({
      chatMeta: { chatId: 'chat-1', title: '대화' },
      branchMeta: { branchId: 'branch-1' },
      messageBlocks: [],
      branchList: [],
    })
    convApi.fetchFeedback.mockResolvedValue({ aiMessageBlockId: 'x', rating: null })
    useChatStore.setState({ draftText: '질문' })

    await useChatStore.getState().sendMessage('질문')

    expect(chatApi.fetchChat).toHaveBeenCalledWith('chat-1', 'branch-1')
    const state = useChatStore.getState()
    expect(state.draftText).toBe('')
    expect(state.failedJobsByBlockId).toEqual({ 'user-1': 'job-1' })
  })

  it('이미 처리된 정제 결과를 승인·거절하면 최신 상태로 다시 맞춘다 (FE-REFINE-005)', async () => {
    const job = { refineJobId: 'job-1', status: 'completed', instructionText: '요약', results: [] }
    convApi.approveResult.mockRejectedValue({
      isAxiosError: true,
      response: { data: { errorCode: 'REFINE_RESULT_NOT_PENDING', message: '이미 처리된 결과입니다.' } },
    })
    convApi.fetchRefineJob.mockResolvedValue(job)
    useChatStore.setState({ refineJob: { refineJobId: 'job-1', status: 'completed', instructionText: '요약', results: [{ resultId: 'r1', blockId: 'b1', baseVersionId: 'v1', baseContent: '원본', refinedContent: '정제', status: 'pending', approvedVersionId: null, orderIndex: 0, updatedAt: 't' }] } })

    await useChatStore.getState().approveResult('r1')

    expect(convApi.fetchRefineJob).toHaveBeenCalledWith('chat-1', 'branch-1', 'job-1')
    expect(useChatStore.getState().refineJob).toEqual(job)
  })

  it('화면을 열거나 새 채팅 버튼을 눌러도 대화를 만들지 않는다', async () => {
    useChatStore.setState({ chatId: 'chat-1', branchId: 'branch-1' })

    await useChatStore.getState().newChat()

    expect(chatApi.createChat).not.toHaveBeenCalled()
    expect(useChatStore.getState().chatId).toBeNull()
    expect(useChatStore.getState().branchId).toBeNull()
  })

  it('빈 화면에서 첫 메시지를 보내면 그때 대화를 만든 뒤 전송한다', async () => {
    chatApi.createChat.mockResolvedValue({
      chatMeta: { chatId: 'chat-new', title: '새 대화' },
      branchMeta: { branchId: 'branch-new' },
      messageBlocks: [],
      branchList: [],
    })
    chatApi.fetchChats.mockResolvedValue({ chats: [], nextCursor: null })
    convApi.sendMessage.mockResolvedValue({
      userBlock: { blockId: 'u1', branchId: 'branch-new', role: 'user', content: '질문', currentVersionId: null, orderIndex: 0, createdAt: 't', attachments: [], searchSources: [] },
      assistantBlock: { blockId: 'a1', branchId: 'branch-new', role: 'assistant', content: '답변', currentVersionId: 'v1', orderIndex: 1, createdAt: 't', attachments: [], searchSources: [] },
      chatTitle: '새 대화',
      titleGenerated: false,
    })
    useChatStore.setState({ chatId: null, branchId: null, blocks: [] })

    await useChatStore.getState().sendMessage('질문')

    expect(chatApi.createChat).toHaveBeenCalledOnce()
    expect(convApi.sendMessage).toHaveBeenCalledWith('chat-new', 'branch-new', '질문', [], expect.anything())
    expect(useChatStore.getState().chatId).toBe('chat-new')
    expect(useChatStore.getState().blocks.map((b) => b.blockId)).toEqual(['u1', 'a1'])
  })

  it('전송 뒤 빈 답변 블록에 스트리밍 통로로 도착한 글자를 이어 붙인다 (FE-AIRESP-005)', async () => {
    convApi.sendMessage.mockResolvedValue({
      userBlock: { blockId: 'u1', branchId: 'branch-1', role: 'user', content: '질문', currentVersionId: null, orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' },
      assistantBlock: { blockId: 'a1', branchId: 'branch-1', role: 'assistant', content: '', currentVersionId: 'v1', orderIndex: 1, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'generating' },
      chatTitle: '대화',
      titleGenerated: false,
      aiResponseJobId: 'job-1',
      jobStatus: 'generating',
    })
    convApi.openAiResponseStream.mockImplementation(async (_c, _b, _j, handlers) => {
      handlers.onText?.('안')
      handlers.onText?.('녕')
      handlers.onDone?.({ status: 'completed', content: '안녕', sources: [], error: null })
    })

    await useChatStore.getState().sendMessage('질문')

    expect(convApi.openAiResponseStream).toHaveBeenCalledWith(
      'chat-1', 'branch-1', 'job-1', expect.anything(), expect.any(AbortSignal),
    )
    const block = useChatStore.getState().blocks.find((b) => b.blockId === 'a1')
    expect(block?.content).toBe('안녕')
    expect(block?.generationStatus).toBe('complete')
  })

  it('스트리밍이 끝나면 화면 전달 시간을 서버에 보낸다 (0820_06 마일스톤 C)', async () => {
    convApi.sendMessage.mockResolvedValue({
      userBlock: { blockId: 'u1', branchId: 'branch-1', role: 'user', content: '질문', currentVersionId: null, orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' },
      assistantBlock: { blockId: 'a1', branchId: 'branch-1', role: 'assistant', content: '', currentVersionId: 'v1', orderIndex: 1, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'generating' },
      chatTitle: '대화',
      titleGenerated: false,
      aiResponseJobId: 'job-1',
      jobStatus: 'generating',
    })
    convApi.openAiResponseStream.mockImplementation(async (_c, _b, _j, handlers) => {
      handlers.onOpen?.()
      handlers.onText?.('안녕')
      handlers.onDone?.({ status: 'completed', content: '안녕', sources: [], error: null })
    })

    await useChatStore.getState().sendMessage('질문')

    expect(convApi.sendDeliveryTiming).toHaveBeenCalledWith(
      'chat-1', 'branch-1', 'job-1',
      expect.objectContaining({ finalOutcome: 'completed', reconnectCount: 0 }),
    )
    const payload = convApi.sendDeliveryTiming.mock.calls.at(-1)?.[3]
    expect(payload.clickedAt).not.toBeNull()
    expect(payload.streamConnectedAt).not.toBeNull()
    expect(payload.firstChunkShownAt).not.toBeNull()
    // 질문·답변 원문은 어떤 필드에도 실리지 않는다.
    expect(JSON.stringify(payload)).not.toContain('질문')
    expect(JSON.stringify(payload)).not.toContain('안녕')
  })

  it('중단하면 화면 전달 시간을 cancelled로 보낸다', async () => {
    useChatStore.setState({
      blocks: [
        { blockId: 'a1', branchId: 'branch-1', role: 'assistant', content: '안', currentVersionId: 'v1', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'generating', generationJobId: 'job-1' },
      ],
    })
    // 연결이 아직 열려 있는 상태를 흉내 낸다 — onDone이 오지 않아야 cancelGeneration의
    // 명시적 flush를 그대로 검증할 수 있다.
    convApi.openAiResponseStream.mockImplementation(() => new Promise(() => {}))
    void useChatStore.getState().attachToJob('a1', 'job-1')
    convApi.cancelAiResponseJob.mockResolvedValue({
      blockId: 'a1', branchId: 'branch-1', role: 'assistant', content: '안녕', currentVersionId: 'v1', versionNo: 1, orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'cancelled',
    })

    await useChatStore.getState().cancelGeneration('a1')

    expect(convApi.sendDeliveryTiming).toHaveBeenCalledWith(
      'chat-1', 'branch-1', 'job-1',
      expect.objectContaining({ finalOutcome: 'cancelled' }),
    )
  })

  it('중단하면 서버가 돌려준 그때까지의 본문으로 블록을 확정한다 (BE-AIRESP-008)', async () => {
    useChatStore.setState({
      blocks: [
        { blockId: 'a1', branchId: 'branch-1', role: 'assistant', content: '안', currentVersionId: 'v1', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'generating', generationJobId: 'job-1' },
      ],
    })
    convApi.cancelAiResponseJob.mockResolvedValue({
      blockId: 'a1', branchId: 'branch-1', role: 'assistant', content: '안녕', currentVersionId: 'v1', versionNo: 1, orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'cancelled',
    })

    await useChatStore.getState().cancelGeneration('a1')

    expect(convApi.cancelAiResponseJob).toHaveBeenCalledWith('chat-1', 'branch-1', 'job-1')
    const block = useChatStore.getState().blocks.find((b) => b.blockId === 'a1')
    expect(block?.content).toBe('안녕')
    expect(block?.generationStatus).toBe('cancelled')
    expect(block?.generationJobId).toBeNull()
  })

  it('대화를 열 때 아직 생성 중인 블록이 있으면 자동으로 다시 붙는다 (문서 C6)', async () => {
    chatApi.fetchChat.mockResolvedValue({
      chatMeta: { chatId: 'chat-1', title: '대화' },
      branchMeta: { branchId: 'branch-1' },
      messageBlocks: [
        { blockId: 'a1', branchId: 'branch-1', role: 'assistant', content: '이어', currentVersionId: 'v1', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'generating', generationJobId: 'job-1' },
      ],
      branchList: [],
    })
    convApi.fetchFeedback.mockResolvedValue({ aiMessageBlockId: 'a1', rating: null })
    convApi.openAiResponseStream.mockImplementation(async (_c, _b, _j, handlers) => {
      handlers.onDone?.({ status: 'completed', content: '이어서 완료', sources: [], error: null })
    })

    await useChatStore.getState().openChat('chat-1', 'branch-1')

    expect(convApi.openAiResponseStream).toHaveBeenCalledWith(
      'chat-1', 'branch-1', 'job-1', expect.anything(), expect.any(AbortSignal),
    )
    expect(useChatStore.getState().blocks[0].content).toBe('이어서 완료')
  })
})

const mainMeta = (overrides: Record<string, unknown> = {}) => ({
  chatId: 'chat-2', title: '다른 대화', kind: 'MAIN', parentChatId: null,
  parentBranchId: null, parentMessageBlockId: null, rootChatId: null, rootBranchId: null,
  ...overrides,
})

// 0820_08 마일스톤 B: 메인·사이드 채팅 탭
describe('chatStore 탭 상태', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sideChatApi.fetchSideChatTree.mockResolvedValue({ rootChatId: null, chats: [] })
    useChatStore.setState({
      chatId: 'chat-1', branchId: 'branch-1', blocks: [], branches: [],
      chats: [], draftText: '', draftAttachments: [],
      editingBlockId: null, editingDraft: '', editingOriginal: '',
      tabs: [{ id: 'chat-1', chatId: 'chat-1', branchId: 'branch-1', title: '대화', kind: 'MAIN', parentChatId: null }],
      activeTabId: 'chat-1',
      sideChatsByBlockId: {}, sideChatTree: [], sideChatTreeRootId: null,
    })
  })

  it('새 채팅을 열어도 기존 탭은 그대로 남고 새 임시 탭이 활성화된다', async () => {
    await useChatStore.getState().newChat()

    const state = useChatStore.getState()
    expect(state.tabs).toHaveLength(2)
    expect(state.tabs[0]).toMatchObject({ id: 'chat-1', chatId: 'chat-1' })
    expect(state.chatId).toBeNull()
    expect(state.activeTabId).toBe(state.tabs[1].id)
    expect(state.tabs[1].chatId).toBeNull()
  })

  it('채팅을 열면 탭 목록에 추가되고 활성 탭이 된다', async () => {
    chatApi.fetchChat.mockResolvedValue({
      chatMeta: mainMeta(), branchMeta: { branchId: 'branch-2' }, messageBlocks: [], branchList: [],
    })
    convApi.fetchFeedback.mockResolvedValue({ aiMessageBlockId: 'x', rating: null })

    await useChatStore.getState().openChat('chat-2', 'branch-2')

    const state = useChatStore.getState()
    expect(state.tabs.map((t) => t.id)).toEqual(['chat-1', 'chat-2'])
    expect(state.activeTabId).toBe('chat-2')
    expect(state.chatId).toBe('chat-2')
  })

  it('이미 열린 탭을 다시 열어도 탭 개수는 늘지 않는다', async () => {
    chatApi.fetchChat.mockResolvedValue({
      chatMeta: mainMeta({ chatId: 'chat-1', title: '대화' }),
      branchMeta: { branchId: 'branch-1' }, messageBlocks: [], branchList: [],
    })
    convApi.fetchFeedback.mockResolvedValue({ aiMessageBlockId: 'x', rating: null })

    await useChatStore.getState().openChat('chat-1', 'branch-1')

    expect(useChatStore.getState().tabs).toHaveLength(1)
  })

  it('활성 탭을 닫으면 옆 탭으로 전환한다', async () => {
    useChatStore.setState({
      tabs: [
        { id: 'chat-1', chatId: 'chat-1', branchId: 'branch-1', title: '첫째', kind: 'MAIN', parentChatId: null },
        { id: 'chat-2', chatId: 'chat-2', branchId: 'branch-2', title: '둘째', kind: 'MAIN', parentChatId: null },
      ],
    })
    chatApi.fetchChat.mockResolvedValue({
      chatMeta: mainMeta({ title: '둘째' }), branchMeta: { branchId: 'branch-2' }, messageBlocks: [], branchList: [],
    })
    convApi.fetchFeedback.mockResolvedValue({ aiMessageBlockId: 'x', rating: null })

    await useChatStore.getState().closeTab('chat-1')

    const state = useChatStore.getState()
    expect(state.tabs.map((t) => t.id)).toEqual(['chat-2'])
    expect(state.activeTabId).toBe('chat-2')
    expect(state.chatId).toBe('chat-2')
  })

  it('배경 탭을 닫으면 화면은 그대로 두고 탭만 없앤다', async () => {
    useChatStore.setState({
      tabs: [
        { id: 'chat-1', chatId: 'chat-1', branchId: 'branch-1', title: '첫째', kind: 'MAIN', parentChatId: null },
        { id: 'chat-2', chatId: 'chat-2', branchId: 'branch-2', title: '둘째', kind: 'MAIN', parentChatId: null },
      ],
    })

    await useChatStore.getState().closeTab('chat-2')

    const state = useChatStore.getState()
    expect(state.tabs.map((t) => t.id)).toEqual(['chat-1'])
    expect(state.activeTabId).toBe('chat-1')
    expect(chatApi.fetchChat).not.toHaveBeenCalled()
  })

  it('사이드 채팅을 만들면 새 탭으로 즉시 전환된다 (0820_08 B2)', async () => {
    sideChatApi.createSideChat.mockResolvedValue({
      chatMeta: {
        chatId: 'side-1', title: '새 사이드 채팅', kind: 'SIDE', parentChatId: 'chat-1',
        parentBranchId: 'branch-1', parentMessageBlockId: 'block-1', rootChatId: 'chat-1', rootBranchId: 'branch-1',
      },
      branchMeta: { branchId: 'side-branch-1' },
      messageBlocks: [],
      branchList: [],
    })

    await useChatStore.getState().createSideChatTab('block-1')

    expect(sideChatApi.createSideChat).toHaveBeenCalledWith(
      'chat-1', 'branch-1', { anchorMessageBlockId: 'block-1', title: undefined },
    )
    const state = useChatStore.getState()
    expect(state.tabs.map((t) => t.id)).toEqual(['chat-1', 'side-1'])
    expect(state.activeTabId).toBe('side-1')
    expect(state.chatId).toBe('side-1')
    expect(state.branchId).toBe('side-branch-1')
  })

  it('대화를 삭제하면 그 탭도 함께 닫히고 남은 탭으로 전환한다', async () => {
    const request = vi.fn().mockResolvedValue(true)
    useConfirmStore.setState({ request })
    useChatStore.setState({
      tabs: [
        { id: 'chat-1', chatId: 'chat-1', branchId: 'branch-1', title: '첫째', kind: 'MAIN', parentChatId: null },
        { id: 'chat-2', chatId: 'chat-2', branchId: 'branch-2', title: '둘째', kind: 'MAIN', parentChatId: null },
      ],
      chats: [{ chatId: 'chat-1', title: '첫째' }, { chatId: 'chat-2', title: '둘째' }],
    })
    chatApi.deleteChat.mockResolvedValue({
      deleteSuccess: true,
      actionMeta: { actionType: 'chat_delete', successCode: 'CHAT_DELETED', message: '대화를 삭제했습니다.', affectedResourceId: 'chat-1' },
    })
    chatApi.fetchChat.mockResolvedValue({
      chatMeta: mainMeta({ title: '둘째' }), branchMeta: { branchId: 'branch-2' }, messageBlocks: [], branchList: [],
    })
    convApi.fetchFeedback.mockResolvedValue({ aiMessageBlockId: 'x', rating: null })

    await useChatStore.getState().deleteChat('chat-1')

    const state = useChatStore.getState()
    expect(state.tabs.map((t) => t.id)).toEqual(['chat-2'])
    expect(state.chatId).toBe('chat-2')
  })

  it('사이드 채팅 목록을 불러와 만들어진 지점(블록)별로 묶는다', async () => {
    sideChatApi.fetchSideChatTree.mockResolvedValue({
      rootChatId: 'chat-1',
      chats: [
        { chatId: 'chat-1', title: '메인', kind: 'MAIN', parentChatId: null, parentBranchId: null, parentMessageBlockId: null, rootChatId: null },
        { chatId: 'side-1', title: '사이드1', kind: 'SIDE', parentChatId: 'chat-1', parentBranchId: 'branch-1', parentMessageBlockId: 'block-1', rootChatId: 'chat-1' },
        { chatId: 'side-2', title: '사이드2', kind: 'SIDE', parentChatId: 'chat-1', parentBranchId: 'branch-other', parentMessageBlockId: 'block-2', rootChatId: 'chat-1' },
      ],
    })

    await useChatStore.getState().loadSideChatContext()

    const state = useChatStore.getState()
    expect(Object.keys(state.sideChatsByBlockId)).toEqual(['block-1'])
    expect(state.sideChatsByBlockId['block-1'].map((c) => c.chatId)).toEqual(['side-1'])
    expect(state.sideChatTreeRootId).toBe('chat-1')
  })
})

// 0820_08 마일스톤 C: 사이드 채팅 결과의 선택적 메인 반영
describe('chatStore 부모 반영', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sideChatApi.fetchSideChatTree.mockResolvedValue({ rootChatId: null, chats: [] })
    useChatStore.setState({
      chatId: 'side-1', branchId: 'side-branch-1',
      blocks: [
        { blockId: 'b1', branchId: 'side-branch-1', role: 'user', content: '질문', currentVersionId: 'v1', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' },
        { blockId: 'b2', branchId: 'side-branch-1', role: 'assistant', content: '답변', currentVersionId: 'v2', orderIndex: 1, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' },
      ],
      selectedBlockIds: ['b2'],
      chatKind: 'SIDE', parentChatId: 'chat-1', parentBranchId: 'branch-1', parentMessageBlockId: 'anchor-1',
      tabs: [
        { id: 'chat-1', chatId: 'chat-1', branchId: 'branch-1', title: '메인', kind: 'MAIN', parentChatId: null },
        { id: 'side-1', chatId: 'side-1', branchId: 'side-branch-1', title: '사이드', kind: 'SIDE', parentChatId: 'chat-1' },
      ],
      activeTabId: 'side-1',
      branchError: null, isCreatingBranch: false,
    })
  })

  it('선택한 블록을 부모 채팅으로 전환하며 Context로 적용한다 (C1)', async () => {
    chatApi.fetchChat.mockResolvedValue({
      chatMeta: mainMeta({ chatId: 'chat-1', title: '메인' }),
      branchMeta: { branchId: 'branch-1' }, messageBlocks: [], branchList: [],
    })
    convApi.fetchFeedback.mockResolvedValue({ aiMessageBlockId: 'x', rating: null })

    const ok = await useChatStore.getState().sendSelectedToParentAsContext()

    expect(ok).toBe(true)
    const state = useChatStore.getState()
    expect(state.chatId).toBe('chat-1')
    expect(state.appliedBlockIds).toEqual(['b2'])
  })

  it('선택한 블록을 부모 채팅 메시지로 가져온 뒤 부모 탭으로 전환한다 (C2)', async () => {
    sideChatApi.importBlocksAsMessages.mockResolvedValue({
      importedBlocks: [],
      actionMeta: { actionType: 'side_chat_import_blocks', successCode: 'SIDE_CHAT_BLOCKS_IMPORTED', message: '가져왔습니다.', affectedResourceId: 'chat-1' },
    })
    chatApi.fetchChat.mockResolvedValue({
      chatMeta: mainMeta({ chatId: 'chat-1', title: '메인' }),
      branchMeta: { branchId: 'branch-1' }, messageBlocks: [], branchList: [],
    })
    convApi.fetchFeedback.mockResolvedValue({ aiMessageBlockId: 'x', rating: null })

    const ok = await useChatStore.getState().importSelectedToParentAsMessages()

    expect(ok).toBe(true)
    expect(sideChatApi.importBlocksAsMessages).toHaveBeenCalledWith('chat-1', 'branch-1', ['b2'])
    expect(useChatStore.getState().chatId).toBe('chat-1')
  })

  it('사이드 채팅과 같은 지점에서 부모 아래 형제 브랜치를 만든다 (C3)', async () => {
    chatApi.createBranch.mockResolvedValue({
      branchId: 'sibling-branch', branchName: '형제', branchType: 'CHILD',
      parentBranchId: 'branch-1', sourceContextRefId: 'ctx-1',
    })
    chatApi.fetchChat.mockResolvedValue({
      chatMeta: mainMeta({ chatId: 'chat-1', title: '메인' }),
      branchMeta: { branchId: 'sibling-branch' }, messageBlocks: [], branchList: [],
    })
    convApi.fetchFeedback.mockResolvedValue({ aiMessageBlockId: 'x', rating: null })

    const ok = await useChatStore.getState().createSiblingBranchFromSideChat('형제', '답변')

    expect(ok).toBe(true)
    expect(chatApi.createBranch).toHaveBeenCalledWith('chat-1', {
      branchName: '형제', baseBranchId: 'branch-1', baseMessageBlockId: 'anchor-1',
      contextBlockIds: [], editedBaseContent: '답변',
    })
    expect(useChatStore.getState().branchId).toBe('sibling-branch')
  })

  it('부모가 없으면(메인 채팅) 반영 액션은 아무 일도 하지 않는다 (C4)', async () => {
    useChatStore.setState({ parentChatId: null, parentBranchId: null, parentMessageBlockId: null })

    expect(await useChatStore.getState().sendSelectedToParentAsContext()).toBe(false)
    expect(await useChatStore.getState().importSelectedToParentAsMessages()).toBe(false)
    expect(await useChatStore.getState().createSiblingBranchFromSideChat('형제', '내용')).toBe(false)
    expect(chatApi.fetchChat).not.toHaveBeenCalled()
    expect(sideChatApi.importBlocksAsMessages).not.toHaveBeenCalled()
    expect(chatApi.createBranch).not.toHaveBeenCalled()
  })
})
