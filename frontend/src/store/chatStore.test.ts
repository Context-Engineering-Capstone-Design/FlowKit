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
  fetchRefineJob: vi.fn(),
  approveResult: vi.fn(),
  rejectResult: vi.fn(),
}))

vi.mock('@/api/chat', () => chatApi)
vi.mock('@/api/conversation', () => convApi)
vi.mock('@/api/inputAssist', () => ({}))

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

  it('지금 열린 대화를 삭제하면 새 빈 대화를 연다', async () => {
    const request = vi.fn().mockResolvedValue(true)
    useConfirmStore.setState({ request })
    chatApi.deleteChat.mockResolvedValue({
      deleteSuccess: true,
      actionMeta: { actionType: 'chat_delete', successCode: 'CHAT_DELETED', message: '대화를 삭제했습니다.', affectedResourceId: 'chat-1' },
    })
    chatApi.createChat.mockResolvedValue({
      chatMeta: { chatId: 'chat-new', title: '새 대화' },
      branchMeta: { branchId: 'branch-new' },
      messageBlocks: [],
      branchList: [],
    })
    chatApi.fetchChats.mockResolvedValue({ chats: [{ chatId: 'chat-new', title: '새 대화' }], nextCursor: null })
    useChatStore.setState({
      chatId: 'chat-1',
      chats: [{ chatId: 'chat-1', title: '새 대화' }],
    })

    await useChatStore.getState().deleteChat('chat-1')

    expect(chatApi.deleteChat).toHaveBeenCalledWith('chat-1')
    expect(chatApi.createChat).toHaveBeenCalledOnce()
    expect(useChatStore.getState().chatId).toBe('chat-new')
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
})
