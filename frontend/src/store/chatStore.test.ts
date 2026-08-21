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
  editBlock: vi.fn(),
  fetchVersions: vi.fn(),
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

import { createChatStore, setSidePanelOpener, useChatStore } from '@/store/chatStore'
import { useConfirmStore } from '@/store/confirmStore'
import type { SideChatTreeResponse } from '@/types/api'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

describe('chatStore 화면 상태', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useChatStore.setState({
      chats: [], nextCursor: null, chatListKeyword: '', chatListError: null,
      chatId: 'chat-1', branchId: 'branch-1', chatTitle: '대화', branches: [], blocks: [],
      selectedBlockIds: [], appliedBlockIds: [], appliedContextLabel: null,
      contextInstruction: '', draftText: '', draftAttachments: [],
      isSending: false, error: null, pendingByBlockId: {}, failedJobsByBlockId: {},
      editingBlockId: null, editingDraft: '', editingOriginal: '',
      deletingChatId: null,
      tabs: [{ id: 'chat-1', chatId: 'chat-1', branchId: 'branch-1', title: '대화', kind: 'MAIN', parentChatId: null }],
      activeTabId: 'chat-1',
      sideChatsByBlockId: {}, sideChatTree: [], sideChatTreeRootId: null, isCreatingSideChat: false,
    })
  })

  it('패널 store 인스턴스끼리 입력 상태가 섞이지 않는다', () => {
    const main = createChatStore()
    const side = createChatStore()
    main.getState().setDraftText('메인 입력')
    side.getState().setDraftText('사이드 입력')

    expect(main.getState().draftText).toBe('메인 입력')
    expect(side.getState().draftText).toBe('사이드 입력')
  })

  it('검색 cursor 다음 페이지를 중복 없이 이어 붙인다', async () => {
    chatApi.fetchChats
      .mockResolvedValueOnce({ chats: [{ chatId: '1', title: '첫째' }], nextCursor: 'cursor-1' })
      .mockResolvedValueOnce({ chats: [{ chatId: '1', title: '첫째' }, { chatId: '2', title: '둘째' }], nextCursor: null })

    await useChatStore.getState().loadChats('검색어')
    await useChatStore.getState().loadMoreChats()

    expect(chatApi.fetchChats).toHaveBeenLastCalledWith(
      { cursor: 'cursor-1', keyword: '검색어', limit: 10 },
      expect.any(AbortSignal),
    )
    expect(useChatStore.getState().chats.map((item) => item.chatId)).toEqual(['1', '2'])
  })

  it('첫 목록 응답의 중복 채팅은 한 번만 표시한다', async () => {
    chatApi.fetchChats.mockResolvedValue({
      chats: [
        { chatId: '1', title: '첫째' },
        { chatId: '1', title: '첫째 (중복)' },
        { chatId: '2', title: '둘째' },
      ],
      nextCursor: null,
    })

    await useChatStore.getState().loadChats()

    expect(useChatStore.getState().chats.map((item) => item.chatId)).toEqual(['1', '2'])
  })

  it('검색어 앞뒤 공백을 제거하고 공백만 입력하면 전체 목록을 요청한다', async () => {
    chatApi.fetchChats.mockResolvedValue({ chats: [], nextCursor: null })

    await useChatStore.getState().loadChats('  검색어  ')
    expect(chatApi.fetchChats).toHaveBeenLastCalledWith(
      { keyword: '검색어', limit: 10 },
      expect.any(AbortSignal),
    )

    await useChatStore.getState().loadChats('   ')
    expect(chatApi.fetchChats).toHaveBeenLastCalledWith(
      { keyword: undefined, limit: 10 },
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

  it('늦게 끝난 이전 브랜치 전환이 마지막 선택을 덮지 않는다', async () => {
    const first = deferred<unknown>()
    const second = deferred<unknown>()
    chatApi.fetchBranch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    useChatStore.setState({
      branches: [
        { branchId: 'branch-1', branchName: 'Main', branchType: 'MAIN', parentBranchId: null, isActive: true },
        { branchId: 'branch-2', branchName: '첫 분기', branchType: 'CHILD', parentBranchId: 'branch-1', isActive: false },
        { branchId: 'branch-3', branchName: '둘째 분기', branchType: 'CHILD', parentBranchId: 'branch-1', isActive: false },
      ],
    })

    const firstSwitch = useChatStore.getState().switchBranch('branch-2')
    await vi.waitFor(() => expect(chatApi.fetchBranch).toHaveBeenCalledTimes(1))
    const secondSwitch = useChatStore.getState().switchBranch('branch-3')
    await vi.waitFor(() => expect(chatApi.fetchBranch).toHaveBeenCalledTimes(2))

    second.resolve({
      branchMeta: { branchId: 'branch-3' },
      messageBlocks: [{ blockId: 'block-3', branchId: 'branch-3', role: 'user', content: 'C', currentVersionId: 'v-3', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' }],
      sourceContextInfo: [],
    })
    await secondSwitch
    first.resolve({
      branchMeta: { branchId: 'branch-2' },
      messageBlocks: [{ blockId: 'block-2', branchId: 'branch-2', role: 'user', content: 'B', currentVersionId: 'v-2', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' }],
      sourceContextInfo: [],
    })
    await firstSwitch

    const state = useChatStore.getState()
    expect(state.branchId).toBe('branch-3')
    expect(state.blocks.map((block) => block.blockId)).toEqual(['block-3'])
    expect(state.tabs[0].branchId).toBe('branch-3')
    expect(state.branches.find((branch) => branch.isActive)?.branchId).toBe('branch-3')
  })

  it('이전 브랜치의 늦은 평가 조회가 현재 브랜치 평가를 덮지 않는다', async () => {
    const firstFeedback = deferred<unknown>()
    const secondFeedback = deferred<unknown>()
    chatApi.fetchBranch
      .mockResolvedValueOnce({
        branchMeta: { branchId: 'branch-2' },
        messageBlocks: [{ blockId: 'assistant-2', branchId: 'branch-2', role: 'assistant', content: 'B', currentVersionId: 'v-2', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' }],
        sourceContextInfo: [],
      })
      .mockResolvedValueOnce({
        branchMeta: { branchId: 'branch-3' },
        messageBlocks: [{ blockId: 'assistant-3', branchId: 'branch-3', role: 'assistant', content: 'C', currentVersionId: 'v-3', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' }],
        sourceContextInfo: [],
      })
    convApi.fetchFeedback.mockReturnValueOnce(firstFeedback.promise).mockReturnValueOnce(secondFeedback.promise)

    const firstSwitch = useChatStore.getState().switchBranch('branch-2')
    await vi.waitFor(() => expect(convApi.fetchFeedback).toHaveBeenCalledTimes(1))
    const secondSwitch = useChatStore.getState().switchBranch('branch-3')
    await vi.waitFor(() => expect(convApi.fetchFeedback).toHaveBeenCalledTimes(2))

    secondFeedback.resolve({ aiMessageBlockId: 'assistant-3', rating: 'like' })
    await secondSwitch
    firstFeedback.resolve({ aiMessageBlockId: 'assistant-2', rating: 'dislike' })
    await firstSwitch

    expect(useChatStore.getState().ratings).toEqual({ 'assistant-3': 'like' })
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

  it('전송에 성공하면 임시 질문 블록을 실제 블록으로 바꾼다 ', async () => {
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

  it('전송 중 다른 학습 대화로 이동하면 늦은 성공을 현재 화면에 적용하지 않는다', async () => {
    const pending = deferred<unknown>()
    const pendingB = deferred<unknown>()
    convApi.sendMessage.mockReturnValueOnce(pending.promise).mockReturnValueOnce(pendingB.promise)

    const sending = useChatStore.getState().sendMessage('Self-Attention의 Q, K, V 역할을 설명해줘.')
    await vi.waitFor(() => expect(convApi.sendMessage).toHaveBeenCalledTimes(1))
    chatApi.fetchChat.mockResolvedValueOnce({
      chatMeta: mainMeta({ chatId: 'chat-b', title: 'Transformer Encoder 학습' }),
      branchMeta: { branchId: 'branch-b' },
      messageBlocks: [{ blockId: 'block-b', branchId: 'branch-b', role: 'user', content: 'B의 기존 질문', currentVersionId: 'v-b', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' }],
      branchList: [],
    })
    await useChatStore.getState().openChat('chat-b', 'branch-b')
    expect(useChatStore.getState().isSending).toBe(false)
    useChatStore.setState({
      draftText: 'B의 입력 초안',
      selectedBlockIds: ['block-b'],
      appliedBlockIds: ['block-b'],
      selectedLibraryResourceIds: ['library-b'],
      error: 'B의 기존 오류',
    })
    const sendingB = useChatStore.getState().sendMessage('B 화면의 LayerNorm 질문')
    await vi.waitFor(() => expect(convApi.sendMessage).toHaveBeenCalledTimes(2))

    pending.resolve({
      userBlock: { blockId: 'user-a', branchId: 'branch-1', role: 'user', content: 'Self-Attention의 Q, K, V 역할을 설명해줘.', currentVersionId: 'v-a', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [] },
      assistantBlock: { blockId: 'assistant-a', branchId: 'branch-1', role: 'assistant', content: 'A의 답변', currentVersionId: 'v-a', orderIndex: 1, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'generating' },
      appliedContext: [], chatTitle: 'A의 새 제목', titleGenerated: false, aiResponseJobId: 'job-a', jobStatus: 'generating',
    })
    await sending

    const state = useChatStore.getState()
    expect(state).toMatchObject({ chatId: 'chat-b', branchId: 'branch-b', activeTabId: 'chat-b', chatTitle: 'Transformer Encoder 학습', draftText: 'B의 입력 초안', error: null })
    expect(state.blocks[0]?.blockId).toBe('block-b')
    expect(state.appliedBlockIds).toEqual(['block-b'])
    expect(state.selectedLibraryResourceIds).toEqual(['library-b'])
    expect(state.isSending).toBe(true)
    expect(state.blocks).toHaveLength(2)
    expect(state.blocks[1]).toMatchObject({ branchId: 'branch-b', content: 'B 화면의 LayerNorm 질문' })
    expect(convApi.openAiResponseStream).not.toHaveBeenCalled()

    pendingB.resolve({
      userBlock: { blockId: 'user-b', branchId: 'branch-b', role: 'user', content: 'B 화면의 LayerNorm 질문', currentVersionId: 'v-b', orderIndex: 1, createdAt: 't', attachments: [], searchSources: [] },
      assistantBlock: { blockId: 'assistant-b', branchId: 'branch-b', role: 'assistant', content: 'B의 답변', currentVersionId: 'v-b', orderIndex: 2, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' },
      appliedContext: [], chatTitle: 'LayerNorm 학습', titleGenerated: false, aiResponseJobId: 'job-b-send', jobStatus: 'completed',
    })
    await sendingB
  })

  it('다른 학습 대화 열기가 실패해도 현재 전송 결과를 유지한다', async () => {
    const pending = deferred<unknown>()
    convApi.sendMessage.mockReturnValueOnce(pending.promise)

    const sending = useChatStore.getState().sendMessage('Residual Connection이 학습 안정성에 주는 효과는?')
    await vi.waitFor(() => expect(convApi.sendMessage).toHaveBeenCalledTimes(1))
    chatApi.fetchChat.mockRejectedValueOnce(new Error('학습 대화를 불러오지 못했습니다.'))

    await useChatStore.getState().openChat('chat-b', 'branch-b')
    expect(useChatStore.getState()).toMatchObject({ chatId: 'chat-1', branchId: 'branch-1', isSending: true })

    pending.resolve({
      userBlock: { blockId: 'user-a', branchId: 'branch-1', role: 'user', content: 'Residual Connection이 학습 안정성에 주는 효과는?', currentVersionId: 'v-a', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [] },
      assistantBlock: { blockId: 'assistant-a', branchId: 'branch-1', role: 'assistant', content: '그래디언트 흐름을 돕습니다.', currentVersionId: 'v-a', orderIndex: 1, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' },
      appliedContext: [], chatTitle: 'Residual Connection 학습', titleGenerated: false, aiResponseJobId: 'job-a', jobStatus: 'completed',
    })
    await sending

    const state = useChatStore.getState()
    expect(state).toMatchObject({ chatId: 'chat-1', branchId: 'branch-1', chatTitle: 'Residual Connection 학습', isSending: false })
    expect(state.blocks.map((block) => block.blockId)).toEqual(['user-a', 'assistant-a'])
  })

  it('다른 학습 대화 노드 열기가 실패해도 현재 전송 결과를 유지한다', async () => {
    const pending = deferred<unknown>()
    convApi.sendMessage.mockReturnValueOnce(pending.promise)

    const sending = useChatStore.getState().sendMessage('LayerNorm이 배치 크기에 덜 의존하는 이유는?')
    await vi.waitFor(() => expect(convApi.sendMessage).toHaveBeenCalledTimes(1))
    chatApi.fetchBranch.mockRejectedValueOnce(new Error('학습 노드를 불러오지 못했습니다.'))

    await useChatStore.getState().switchBranch('branch-b')
    expect(useChatStore.getState()).toMatchObject({ chatId: 'chat-1', branchId: 'branch-1', isSending: true })

    pending.resolve({
      userBlock: { blockId: 'user-a', branchId: 'branch-1', role: 'user', content: 'LayerNorm이 배치 크기에 덜 의존하는 이유는?', currentVersionId: 'v-a', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [] },
      assistantBlock: { blockId: 'assistant-a', branchId: 'branch-1', role: 'assistant', content: '토큰 내부 특성을 정규화합니다.', currentVersionId: 'v-a', orderIndex: 1, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' },
      appliedContext: [], chatTitle: 'LayerNorm 학습', titleGenerated: false, aiResponseJobId: 'job-a', jobStatus: 'completed',
    })
    await sending

    const state = useChatStore.getState()
    expect(state).toMatchObject({ chatId: 'chat-1', branchId: 'branch-1', chatTitle: 'LayerNorm 학습', isSending: false })
    expect(state.blocks.map((block) => block.blockId)).toEqual(['user-a', 'assistant-a'])
  })

  it('같은 학습 대화 노드로 돌아오면 늦은 결과만 합치고 새 입력은 남긴다', async () => {
    const pending = deferred<unknown>()
    convApi.sendMessage.mockReturnValueOnce(pending.promise)

    const sending = useChatStore.getState().sendMessage('Feed-Forward Network가 토큰별로 하는 일은?')
    await vi.waitFor(() => expect(convApi.sendMessage).toHaveBeenCalledTimes(1))
    chatApi.fetchChat
      .mockResolvedValueOnce({
        chatMeta: mainMeta({ chatId: 'chat-b', title: '다른 Transformer 학습' }),
        branchMeta: { branchId: 'branch-b' }, messageBlocks: [], branchList: [],
      })
      .mockResolvedValueOnce({
        chatMeta: mainMeta({ chatId: 'chat-1', title: '원래 학습 대화' }),
        branchMeta: { branchId: 'branch-1' },
        messageBlocks: [
          { blockId: 'before-a', branchId: 'branch-1', role: 'user', content: '기존 질문', currentVersionId: 'v-before', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' },
          { blockId: 'user-a', branchId: 'branch-1', role: 'user', content: 'Feed-Forward Network가 토큰별로 하는 일은?', currentVersionId: 'v-a', orderIndex: 1, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' },
          { blockId: 'assistant-a', branchId: 'branch-1', role: 'assistant', content: '스트리밍 중 본문', currentVersionId: 'v-a', orderIndex: 2, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'generating', generationJobId: 'job-a' },
        ],
        branchList: [],
      })
    await useChatStore.getState().openChat('chat-b', 'branch-b')
    await useChatStore.getState().openChat('chat-1', 'branch-1')
    expect(useChatStore.getState().isSending).toBe(true)
    useChatStore.setState({ draftText: '복귀 뒤 새 입력은 보존한다' })

    pending.resolve({
      userBlock: { blockId: 'user-a', branchId: 'branch-1', role: 'user', content: 'Feed-Forward Network가 토큰별로 하는 일은?', currentVersionId: 'v-a', orderIndex: 1, createdAt: 't', attachments: [], searchSources: [] },
      assistantBlock: { blockId: 'assistant-a', branchId: 'branch-1', role: 'assistant', content: '각 토큰의 표현을 비선형 변환합니다.', currentVersionId: 'v-a', orderIndex: 2, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' },
      appliedContext: [], chatTitle: 'Feed-Forward 학습', titleGenerated: false, aiResponseJobId: 'job-a', jobStatus: 'completed',
    })
    await sending

    const state = useChatStore.getState()
    expect(state).toMatchObject({ chatId: 'chat-1', branchId: 'branch-1', chatTitle: 'Feed-Forward 학습', draftText: '복귀 뒤 새 입력은 보존한다', isSending: false })
    expect(state.blocks.map((block) => block.blockId)).toEqual(['before-a', 'user-a', 'assistant-a'])
    expect(state.blocks.find((block) => block.blockId === 'assistant-a')).toMatchObject({ content: '스트리밍 중 본문', generationStatus: 'generating' })
    expect(convApi.openAiResponseStream).toHaveBeenCalledWith('chat-1', 'branch-1', 'job-a', expect.anything(), expect.any(AbortSignal))
  })

  it('같은 학습 대화 노드로 돌아온 뒤의 전송 실패는 재시도 정보를 남긴다', async () => {
    const pending = deferred<unknown>()
    convApi.sendMessage.mockReturnValueOnce(pending.promise)

    const sending = useChatStore.getState().sendMessage('Causal Mask가 디코더에서 필요한 이유는?')
    await vi.waitFor(() => expect(convApi.sendMessage).toHaveBeenCalledTimes(1))
    chatApi.fetchChat
      .mockResolvedValueOnce({
        chatMeta: mainMeta({ chatId: 'chat-b', title: '다른 Transformer 학습' }),
        branchMeta: { branchId: 'branch-b' }, messageBlocks: [], branchList: [],
      })
      .mockResolvedValueOnce({
        chatMeta: mainMeta({ chatId: 'chat-1', title: '원래 학습 대화' }),
        branchMeta: { branchId: 'branch-1' }, messageBlocks: [], branchList: [],
      })
      .mockResolvedValueOnce({
        chatMeta: mainMeta({ chatId: 'chat-1', title: 'Causal Mask 학습' }),
        branchMeta: { branchId: 'branch-1' },
        messageBlocks: [{ blockId: 'user-a', branchId: 'branch-1', role: 'user', content: 'Causal Mask가 디코더에서 필요한 이유는?', currentVersionId: 'v-a', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' }],
        branchList: [],
      })
    await useChatStore.getState().openChat('chat-b', 'branch-b')
    await useChatStore.getState().openChat('chat-1', 'branch-1')
    useChatStore.setState({ draftText: '복귀 뒤 새 초안' })

    pending.reject({
      isAxiosError: true,
      response: { data: { errorCode: 'AI_RESPONSE_FAILED', message: 'A 답변 생성 실패', detail: { aiResponseJobId: 'job-a', userMessageBlockId: 'user-a', retryable: true } } },
    })
    await sending

    const state = useChatStore.getState()
    expect(chatApi.fetchChat).toHaveBeenCalledTimes(3)
    expect(state).toMatchObject({ chatId: 'chat-1', branchId: 'branch-1', chatTitle: 'Causal Mask 학습', draftText: '복귀 뒤 새 초안', isSending: false })
    expect(state.blocks.map((block) => block.blockId)).toEqual(['user-a'])
    expect(state.failedJobsByBlockId).toEqual({ 'user-a': 'job-a' })
  })

  it('첫 학습 질문을 보낸 초안으로 다시 들어오면 늦은 결과를 이어서 표시한다', async () => {
    const creating = deferred<unknown>()
    const pending = deferred<unknown>()
    chatApi.createChat.mockReturnValueOnce(creating.promise)
    chatApi.fetchChats.mockResolvedValue({ chats: [], nextCursor: null })
    convApi.sendMessage.mockReturnValueOnce(pending.promise)
    useChatStore.setState({
      chatId: null, branchId: null, chatTitle: '', blocks: [],
      tabs: [
        { id: 'chat-b', chatId: 'chat-b', branchId: 'branch-b', title: '기존 Transformer 대화', kind: 'MAIN', parentChatId: null },
        { id: 'draft-a', chatId: null, branchId: null, title: '새 대화', kind: 'MAIN', parentChatId: null },
      ],
      activeTabId: 'draft-a',
    })

    const sending = useChatStore.getState().sendMessage('Cross-Attention이 Encoder-Decoder를 잇는 방식은?')
    await vi.waitFor(() => expect(chatApi.createChat).toHaveBeenCalledTimes(1))
    chatApi.fetchChat.mockResolvedValueOnce({
      chatMeta: mainMeta({ chatId: 'chat-b', title: '기존 Transformer 대화' }),
      branchMeta: { branchId: 'branch-b' }, messageBlocks: [], branchList: [],
    })
    await useChatStore.getState().switchTab('chat-b')
    creating.resolve({
      chatMeta: mainMeta({ chatId: 'chat-new', title: '새 대화' }),
      branchMeta: { branchId: 'branch-new' }, messageBlocks: [], branchList: [],
    })
    await vi.waitFor(() => expect(convApi.sendMessage).toHaveBeenCalledTimes(1))
    chatApi.fetchChat.mockResolvedValueOnce({
      chatMeta: mainMeta({ chatId: 'chat-new', title: '새 대화' }),
      branchMeta: { branchId: 'branch-new' }, messageBlocks: [], branchList: [],
    })
    await useChatStore.getState().openChat('chat-new', 'branch-new')
    expect(useChatStore.getState().isSending).toBe(true)

    pending.resolve({
      userBlock: { blockId: 'user-new', branchId: 'branch-new', role: 'user', content: 'Cross-Attention이 Encoder-Decoder를 잇는 방식은?', currentVersionId: 'v-new', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [] },
      assistantBlock: { blockId: 'assistant-new', branchId: 'branch-new', role: 'assistant', content: 'Decoder query가 Encoder 표현을 참조합니다.', currentVersionId: 'v-new', orderIndex: 1, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' },
      appliedContext: [], chatTitle: 'Cross-Attention 학습', titleGenerated: false, aiResponseJobId: 'job-new', jobStatus: 'completed',
    })
    await sending

    const state = useChatStore.getState()
    expect(state).toMatchObject({ chatId: 'chat-new', branchId: 'branch-new', chatTitle: 'Cross-Attention 학습', isSending: false })
    expect(state.blocks.map((block) => block.blockId)).toEqual(['user-new', 'assistant-new'])
  })

  it('같은 학습 대화의 늦은 조회가 전송 완료 상태를 덮지 않는다', async () => {
    const staleDetail = deferred<unknown>()
    const pending = deferred<unknown>()
    chatApi.fetchChat.mockReturnValueOnce(staleDetail.promise)
    convApi.sendMessage.mockReturnValueOnce(pending.promise)

    const reloading = useChatStore.getState().openChat('chat-1', 'branch-1')
    await vi.waitFor(() => expect(chatApi.fetchChat).toHaveBeenCalledTimes(1))
    const sending = useChatStore.getState().sendMessage('Scaled Dot-Product Attention에서 나누기 sqrt(dk)의 이유는?')
    await vi.waitFor(() => expect(convApi.sendMessage).toHaveBeenCalledTimes(1))
    pending.resolve({
      userBlock: { blockId: 'user-a', branchId: 'branch-1', role: 'user', content: 'Scaled Dot-Product Attention에서 나누기 sqrt(dk)의 이유는?', currentVersionId: 'v-a', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [] },
      assistantBlock: { blockId: 'assistant-a', branchId: 'branch-1', role: 'assistant', content: '내적 크기를 안정화합니다.', currentVersionId: 'v-a', orderIndex: 1, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' },
      appliedContext: [], chatTitle: 'Scaled Dot-Product Attention 학습', titleGenerated: false, aiResponseJobId: 'job-a', jobStatus: 'completed',
    })
    await sending
    staleDetail.resolve({
      chatMeta: mainMeta({ chatId: 'chat-1', title: '오래된 제목' }),
      branchMeta: { branchId: 'branch-1' }, messageBlocks: [], branchList: [],
    })
    await reloading

    const state = useChatStore.getState()
    expect(state).toMatchObject({ chatId: 'chat-1', branchId: 'branch-1', chatTitle: 'Scaled Dot-Product Attention 학습' })
    expect(state.blocks.map((block) => block.blockId)).toEqual(['user-a', 'assistant-a'])
  })

  it('현재 학습 대화를 다시 고르면 대기 중인 다른 대화 열기를 취소한다', async () => {
    const pending = deferred<unknown>()
    const pendingB = deferred<unknown>()
    convApi.sendMessage.mockReturnValueOnce(pending.promise)
    chatApi.fetchChat.mockReturnValueOnce(pendingB.promise)

    const sending = useChatStore.getState().sendMessage('Transformer에서 잔차 연결이 중요한 이유는?')
    await vi.waitFor(() => expect(convApi.sendMessage).toHaveBeenCalledTimes(1))
    const openingB = useChatStore.getState().openChat('chat-b', 'branch-b')
    await vi.waitFor(() => expect(chatApi.fetchChat).toHaveBeenCalledTimes(1))

    await useChatStore.getState().openChat('chat-1', 'branch-1')
    pendingB.resolve({
      chatMeta: mainMeta({ chatId: 'chat-b', title: 'B 학습 대화' }),
      branchMeta: { branchId: 'branch-b' }, messageBlocks: [], branchList: [],
    })
    await openingB

    pending.resolve({
      userBlock: { blockId: 'user-a', branchId: 'branch-1', role: 'user', content: 'Transformer에서 잔차 연결이 중요한 이유는?', currentVersionId: 'v-a', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [] },
      assistantBlock: { blockId: 'assistant-a', branchId: 'branch-1', role: 'assistant', content: '그래디언트가 더 안정적으로 흐르게 합니다.', currentVersionId: 'v-a', orderIndex: 1, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' },
      appliedContext: [], chatTitle: '잔차 연결 학습', titleGenerated: false, aiResponseJobId: 'job-a', jobStatus: 'completed',
    })
    await sending

    const state = useChatStore.getState()
    expect(state).toMatchObject({ chatId: 'chat-1', branchId: 'branch-1', chatTitle: '잔차 연결 학습', isSending: false })
    expect(state.blocks.map((block) => block.blockId)).toEqual(['user-a', 'assistant-a'])
  })

  it('첫 채팅 생성 중 다른 탭으로 이동해도 생성된 학습 대화가 현재 화면을 바꾸지 않는다', async () => {
    const creating = deferred<unknown>()
    chatApi.createChat.mockReturnValueOnce(creating.promise)
    chatApi.fetchChats.mockResolvedValue({ chats: [], nextCursor: null })
    convApi.sendMessage.mockResolvedValue({
      userBlock: { blockId: 'user-new', branchId: 'branch-new', role: 'user', content: 'Softmax가 왜 필요한가?', currentVersionId: 'v-new', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [] },
      assistantBlock: { blockId: 'assistant-new', branchId: 'branch-new', role: 'assistant', content: '정규화 답변', currentVersionId: 'v-new', orderIndex: 1, createdAt: 't', attachments: [], searchSources: [] },
      appliedContext: [], chatTitle: 'Softmax 학습', titleGenerated: false, aiResponseJobId: 'job-new', jobStatus: 'completed',
    })
    useChatStore.setState({
      chatId: null, branchId: null, chatTitle: '', blocks: [],
      tabs: [
        { id: 'chat-b', chatId: 'chat-b', branchId: 'branch-b', title: '기존 Transformer 대화', kind: 'MAIN', parentChatId: null },
        { id: 'draft-a', chatId: null, branchId: null, title: '새 대화', kind: 'MAIN', parentChatId: null },
      ],
      activeTabId: 'draft-a',
    })

    const sending = useChatStore.getState().sendMessage('Softmax가 왜 필요한가?')
    await vi.waitFor(() => expect(chatApi.createChat).toHaveBeenCalledTimes(1))
    chatApi.fetchChat.mockResolvedValueOnce({
      chatMeta: mainMeta({ chatId: 'chat-b', title: '기존 Transformer 대화' }),
      branchMeta: { branchId: 'branch-b' },
      messageBlocks: [{ blockId: 'block-b', branchId: 'branch-b', role: 'user', content: 'B의 내용', currentVersionId: 'v-b', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' }],
      branchList: [],
    })
    await useChatStore.getState().switchTab('chat-b')
    creating.resolve({
      chatMeta: mainMeta({ chatId: 'chat-new', title: '새 대화' }),
      branchMeta: { branchId: 'branch-new' }, messageBlocks: [], branchList: [],
    })
    await sending

    const state = useChatStore.getState()
    expect(state).toMatchObject({ chatId: 'chat-b', branchId: 'branch-b', activeTabId: 'chat-b', chatTitle: '기존 Transformer 대화' })
    expect(state.blocks.map((block) => block.blockId)).toEqual(['block-b'])
    expect(state.tabs.find((tab) => tab.id === 'chat-new')).toMatchObject({ chatId: 'chat-new', branchId: 'branch-new' })
    expect(convApi.sendMessage).toHaveBeenCalledWith('chat-new', 'branch-new', 'Softmax가 왜 필요한가?', [], expect.anything(), [])
  })

  it('첫 채팅 생성 중 돌아온 같은 초안 탭의 식별자를 바꾸지 않는다', async () => {
    const creating = deferred<unknown>()
    chatApi.createChat.mockReturnValueOnce(creating.promise)
    chatApi.fetchChats.mockResolvedValue({ chats: [], nextCursor: null })
    convApi.sendMessage.mockResolvedValue({
      userBlock: { blockId: 'user-new', branchId: 'branch-new', role: 'user', content: 'Positional Encoding의 목적은?', currentVersionId: 'v-new', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [] },
      assistantBlock: { blockId: 'assistant-new', branchId: 'branch-new', role: 'assistant', content: '순서 정보 답변', currentVersionId: 'v-new', orderIndex: 1, createdAt: 't', attachments: [], searchSources: [] },
      appliedContext: [], chatTitle: 'Positional Encoding 학습', titleGenerated: false, aiResponseJobId: 'job-new', jobStatus: 'completed',
    })
    useChatStore.setState({
      chatId: null, branchId: null, chatTitle: '', blocks: [],
      tabs: [
        { id: 'chat-b', chatId: 'chat-b', branchId: 'branch-b', title: '기존 Transformer 대화', kind: 'MAIN', parentChatId: null },
        { id: 'draft-a', chatId: null, branchId: null, title: '새 대화', kind: 'MAIN', parentChatId: null },
      ],
      activeTabId: 'draft-a',
    })

    const sending = useChatStore.getState().sendMessage('Positional Encoding의 목적은?')
    await vi.waitFor(() => expect(chatApi.createChat).toHaveBeenCalledTimes(1))
    chatApi.fetchChat.mockResolvedValueOnce({
      chatMeta: mainMeta({ chatId: 'chat-b', title: '기존 Transformer 대화' }),
      branchMeta: { branchId: 'branch-b' }, messageBlocks: [], branchList: [],
    })
    await useChatStore.getState().switchTab('chat-b')
    await useChatStore.getState().switchTab('draft-a')
    creating.resolve({
      chatMeta: mainMeta({ chatId: 'chat-new', title: '새 대화' }),
      branchMeta: { branchId: 'branch-new' }, messageBlocks: [], branchList: [],
    })
    await sending

    const state = useChatStore.getState()
    expect(state).toMatchObject({ chatId: null, branchId: null, activeTabId: 'draft-a' })
    expect(state.tabs.find((tab) => tab.id === 'draft-a')).toMatchObject({ chatId: null, branchId: null })
    expect(state.tabs.some((tab) => tab.id === 'chat-new')).toBe(false)
  })

  it('전송 실패 뒤 다른 학습 대화를 다시 열지 않는다', async () => {
    const pending = deferred<unknown>()
    convApi.sendMessage.mockReturnValueOnce(pending.promise)

    const sending = useChatStore.getState().sendMessage('Transformer 잔차 연결의 목적은 무엇인가?')
    await vi.waitFor(() => expect(convApi.sendMessage).toHaveBeenCalledTimes(1))
    chatApi.fetchChat.mockResolvedValueOnce({
      chatMeta: mainMeta({ chatId: 'chat-b', title: 'B 학습 대화' }),
      branchMeta: { branchId: 'branch-b' },
      messageBlocks: [{ blockId: 'block-b', branchId: 'branch-b', role: 'user', content: 'B의 내용', currentVersionId: 'v-b', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' }],
      branchList: [],
    })
    await useChatStore.getState().openChat('chat-b', 'branch-b')
    useChatStore.setState({ draftText: 'B의 입력 초안', error: 'B의 기존 오류', failedJobsByBlockId: { 'block-b': 'job-b' } })

    pending.reject({
      isAxiosError: true,
      response: { data: { errorCode: 'AI_RESPONSE_FAILED', message: 'A 답변 생성 실패', detail: { aiResponseJobId: 'job-a', userMessageBlockId: 'user-a', retryable: true } } },
    })
    await sending

    const state = useChatStore.getState()
    expect(chatApi.fetchChat).toHaveBeenCalledTimes(1)
    expect(state).toMatchObject({ chatId: 'chat-b', branchId: 'branch-b', activeTabId: 'chat-b', draftText: 'B의 입력 초안', error: 'B의 기존 오류' })
    expect(state.blocks.map((block) => block.blockId)).toEqual(['block-b'])
    expect(state.failedJobsByBlockId).toEqual({ 'block-b': 'job-b' })
  })

  it('첫 첨부용 채팅 생성이 늦어도 다른 탭에 파일 상태를 추가하지 않는다', async () => {
    const creating = deferred<unknown>()
    chatApi.createChat.mockReturnValueOnce(creating.promise)
    chatApi.fetchChats.mockResolvedValue({ chats: [], nextCursor: null })
    useChatStore.setState({
      chatId: null, branchId: null, chatTitle: '', blocks: [], draftAttachments: [],
      tabs: [
        { id: 'chat-b', chatId: 'chat-b', branchId: 'branch-b', title: '기존 Transformer 대화', kind: 'MAIN', parentChatId: null },
        { id: 'draft-a', chatId: null, branchId: null, title: '새 대화', kind: 'MAIN', parentChatId: null },
      ],
      activeTabId: 'draft-a',
    })

    const adding = useChatStore.getState().addFiles([new File(['attention'], 'attention.png', { type: 'image/png' })])
    await vi.waitFor(() => expect(chatApi.createChat).toHaveBeenCalledTimes(1))
    chatApi.fetchChat.mockResolvedValueOnce({
      chatMeta: mainMeta({ chatId: 'chat-b', title: '기존 Transformer 대화' }),
      branchMeta: { branchId: 'branch-b' }, messageBlocks: [], branchList: [],
    })
    await useChatStore.getState().switchTab('chat-b')
    creating.resolve({
      chatMeta: mainMeta({ chatId: 'chat-new', title: '새 대화' }),
      branchMeta: { branchId: 'branch-new' }, messageBlocks: [], branchList: [],
    })
    await adding

    const state = useChatStore.getState()
    expect(state).toMatchObject({ chatId: 'chat-b', branchId: 'branch-b', activeTabId: 'chat-b' })
    expect(state.draftAttachments).toEqual([])
    expect(state.tabs.find((tab) => tab.id === 'chat-new')).toMatchObject({ chatId: 'chat-new', branchId: 'branch-new' })
  })

  it('첫 첨부와 학습 질문 전송이 겹치면 업로드가 끝날 때까지 전송하지 않는다', async () => {
    const creating = deferred<unknown>()
    chatApi.createChat.mockReturnValueOnce(creating.promise)
    chatApi.fetchChats.mockResolvedValue({ chats: [], nextCursor: null })
    convApi.sendMessage.mockResolvedValue({
      userBlock: { blockId: 'user-new', branchId: 'branch-new', role: 'user', content: 'Attention Head마다 다른 관계를 배우는 이유는?', currentVersionId: 'v-new', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [] },
      assistantBlock: { blockId: 'assistant-new', branchId: 'branch-new', role: 'assistant', content: '서로 다른 표현 부분공간을 봅니다.', currentVersionId: 'v-new', orderIndex: 1, createdAt: 't', attachments: [], searchSources: [] },
      appliedContext: [], chatTitle: 'Multi-Head Attention 학습', titleGenerated: false, aiResponseJobId: 'job-new', jobStatus: 'completed',
    })
    useChatStore.setState({
      chatId: null, branchId: null, chatTitle: '', blocks: [], draftAttachments: [],
      tabs: [{ id: 'draft-a', chatId: null, branchId: null, title: '새 대화', kind: 'MAIN', parentChatId: null }],
      activeTabId: 'draft-a',
    })

    const sending = useChatStore.getState().sendMessage('Attention Head마다 다른 관계를 배우는 이유는?')
    await vi.waitFor(() => expect(chatApi.createChat).toHaveBeenCalledTimes(1))
    const adding = useChatStore.getState().addFiles([new File(['attention'], 'heads.png', { type: 'image/png' })])
    await Promise.resolve()
    expect(chatApi.createChat).toHaveBeenCalledTimes(1)
    creating.resolve({
      chatMeta: mainMeta({ chatId: 'chat-new', title: '새 대화' }),
      branchMeta: { branchId: 'branch-new' }, messageBlocks: [], branchList: [],
    })
    await Promise.all([adding, sending])

    const state = useChatStore.getState()
    expect(chatApi.createChat).toHaveBeenCalledTimes(1)
    expect(convApi.sendMessage).not.toHaveBeenCalled()
    expect(state.tabs.filter((tab) => tab.chatId === 'chat-new')).toHaveLength(1)
    expect(state.draftAttachments).toHaveLength(1)
    expect(state.draftAttachments[0]).toMatchObject({ fileName: 'heads.png' })
    expect(state.error).toBe('파일 업로드가 끝난 뒤 전송할 수 있습니다.')
  })

  it('생성 스트림이 같은 학습 대화의 다른 노드에 있는 같은 블록 ID를 바꾸지 않는다', async () => {
    let handlers!: Parameters<typeof convApi.openAiResponseStream>[3]
    const streaming = deferred<unknown>()
    convApi.openAiResponseStream.mockImplementation(async (_chatId: string, _branchId: string, _jobId: string, nextHandlers: typeof handlers) => {
      handlers = nextHandlers
      await streaming.promise
    })
    useChatStore.setState({
      blocks: [{ blockId: 'stream-block', branchId: 'branch-1', role: 'assistant', content: 'A', currentVersionId: 'v-a', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'generating', generationJobId: 'job-a' }],
    })

    const attaching = useChatStore.getState().attachToJob('stream-block', 'job-a')
    await vi.waitFor(() => expect(convApi.openAiResponseStream).toHaveBeenCalledTimes(1))
    chatApi.fetchChat.mockResolvedValueOnce({
      chatMeta: mainMeta({ chatId: 'chat-1', title: 'Transformer 분기 학습' }),
      branchMeta: { branchId: 'branch-b' },
      messageBlocks: [{ blockId: 'stream-block', branchId: 'branch-b', role: 'assistant', content: 'B', currentVersionId: 'v-b', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' }],
      branchList: [],
    })
    await useChatStore.getState().openChat('chat-1', 'branch-b')
    handlers.onText?.('의 스트림')
    handlers.onSources?.([{ title: 'A의 검색 출처', url: 'https://example.com/attention' }])
    expect(useChatStore.getState().blocks[0]?.searchSources).toEqual([])
    handlers.onDone?.({ status: 'completed', content: 'A의 완료 답변', sources: [], error: null })
    streaming.resolve(undefined)
    await attaching

    expect(useChatStore.getState().blocks).toMatchObject([{ blockId: 'stream-block', branchId: 'branch-b', content: 'B', generationStatus: 'complete' }])
  })

  it('전송 응답의 인용 스니펫을 사용자 블록에 합쳐 저장한다 ', async () => {
    convApi.sendMessage.mockResolvedValue({
      userBlock: { blockId: 'u1', branchId: 'branch-1', role: 'user', content: '질문', currentVersionId: null, orderIndex: 0, createdAt: 't', attachments: [], searchSources: [] },
      assistantBlock: { blockId: 'a1', branchId: 'branch-1', role: 'assistant', content: '답변', currentVersionId: 'v1', orderIndex: 1, createdAt: 't', attachments: [], searchSources: [] },
      appliedContext: [{ blockId: 'src-1', versionId: 'v-src', orderIndex: 0, content: '인용한 문장' }],
      chatTitle: '대화',
      titleGenerated: false,
    })

    await useChatStore.getState().sendMessage('질문')

    const userBlock = useChatStore.getState().blocks.find((b) => b.blockId === 'u1')
    expect(userBlock?.appliedContext).toEqual([{ blockId: 'src-1', versionId: 'v-src', orderIndex: 0, content: '인용한 문장' }])
  })

  it('기본 웹 검색 상태는 자동이고, 고른 상태 그대로 전송한다 ', async () => {
    convApi.sendMessage.mockResolvedValue({
      userBlock: { blockId: 'u1', branchId: 'branch-1', role: 'user', content: '질문', currentVersionId: null, orderIndex: 0, createdAt: 't', attachments: [], searchSources: [] },
      assistantBlock: { blockId: 'a1', branchId: 'branch-1', role: 'assistant', content: '답변', currentVersionId: 'v1', orderIndex: 1, createdAt: 't', attachments: [], searchSources: [] },
      chatTitle: '대화',
      titleGenerated: false,
    })
    expect(useChatStore.getState().webSearchMode).toBe('auto')

    await useChatStore.getState().sendMessage('질문')

    expect(convApi.sendMessage).toHaveBeenCalledWith(
      'chat-1', 'branch-1', '질문', [],
      expect.objectContaining({ webSearchMode: 'auto' }),
      [],
    )

    useChatStore.getState().setWebSearchMode('always')
    await useChatStore.getState().sendMessage('질문')

    expect(convApi.sendMessage).toHaveBeenLastCalledWith(
      'chat-1', 'branch-1', '질문', [],
      expect.objectContaining({ webSearchMode: 'always' }),
      [],
    )
  })

  it('질문이 저장되기 전에 실패하면 입력 내용을 그대로 남긴다 ', async () => {
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

  it('이미 처리된 정제 결과를 승인·거절하면 최신 상태로 다시 맞춘다 ', async () => {
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
    expect(convApi.sendMessage).toHaveBeenCalledWith('chat-new', 'branch-new', '질문', [], expect.anything(), [])
    expect(useChatStore.getState().chatId).toBe('chat-new')
    expect(useChatStore.getState().blocks.map((b) => b.blockId)).toEqual(['u1', 'a1'])
  })

  it('새 대화(채팅 없음)에서 파일을 붙이면 첫 메시지 전송과 같은 방식으로 대화를 먼저 만든다', async () => {
    chatApi.createChat.mockResolvedValue({
      chatMeta: { chatId: 'chat-new', title: '새 대화' },
      branchMeta: { branchId: 'branch-new' },
      messageBlocks: [],
      branchList: [],
    })
    chatApi.fetchChats.mockResolvedValue({ chats: [], nextCursor: null })
    useChatStore.setState({ chatId: null, branchId: null, draftAttachments: [] })

    const image = new File(['fake-bytes'], 'photo.png', { type: 'image/png' })
    await useChatStore.getState().addFiles([image])

    expect(chatApi.createChat).toHaveBeenCalledOnce()
    expect(useChatStore.getState().chatId).toBe('chat-new')
    const [attachment] = useChatStore.getState().draftAttachments
    expect(attachment.fileName).toBe('photo.png')
    // 이미지는 실제 미리보기를 볼 수 있게 로컬 blob 주소를 즉시 받는다 (클립보드 붙여넣기 요건)
    expect(attachment.localUrl).toMatch(/^blob:/)
  })

  it('클립보드에서 붙여넣은 이미지도 파일 첨부와 같은 경로로 처리해 미리보기 주소를 받는다', async () => {
    const image = new File(['fake-bytes'], 'clipboard.png', { type: 'image/png' })
    await useChatStore.getState().addFiles([image])

    const [attachment] = useChatStore.getState().draftAttachments
    expect(attachment.mimeType).toBe('image/png')
    expect(attachment.localUrl).toMatch(/^blob:/)
  })

  it('전송 뒤 빈 답변 블록에 스트리밍 통로로 도착한 글자를 이어 붙인다 ', async () => {
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

  it('중단하면 서버가 돌려준 그때까지의 본문으로 블록을 확정한다 ', async () => {
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

  it('재생성 결과가 늦어도 다른 학습 노드의 같은 블록 ID를 덮지 않는다', async () => {
    const pending = deferred<unknown>()
    convApi.regenerate.mockReturnValueOnce(pending.promise)
    useChatStore.setState({
      chatTitle: 'A Self-Attention 학습',
      blocks: [{ blockId: 'answer-block', branchId: 'branch-1', role: 'assistant', content: 'A의 기존 답변', currentVersionId: 'v-a', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' }],
    })

    const regenerating = useChatStore.getState().regenerate('answer-block')
    await vi.waitFor(() => expect(convApi.regenerate).toHaveBeenCalledWith('chat-1', 'branch-1', 'answer-block'))
    convApi.fetchFeedback.mockResolvedValue({ aiMessageBlockId: 'answer-block', rating: null })
    chatApi.fetchChat.mockResolvedValueOnce({
      chatMeta: mainMeta({ chatId: 'chat-b', title: 'B Causal Mask 학습' }),
      branchMeta: { branchId: 'branch-b' },
      messageBlocks: [{ blockId: 'answer-block', branchId: 'branch-b', role: 'assistant', content: 'B의 기존 답변', currentVersionId: 'v-b', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' }],
      branchList: [],
    })
    await useChatStore.getState().openChat('chat-b', 'branch-b')

    pending.resolve({ blockId: 'answer-block', branchId: 'branch-1', role: 'assistant', content: 'A의 재생성 답변', currentVersionId: 'v-a2', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'generating', aiResponseJobId: 'job-a' })
    await regenerating

    const state = useChatStore.getState()
    expect(state).toMatchObject({ chatId: 'chat-b', branchId: 'branch-b', chatTitle: 'B Causal Mask 학습', isSending: false })
    expect(state.blocks).toMatchObject([{ blockId: 'answer-block', branchId: 'branch-b', content: 'B의 기존 답변', generationStatus: 'complete' }])
  })

  it('재생성 실패가 늦어도 다른 학습 대화의 오류를 바꾸지 않는다', async () => {
    const pending = deferred<unknown>()
    convApi.regenerate.mockReturnValueOnce(pending.promise)
    useChatStore.setState({ blocks: [{ blockId: 'answer-a', branchId: 'branch-1', role: 'assistant', content: 'A 답변', currentVersionId: 'v-a', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' }] })

    const regenerating = useChatStore.getState().regenerate('answer-a')
    await vi.waitFor(() => expect(convApi.regenerate).toHaveBeenCalledTimes(1))
    chatApi.fetchChat.mockResolvedValueOnce({ chatMeta: mainMeta({ chatId: 'chat-b', title: 'B 학습 대화' }), branchMeta: { branchId: 'branch-b' }, messageBlocks: [], branchList: [] })
    await useChatStore.getState().openChat('chat-b', 'branch-b')
    useChatStore.setState({ error: 'B의 기존 오류' })

    pending.reject(new Error('A 재생성 실패'))
    await regenerating

    expect(useChatStore.getState()).toMatchObject({ chatId: 'chat-b', branchId: 'branch-b', error: 'B의 기존 오류', isSending: false })
  })

  it('재생성 결과가 늦어도 같은 학습 대화에서 선택한 다른 노드를 덮지 않는다', async () => {
    const pending = deferred<unknown>()
    convApi.regenerate.mockReturnValueOnce(pending.promise)
    useChatStore.setState({ blocks: [{ blockId: 'answer-shared', branchId: 'branch-1', role: 'assistant', content: '원래 노드 답변', currentVersionId: 'v-a', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' }] })

    const regenerating = useChatStore.getState().regenerate('answer-shared')
    await vi.waitFor(() => expect(convApi.regenerate).toHaveBeenCalledTimes(1))
    convApi.fetchFeedback.mockResolvedValue({ aiMessageBlockId: 'answer-shared', rating: null })
    chatApi.fetchBranch.mockResolvedValueOnce({
      branchMeta: { branchId: 'branch-b' },
      messageBlocks: [{ blockId: 'answer-shared', branchId: 'branch-b', role: 'assistant', content: '다른 노드 답변', currentVersionId: 'v-b', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' }],
      sourceContextInfo: [],
    })
    await useChatStore.getState().switchBranch('branch-b')

    pending.resolve({ blockId: 'answer-shared', branchId: 'branch-1', role: 'assistant', content: '원래 노드 재생성', currentVersionId: 'v-a2', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'generating', aiResponseJobId: 'job-shared' })
    await regenerating

    expect(useChatStore.getState().blocks).toMatchObject([{ blockId: 'answer-shared', branchId: 'branch-b', content: '다른 노드 답변', generationStatus: 'complete' }])
  })

  it('답변 재시도 결과가 늦어도 다른 학습 대화의 제목과 블록을 바꾸지 않는다', async () => {
    const pending = deferred<unknown>()
    convApi.retryAiResponseJob.mockReturnValueOnce(pending.promise)
    useChatStore.setState({ failedJobsByBlockId: { 'user-a': 'job-a' }, blocks: [{ blockId: 'user-a', branchId: 'branch-1', role: 'user', content: 'A 질문', currentVersionId: 'v-a', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' }] })

    const retrying = useChatStore.getState().retryAiResponseJob('job-a')
    await vi.waitFor(() => expect(convApi.retryAiResponseJob).toHaveBeenCalledWith('chat-1', 'branch-1', 'job-a'))
    chatApi.fetchChat.mockResolvedValueOnce({
      chatMeta: mainMeta({ chatId: 'chat-b', title: 'B Attention Head 학습' }),
      branchMeta: { branchId: 'branch-b' },
      messageBlocks: [{ blockId: 'user-b', branchId: 'branch-b', role: 'user', content: 'B 질문', currentVersionId: 'v-b', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' }],
      branchList: [],
    })
    await useChatStore.getState().openChat('chat-b', 'branch-b')

    pending.resolve({
      assistantBlock: { blockId: 'assistant-a', branchId: 'branch-1', role: 'assistant', content: 'A 재시도 답변', currentVersionId: 'v-a2', orderIndex: 1, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'generating' },
      chatTitle: 'A 재시도 제목', aiResponseJobId: 'job-a-retry',
    })
    await retrying

    const state = useChatStore.getState()
    expect(state).toMatchObject({ chatId: 'chat-b', branchId: 'branch-b', chatTitle: 'B Attention Head 학습', isSending: false })
    expect(state.blocks.map((block) => block.blockId)).toEqual(['user-b'])
  })

  it('답변 재시도 실패가 늦어도 다른 학습 대화의 오류를 바꾸지 않는다', async () => {
    const pending = deferred<unknown>()
    convApi.retryAiResponseJob.mockReturnValueOnce(pending.promise)
    const retrying = useChatStore.getState().retryAiResponseJob('job-a')
    await vi.waitFor(() => expect(convApi.retryAiResponseJob).toHaveBeenCalledTimes(1))
    chatApi.fetchChat.mockResolvedValueOnce({ chatMeta: mainMeta({ chatId: 'chat-b', title: 'B 학습 대화' }), branchMeta: { branchId: 'branch-b' }, messageBlocks: [], branchList: [] })
    await useChatStore.getState().openChat('chat-b', 'branch-b')
    useChatStore.setState({ error: 'B의 기존 오류' })

    pending.reject(new Error('A 재시도 실패'))
    await retrying

    expect(useChatStore.getState()).toMatchObject({ chatId: 'chat-b', branchId: 'branch-b', error: 'B의 기존 오류', isSending: false })
  })

  it('답변 재시도 완료가 늦어도 다른 학습 대화의 전송 상태를 끄지 않는다', async () => {
    const pendingRetry = deferred<unknown>()
    const pendingSend = deferred<unknown>()
    convApi.retryAiResponseJob.mockReturnValueOnce(pendingRetry.promise)
    convApi.sendMessage.mockReturnValueOnce(pendingSend.promise)

    const retrying = useChatStore.getState().retryAiResponseJob('job-a')
    await vi.waitFor(() => expect(convApi.retryAiResponseJob).toHaveBeenCalledTimes(1))
    chatApi.fetchChat.mockResolvedValueOnce({ chatMeta: mainMeta({ chatId: 'chat-b', title: 'B 학습 대화' }), branchMeta: { branchId: 'branch-b' }, messageBlocks: [], branchList: [] })
    await useChatStore.getState().openChat('chat-b', 'branch-b')
    const sendingB = useChatStore.getState().sendMessage('B의 Causal Mask 질문')
    await vi.waitFor(() => expect(convApi.sendMessage).toHaveBeenCalledTimes(1))

    pendingRetry.resolve({
      assistantBlock: { blockId: 'assistant-a', branchId: 'branch-1', role: 'assistant', content: 'A 재시도 답변', currentVersionId: 'v-a', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'generating' },
      chatTitle: 'A 재시도 제목', aiResponseJobId: 'job-a-retry',
    })
    await retrying

    expect(useChatStore.getState()).toMatchObject({ chatId: 'chat-b', branchId: 'branch-b', chatTitle: 'B 학습 대화', isSending: true })
    pendingSend.resolve({
      userBlock: { blockId: 'user-b', branchId: 'branch-b', role: 'user', content: 'B의 Causal Mask 질문', currentVersionId: 'v-b', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [] },
      assistantBlock: { blockId: 'assistant-b', branchId: 'branch-b', role: 'assistant', content: 'B 답변', currentVersionId: 'v-b', orderIndex: 1, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' },
      appliedContext: [], chatTitle: 'B 학습 대화', titleGenerated: false, aiResponseJobId: 'job-b', jobStatus: 'completed',
    })
    await sendingB
  })

  it('생성 중단 결과가 늦어도 다른 학습 노드의 같은 블록 ID를 덮지 않는다', async () => {
    const pending = deferred<unknown>()
    convApi.cancelAiResponseJob.mockReturnValueOnce(pending.promise)
    useChatStore.setState({
      blocks: [{ blockId: 'answer-block', branchId: 'branch-1', role: 'assistant', content: 'A 생성 중 답변', currentVersionId: 'v-a', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'generating', generationJobId: 'job-a' }],
    })

    const cancelling = useChatStore.getState().cancelGeneration('answer-block')
    await vi.waitFor(() => expect(convApi.cancelAiResponseJob).toHaveBeenCalledWith('chat-1', 'branch-1', 'job-a'))
    convApi.fetchFeedback.mockResolvedValue({ aiMessageBlockId: 'answer-block', rating: null })
    chatApi.fetchChat.mockResolvedValueOnce({
      chatMeta: mainMeta({ chatId: 'chat-1', title: '다른 A 노드' }),
      branchMeta: { branchId: 'branch-b' },
      messageBlocks: [{ blockId: 'answer-block', branchId: 'branch-b', role: 'assistant', content: 'B 노드 생성 중 답변', currentVersionId: 'v-b', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'generating', generationJobId: 'job-b' }],
      branchList: [],
    })
    await useChatStore.getState().openChat('chat-1', 'branch-b')

    pending.resolve({ blockId: 'answer-block', branchId: 'branch-1', role: 'assistant', content: 'A 중단 답변', currentVersionId: 'v-a', versionNo: 1, orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'cancelled' })
    await cancelling

    expect(useChatStore.getState().blocks).toMatchObject([{ blockId: 'answer-block', branchId: 'branch-b', content: 'B 노드 생성 중 답변', generationStatus: 'generating', generationJobId: 'job-b' }])
  })

  it('생성 중단 실패가 늦어도 다른 학습 대화의 오류를 바꾸지 않는다', async () => {
    const pending = deferred<unknown>()
    convApi.cancelAiResponseJob.mockReturnValueOnce(pending.promise)
    useChatStore.setState({ blocks: [{ blockId: 'answer-a', branchId: 'branch-1', role: 'assistant', content: 'A 생성 중 답변', currentVersionId: 'v-a', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'generating', generationJobId: 'job-a' }] })

    const cancelling = useChatStore.getState().cancelGeneration('answer-a')
    await vi.waitFor(() => expect(convApi.cancelAiResponseJob).toHaveBeenCalledTimes(1))
    chatApi.fetchChat.mockResolvedValueOnce({ chatMeta: mainMeta({ chatId: 'chat-b', title: 'B 학습 대화' }), branchMeta: { branchId: 'branch-b' }, messageBlocks: [], branchList: [] })
    await useChatStore.getState().openChat('chat-b', 'branch-b')
    useChatStore.setState({ error: 'B의 기존 오류' })

    pending.reject(new Error('A 생성 중단 실패'))
    await cancelling

    expect(useChatStore.getState()).toMatchObject({ chatId: 'chat-b', branchId: 'branch-b', error: 'B의 기존 오류', isSending: false })
  })

  it('늦은 생성 중단 응답이 같은 블록의 새 작업을 덮지 않는다', async () => {
    const pending = deferred<unknown>()
    convApi.cancelAiResponseJob.mockReturnValueOnce(pending.promise)
    useChatStore.setState({ blocks: [{ blockId: 'answer-a', branchId: 'branch-1', role: 'assistant', content: '이전 작업 본문', currentVersionId: 'v-a', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'generating', generationJobId: 'job-old' }] })

    const cancelling = useChatStore.getState().cancelGeneration('answer-a')
    await vi.waitFor(() => expect(convApi.cancelAiResponseJob).toHaveBeenCalledWith('chat-1', 'branch-1', 'job-old'))
    useChatStore.setState({ blocks: [{ blockId: 'answer-a', branchId: 'branch-1', role: 'assistant', content: '새 작업 본문', currentVersionId: 'v-a2', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'generating', generationJobId: 'job-new' }] })

    pending.resolve({ blockId: 'answer-a', branchId: 'branch-1', role: 'assistant', content: '이전 작업 중단 본문', currentVersionId: 'v-a', versionNo: 1, orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'cancelled' })
    await cancelling

    expect(useChatStore.getState().blocks).toMatchObject([{ blockId: 'answer-a', content: '새 작업 본문', generationStatus: 'generating', generationJobId: 'job-new' }])
  })

  it('재생성 중 원래 학습 노드로 돌아오면 진행 상태와 결과를 이어서 표시한다', async () => {
    const pending = deferred<unknown>()
    convApi.regenerate.mockReturnValueOnce(pending.promise)
    useChatStore.setState({ blocks: [{ blockId: 'answer-a', branchId: 'branch-1', role: 'assistant', content: 'A 기존 답변', currentVersionId: 'v-a', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' }] })

    const regenerating = useChatStore.getState().regenerate('answer-a')
    await vi.waitFor(() => expect(convApi.regenerate).toHaveBeenCalledTimes(1))
    chatApi.fetchChat
      .mockResolvedValueOnce({ chatMeta: mainMeta({ chatId: 'chat-b', title: 'B 학습 대화' }), branchMeta: { branchId: 'branch-b' }, messageBlocks: [], branchList: [] })
      .mockResolvedValueOnce({ chatMeta: mainMeta({ chatId: 'chat-1', title: 'A Self-Attention 학습' }), branchMeta: { branchId: 'branch-1' }, messageBlocks: [{ blockId: 'answer-a', branchId: 'branch-1', role: 'assistant', content: 'A 기존 답변', currentVersionId: 'v-a', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' }], branchList: [] })
    await useChatStore.getState().openChat('chat-b', 'branch-b')
    await useChatStore.getState().openChat('chat-1', 'branch-1')
    expect(useChatStore.getState().isSending).toBe(true)

    pending.resolve({ blockId: 'answer-a', branchId: 'branch-1', role: 'assistant', content: 'A 재생성 답변', currentVersionId: 'v-a2', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete', aiResponseJobId: 'job-a' })
    await regenerating

    expect(useChatStore.getState().blocks).toMatchObject([{ blockId: 'answer-a', branchId: 'branch-1', content: 'A 재생성 답변', generationStatus: 'complete' }])
    expect(useChatStore.getState().isSending).toBe(false)
  })

  it('다른 학습 대화로 이동한 뒤 재생성 응답이 와도 A 작업을 B 스트림으로 연결하지 않는다', async () => {
    const pendingRegenerate = deferred<unknown>()
    const pendingB = deferred<unknown>()
    convApi.regenerate.mockReturnValueOnce(pendingRegenerate.promise)
    convApi.sendMessage.mockReturnValueOnce(pendingB.promise)
    useChatStore.setState({ blocks: [{ blockId: 'answer-a', branchId: 'branch-1', role: 'assistant', content: 'A 답변', currentVersionId: 'v-a', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' }] })

    const regenerating = useChatStore.getState().regenerate('answer-a')
    await vi.waitFor(() => expect(convApi.regenerate).toHaveBeenCalledTimes(1))
    chatApi.fetchChat.mockResolvedValueOnce({
      chatMeta: mainMeta({ chatId: 'chat-b', title: 'B Transformer 학습' }),
      branchMeta: { branchId: 'branch-b' },
      messageBlocks: [{ blockId: 'answer-b', branchId: 'branch-b', role: 'assistant', content: 'B 답변', currentVersionId: 'v-b', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' }],
      branchList: [],
    })
    convApi.fetchFeedback.mockResolvedValue({ aiMessageBlockId: 'answer-b', rating: null })
    await useChatStore.getState().openChat('chat-b', 'branch-b')
    const sendingB = useChatStore.getState().sendMessage('B의 Attention Head 질문')
    await vi.waitFor(() => expect(convApi.sendMessage).toHaveBeenCalledTimes(1))

    pendingRegenerate.resolve({ blockId: 'answer-a', branchId: 'branch-1', role: 'assistant', content: 'A 재생성 답변', currentVersionId: 'v-a2', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'generating', aiResponseJobId: 'job-a' })
    await regenerating

    const state = useChatStore.getState()
    expect(state).toMatchObject({ chatId: 'chat-b', branchId: 'branch-b', chatTitle: 'B Transformer 학습', isSending: true })
    expect(state.blocks.map((block) => block.blockId)).toEqual(['answer-b', expect.any(String)])
    expect(convApi.openAiResponseStream).not.toHaveBeenCalledWith('chat-b', 'branch-b', 'job-a', expect.anything(), expect.any(AbortSignal))
    expect(convApi.fetchVersions).not.toHaveBeenCalledWith('chat-b', 'branch-b', 'answer-a')

    pendingB.resolve({
      userBlock: { blockId: 'user-b', branchId: 'branch-b', role: 'user', content: 'B의 Attention Head 질문', currentVersionId: 'v-b', orderIndex: 1, createdAt: 't', attachments: [], searchSources: [] },
      assistantBlock: { blockId: 'assistant-b', branchId: 'branch-b', role: 'assistant', content: 'B 답변', currentVersionId: 'v-b', orderIndex: 2, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' },
      appliedContext: [], chatTitle: 'B Transformer 학습', titleGenerated: false, aiResponseJobId: 'job-b', jobStatus: 'completed',
    })
    await sendingB
  })

  it('재생성 재진입 조회의 스트림 본문과 작업 ID를 빈 초기 응답이 지우지 않는다', async () => {
    const pendingRegenerate = deferred<unknown>()
    const stream = deferred<unknown>()
    let handlers!: Parameters<typeof convApi.openAiResponseStream>[3]
    convApi.regenerate.mockReturnValueOnce(pendingRegenerate.promise)
    convApi.openAiResponseStream.mockImplementation(async (_chatId: string, _branchId: string, _jobId: string, nextHandlers: typeof handlers) => {
      handlers = nextHandlers
      await stream.promise
    })
    useChatStore.setState({ blocks: [{ blockId: 'answer-reentry', branchId: 'branch-1', role: 'assistant', content: 'A 기존 답변', currentVersionId: 'v-a', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' }] })

    const regenerating = useChatStore.getState().regenerate('answer-reentry')
    await vi.waitFor(() => expect(convApi.regenerate).toHaveBeenCalledTimes(1))
    chatApi.fetchChat
      .mockResolvedValueOnce({ chatMeta: mainMeta({ chatId: 'chat-b', title: 'B 학습 대화' }), branchMeta: { branchId: 'branch-b' }, messageBlocks: [], branchList: [] })
      .mockResolvedValueOnce({
        chatMeta: mainMeta({ chatId: 'chat-1', title: 'A Self-Attention 학습' }),
        branchMeta: { branchId: 'branch-1' },
        messageBlocks: [{ blockId: 'answer-reentry', branchId: 'branch-1', role: 'assistant', content: '복귀한 본문', currentVersionId: 'v-a2', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'generating', generationJobId: 'job-reentry' }],
        branchList: [],
      })
    await useChatStore.getState().openChat('chat-b', 'branch-b')
    await useChatStore.getState().openChat('chat-1', 'branch-1')
    await vi.waitFor(() => expect(convApi.openAiResponseStream).toHaveBeenCalledTimes(1))
    handlers.onText?.(' 추가')

    pendingRegenerate.resolve({ blockId: 'answer-reentry', branchId: 'branch-1', role: 'assistant', content: '', currentVersionId: 'v-a2', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'generating', aiResponseJobId: 'job-reentry' })
    await regenerating

    expect(convApi.openAiResponseStream).toHaveBeenCalledTimes(1)
    expect(useChatStore.getState().blocks).toMatchObject([{ blockId: 'answer-reentry', content: '복귀한 본문 추가', generationStatus: 'generating', generationJobId: 'job-reentry' }])
    stream.resolve(undefined)
  })

  it('재생성 재진입 뒤 완료된 최신 답변을 늦은 빈 초기 응답이 되돌리지 않는다', async () => {
    const pending = deferred<unknown>()
    convApi.regenerate.mockReturnValueOnce(pending.promise)
    useChatStore.setState({
      blocks: [{ blockId: 'answer-a', branchId: 'branch-1', role: 'assistant', content: '기존 Self-Attention 답변', currentVersionId: 'v-a', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' }],
    })

    const regenerating = useChatStore.getState().regenerate('answer-a')
    await vi.waitFor(() => expect(convApi.regenerate).toHaveBeenCalledTimes(1))
    chatApi.fetchChat
      .mockResolvedValueOnce({ chatMeta: mainMeta({ chatId: 'chat-b', title: 'B Attention 학습' }), branchMeta: { branchId: 'branch-b' }, messageBlocks: [], branchList: [] })
      .mockResolvedValueOnce({
        chatMeta: mainMeta({ chatId: 'chat-1', title: 'Self-Attention 재생성 학습' }),
        branchMeta: { branchId: 'branch-1' },
        messageBlocks: [{ blockId: 'answer-a', branchId: 'branch-1', role: 'assistant', content: '완료된 최신 Self-Attention 답변', currentVersionId: 'v-a2', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' }],
        branchList: [],
      })
    convApi.fetchFeedback.mockResolvedValue({ aiMessageBlockId: 'answer-a', rating: null })
    await useChatStore.getState().openChat('chat-b', 'branch-b')
    await useChatStore.getState().openChat('chat-1', 'branch-1')

    pending.resolve({ blockId: 'answer-a', branchId: 'branch-1', role: 'assistant', content: '', currentVersionId: 'v-a2', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'generating', aiResponseJobId: 'job-a' })
    await regenerating

    expect(useChatStore.getState().blocks).toMatchObject([{ blockId: 'answer-a', content: '완료된 최신 Self-Attention 답변', currentVersionId: 'v-a2', generationStatus: 'complete' }])
    expect(convApi.openAiResponseStream).not.toHaveBeenCalled()
  })

  it('답변 재시도는 같은 학습 대화에서 한 번만 시작하고 새 답변에 작업 ID를 남긴다', async () => {
    const pending = deferred<unknown>()
    convApi.retryAiResponseJob.mockReturnValueOnce(pending.promise)

    const first = useChatStore.getState().retryAiResponseJob('job-a')
    const second = useChatStore.getState().retryAiResponseJob('job-a')
    await vi.waitFor(() => expect(convApi.retryAiResponseJob).toHaveBeenCalledTimes(1))
    pending.resolve({
      assistantBlock: { blockId: 'assistant-a', branchId: 'branch-1', role: 'assistant', content: '', currentVersionId: 'v-a', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'generating' },
      chatTitle: '재시도 학습', aiResponseJobId: 'job-a-retry',
    })
    await Promise.all([first, second])

    expect(useChatStore.getState().blocks).toMatchObject([{ blockId: 'assistant-a', generationJobId: 'job-a-retry', generationStatus: 'generating' }])
  })

  it('재시도 재진입 뒤 완료된 최신 답변을 늦은 빈 초기 응답이 되돌리지 않는다', async () => {
    const pending = deferred<unknown>()
    convApi.retryAiResponseJob.mockReturnValueOnce(pending.promise)
    useChatStore.setState({
      failedJobsByBlockId: { 'user-a': 'job-a' },
      blocks: [{ blockId: 'user-a', branchId: 'branch-1', role: 'user', content: 'Multi-Head Attention 질문', currentVersionId: 'v-user', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' }],
    })

    const retrying = useChatStore.getState().retryAiResponseJob('job-a')
    await vi.waitFor(() => expect(convApi.retryAiResponseJob).toHaveBeenCalledTimes(1))
    chatApi.fetchChat
      .mockResolvedValueOnce({ chatMeta: mainMeta({ chatId: 'chat-b', title: 'B Positional Encoding 학습' }), branchMeta: { branchId: 'branch-b' }, messageBlocks: [], branchList: [] })
      .mockResolvedValueOnce({
        chatMeta: mainMeta({ chatId: 'chat-1', title: 'Multi-Head Attention 재시도 학습' }),
        branchMeta: { branchId: 'branch-1' },
        messageBlocks: [
          { blockId: 'user-a', branchId: 'branch-1', role: 'user', content: 'Multi-Head Attention 질문', currentVersionId: 'v-user', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' },
          { blockId: 'assistant-a2', branchId: 'branch-1', role: 'assistant', content: '완료된 최신 Multi-Head Attention 답변', currentVersionId: 'v-a2', orderIndex: 1, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' },
        ],
        branchList: [],
      })
    convApi.fetchFeedback.mockResolvedValue({ aiMessageBlockId: 'assistant-a2', rating: null })
    await useChatStore.getState().openChat('chat-b', 'branch-b')
    await useChatStore.getState().openChat('chat-1', 'branch-1')

    pending.resolve({
      assistantBlock: { blockId: 'assistant-a2', branchId: 'branch-1', role: 'assistant', content: '', currentVersionId: 'v-a2', orderIndex: 1, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'generating' },
      chatTitle: 'Multi-Head Attention 재시도 학습', aiResponseJobId: 'job-a-retry',
    })
    await retrying

    expect(useChatStore.getState().blocks.find((block) => block.blockId === 'assistant-a2')).toMatchObject({ content: '완료된 최신 Multi-Head Attention 답변', currentVersionId: 'v-a2', generationStatus: 'complete' })
    expect(convApi.openAiResponseStream).not.toHaveBeenCalled()
  })

  it('백그라운드 재시도 완료 뒤 늦은 재진입 조회는 최신 학습 답변을 다시 읽는다', async () => {
    const pendingRetry = deferred<unknown>()
    const staleA = deferred<unknown>()
    convApi.retryAiResponseJob.mockReturnValueOnce(pendingRetry.promise)
    const retrying = useChatStore.getState().retryAiResponseJob('job-a')
    await vi.waitFor(() => expect(convApi.retryAiResponseJob).toHaveBeenCalledTimes(1))

    chatApi.fetchChat.mockResolvedValueOnce({ chatMeta: mainMeta({ chatId: 'chat-b', title: 'B 학습 대화' }), branchMeta: { branchId: 'branch-b' }, messageBlocks: [], branchList: [] })
    await useChatStore.getState().openChat('chat-b', 'branch-b')
    chatApi.fetchChat
      .mockReturnValueOnce(staleA.promise)
      .mockResolvedValueOnce({
        chatMeta: mainMeta({ chatId: 'chat-1', title: 'A 재시도 학습' }),
        branchMeta: { branchId: 'branch-1' },
        messageBlocks: [
          { blockId: 'user-a', branchId: 'branch-1', role: 'user', content: 'A 질문', currentVersionId: 'v-a', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' },
          { blockId: 'assistant-a', branchId: 'branch-1', role: 'assistant', content: '재시도된 최신 답변', currentVersionId: 'v-a2', orderIndex: 1, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' },
        ],
        branchList: [],
      })
    convApi.fetchFeedback.mockResolvedValue({ aiMessageBlockId: 'assistant-a', rating: null })
    const openingA = useChatStore.getState().openChat('chat-1', 'branch-1')
    await vi.waitFor(() => expect(chatApi.fetchChat).toHaveBeenCalledTimes(2))

    pendingRetry.resolve({
      assistantBlock: { blockId: 'assistant-a', branchId: 'branch-1', role: 'assistant', content: '', currentVersionId: 'v-a2', orderIndex: 1, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'generating' },
      chatTitle: 'A 재시도 학습', aiResponseJobId: 'job-a-retry',
    })
    await retrying
    staleA.resolve({
      chatMeta: mainMeta({ chatId: 'chat-1', title: '오래된 A 제목' }),
      branchMeta: { branchId: 'branch-1' },
      messageBlocks: [{ blockId: 'user-a', branchId: 'branch-1', role: 'user', content: 'A 질문', currentVersionId: 'v-a', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' }],
      branchList: [],
    })
    await openingA

    expect(chatApi.fetchChat).toHaveBeenCalledTimes(3)
    expect(useChatStore.getState()).toMatchObject({ chatId: 'chat-1', branchId: 'branch-1', chatTitle: 'A 재시도 학습' })
    expect(useChatStore.getState().blocks.map((block) => block.blockId)).toEqual(['user-a', 'assistant-a'])
  })

  it('중단 뒤 늦은 이전 스트림 완료가 취소된 답변을 되돌리지 않는다', async () => {
    const stream = deferred<unknown>()
    let handlers!: Parameters<typeof convApi.openAiResponseStream>[3]
    convApi.openAiResponseStream.mockImplementation(async (_chatId: string, _branchId: string, _jobId: string, nextHandlers: typeof handlers) => {
      handlers = nextHandlers
      await stream.promise
    })
    useChatStore.setState({ blocks: [{ blockId: 'answer-cancel', branchId: 'branch-1', role: 'assistant', content: '생성 중 본문', currentVersionId: 'v-a', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'generating', generationJobId: 'job-cancel' }] })
    const attaching = useChatStore.getState().attachToJob('answer-cancel', 'job-cancel')
    await vi.waitFor(() => expect(convApi.openAiResponseStream).toHaveBeenCalledTimes(1))
    convApi.cancelAiResponseJob.mockResolvedValueOnce({ blockId: 'answer-cancel', branchId: 'branch-1', role: 'assistant', content: '중단된 본문', currentVersionId: 'v-a', versionNo: 1, orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'cancelled' })

    await useChatStore.getState().cancelGeneration('answer-cancel')
    handlers.onDone?.({ status: 'completed', content: '이전 완료 본문', sources: [], error: null })
    stream.resolve(undefined)
    await attaching

    expect(useChatStore.getState().blocks).toMatchObject([{ blockId: 'answer-cancel', content: '중단된 본문', generationStatus: 'cancelled', generationJobId: null }])
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

  it('늦게 끝난 이전 대화 열기 요청이 마지막으로 고른 대화를 덮지 않는다', async () => {
    const first = deferred<unknown>()
    const second = deferred<unknown>()
    chatApi.fetchChat.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    convApi.fetchFeedback.mockResolvedValue({ aiMessageBlockId: 'feedback', rating: null })

    const firstOpen = useChatStore.getState().openChat('chat-a', 'branch-a')
    await vi.waitFor(() => expect(chatApi.fetchChat).toHaveBeenCalledTimes(1))
    const secondOpen = useChatStore.getState().openChat('chat-b', 'branch-b')
    await vi.waitFor(() => expect(chatApi.fetchChat).toHaveBeenCalledTimes(2))

    second.resolve({
      chatMeta: mainMeta({ chatId: 'chat-b', title: '마지막 대화' }),
      branchMeta: { branchId: 'branch-b' },
      messageBlocks: [{ blockId: 'block-b', branchId: 'branch-b', role: 'user', content: 'B', currentVersionId: 'v-b', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' }],
      branchList: [],
    })
    await secondOpen
    first.resolve({
      chatMeta: mainMeta({ chatId: 'chat-a', title: '이전 대화' }),
      branchMeta: { branchId: 'branch-a' },
      messageBlocks: [{ blockId: 'block-a', branchId: 'branch-a', role: 'user', content: 'A', currentVersionId: 'v-a', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' }],
      branchList: [],
    })
    await firstOpen

    expect(useChatStore.getState()).toMatchObject({
      chatId: 'chat-b',
      branchId: 'branch-b',
      activeTabId: 'chat-b',
      chatTitle: '마지막 대화',
    })
    expect(useChatStore.getState().blocks.map((block) => block.blockId)).toEqual(['block-b'])
  })

  it('대화를 여는 중 새 초안으로 전환하면 늦은 응답을 무시한다', async () => {
    const pending = deferred<unknown>()
    chatApi.fetchChat.mockReturnValueOnce(pending.promise)

    const opening = useChatStore.getState().openChat('chat-a', 'branch-a')
    await vi.waitFor(() => expect(chatApi.fetchChat).toHaveBeenCalledTimes(1))
    await useChatStore.getState().newChat()
    const draftTabId = useChatStore.getState().activeTabId

    pending.resolve({
      chatMeta: mainMeta({ chatId: 'chat-a', title: '늦은 대화' }),
      branchMeta: { branchId: 'branch-a' },
      messageBlocks: [{ blockId: 'block-a', branchId: 'branch-a', role: 'user', content: 'A', currentVersionId: 'v-a', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' }],
      branchList: [],
    })
    await opening

    expect(useChatStore.getState()).toMatchObject({
      chatId: null,
      chatTitle: '',
      branchId: null,
      activeTabId: draftTabId,
      blocks: [],
    })
  })

  it('대화를 여는 중 기존 초안 탭으로 전환하면 늦은 응답을 무시한다', async () => {
    const pending = deferred<unknown>()
    chatApi.fetchChat.mockReturnValueOnce(pending.promise)
    useChatStore.setState({
      tabs: [
        { id: 'chat-1', chatId: 'chat-1', branchId: 'branch-1', title: '대화', kind: 'MAIN', parentChatId: null },
        { id: 'draft-1', chatId: null, branchId: null, title: '새 대화', kind: 'MAIN', parentChatId: null },
      ],
    })

    const opening = useChatStore.getState().openChat('chat-a', 'branch-a')
    await vi.waitFor(() => expect(chatApi.fetchChat).toHaveBeenCalledTimes(1))
    await useChatStore.getState().switchTab('draft-1')

    pending.resolve({
      chatMeta: mainMeta({ chatId: 'chat-a', title: '늦은 대화' }),
      branchMeta: { branchId: 'branch-a' },
      messageBlocks: [{ blockId: 'block-a', branchId: 'branch-a', role: 'user', content: 'A', currentVersionId: 'v-a', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' }],
      branchList: [],
    })
    await opening

    expect(useChatStore.getState()).toMatchObject({
      chatId: null,
      chatTitle: '',
      branchId: null,
      activeTabId: 'draft-1',
      blocks: [],
    })
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

  it('열리는 중인 배경 탭을 닫으면 늦은 응답을 무시한다', async () => {
    const pending = deferred<unknown>()
    chatApi.fetchChat.mockReturnValueOnce(pending.promise)
    useChatStore.setState({
      tabs: [
        { id: 'chat-1', chatId: 'chat-1', branchId: 'branch-1', title: '현재 대화', kind: 'MAIN', parentChatId: null },
        { id: 'chat-a', chatId: 'chat-a', branchId: 'branch-a', title: '열리는 대화', kind: 'MAIN', parentChatId: null },
      ],
    })

    const opening = useChatStore.getState().openChat('chat-a', 'branch-a')
    await vi.waitFor(() => expect(chatApi.fetchChat).toHaveBeenCalledTimes(1))
    await useChatStore.getState().closeTab('chat-a')

    pending.resolve({
      chatMeta: mainMeta({ chatId: 'chat-a', title: '늦은 대화' }),
      branchMeta: { branchId: 'branch-a' },
      messageBlocks: [{ blockId: 'block-a', branchId: 'branch-a', role: 'user', content: 'Self-Attention', currentVersionId: 'v-a', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' }],
      branchList: [],
    })
    await opening

    const state = useChatStore.getState()
    expect(state.tabs.map((tab) => tab.id)).toEqual(['chat-1'])
    expect(state.activeTabId).toBe('chat-1')
    expect(state.chatId).toBe('chat-1')
    expect(state.blocks).toEqual([])
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

  it('우측 사이드 패널에서 만든 대화도 메인 대화 구조를 즉시 새로고침한다', async () => {
    const sideStore = createChatStore()
    sideStore.setState({ chatId: 'side-parent', branchId: 'side-branch', tabs: [] })
    useChatStore.setState({ chatId: 'chat-1', branchId: 'branch-1' })
    sideChatApi.createSideChat.mockResolvedValue({
      chatMeta: {
        chatId: 'side-child', title: '자식 사이드', kind: 'SIDE', parentChatId: 'side-parent',
        parentBranchId: 'side-branch', parentMessageBlockId: 'block-1', rootChatId: 'chat-1', rootBranchId: 'branch-1',
      },
      branchMeta: { branchId: 'side-child-branch' },
      messageBlocks: [],
      branchList: [],
    })
    sideChatApi.fetchSideChatTree.mockResolvedValue({
      rootChatId: 'chat-1',
      chats: [{ chatId: 'side-child', title: '자식 사이드', kind: 'SIDE', parentChatId: 'side-parent', parentBranchId: 'side-branch', parentMessageBlockId: 'block-1', rootChatId: 'chat-1' }],
    })
    setSidePanelOpener(async () => undefined)

    await sideStore.getState().createSideChatTab('block-1')

    expect(useChatStore.getState().sideChatTree.map((chat) => chat.chatId)).toEqual(['side-child'])
    setSidePanelOpener(null)
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

  it('중첩 사이드 대화에서 만든 분기를 원본 메시지 위치에 붙인다', async () => {
    useChatStore.setState({ chatId: 'side-b', branchId: 'side-b-branch' })
    sideChatApi.fetchSideChatTree.mockResolvedValue({
      rootChatId: 'chat-1',
      chats: [
        { chatId: 'chat-1', title: '메인', kind: 'MAIN', parentChatId: null, parentBranchId: null, parentMessageBlockId: null, rootChatId: null },
        { chatId: 'side-a', title: '사이드 A', kind: 'SIDE', parentChatId: 'chat-1', parentBranchId: 'branch-1', parentMessageBlockId: 'root-block', rootChatId: 'chat-1' },
        { chatId: 'side-b', title: '사이드 B', kind: 'SIDE', parentChatId: 'side-a', parentBranchId: 'side-a-branch', parentMessageBlockId: 'a-block', rootChatId: 'chat-1' },
        {
          chatId: 'branch-4', title: '분기 4', kind: 'SIDE', parentChatId: 'side-a',
          parentBranchId: 'side-b-branch', parentMessageBlockId: 'side-b-block', rootChatId: 'chat-1',
          forkedFromChatId: 'side-b', forkedFromMessageBlockId: 'side-b-block',
        },
      ],
    })

    await useChatStore.getState().loadSideChatContext()

    expect(useChatStore.getState().sideChatsByBlockId['side-b-block'].map((c) => c.chatId)).toEqual(['branch-4'])
  })

  it('늦게 끝난 이전 대화 구조 요청이 현재 분기 목록을 덮지 않는다', async () => {
    const previous = deferred<SideChatTreeResponse>()
    const current = deferred<SideChatTreeResponse>()
    sideChatApi.fetchSideChatTree.mockReturnValueOnce(previous.promise).mockReturnValueOnce(current.promise)

    const previousLoad = useChatStore.getState().loadSideChatContext()
    useChatStore.setState({ branchId: 'branch-2' })
    const currentLoad = useChatStore.getState().loadSideChatContext()
    current.resolve({
      rootChatId: 'chat-1',
      chats: [{ chatId: 'current-side', title: '현재 분기', kind: 'SIDE', parentChatId: 'chat-1', parentBranchId: 'branch-2', parentMessageBlockId: 'current-block', rootChatId: 'chat-1' }],
    })
    await currentLoad
    previous.resolve({
      rootChatId: 'chat-1',
      chats: [{ chatId: 'previous-side', title: '이전 분기', kind: 'SIDE', parentChatId: 'chat-1', parentBranchId: 'branch-1', parentMessageBlockId: 'previous-block', rootChatId: 'chat-1' }],
    })
    await previousLoad

    expect(useChatStore.getState().sideChatsByBlockId['current-block'].map((chat) => chat.chatId)).toEqual(['current-side'])
    expect(useChatStore.getState().sideChatsByBlockId['previous-block']).toBeUndefined()
  })

  it('같은 분기에서도 최신 대화 구조 요청만 반영한다', async () => {
    const previous = deferred<SideChatTreeResponse>()
    const current = deferred<SideChatTreeResponse>()
    sideChatApi.fetchSideChatTree.mockReturnValueOnce(previous.promise).mockReturnValueOnce(current.promise)

    const previousLoad = useChatStore.getState().loadSideChatContext()
    const currentLoad = useChatStore.getState().loadSideChatContext()
    current.resolve({
      rootChatId: 'chat-1',
      chats: [{ chatId: 'new-side', title: '새 목록', kind: 'SIDE', parentChatId: 'chat-1', parentBranchId: 'branch-1', parentMessageBlockId: 'new-block', rootChatId: 'chat-1' }],
    })
    await currentLoad
    previous.resolve({
      rootChatId: 'chat-1',
      chats: [{ chatId: 'old-side', title: '이전 목록', kind: 'SIDE', parentChatId: 'chat-1', parentBranchId: 'branch-1', parentMessageBlockId: 'old-block', rootChatId: 'chat-1' }],
    })
    await previousLoad

    expect(useChatStore.getState().sideChatsByBlockId['new-block'].map((chat) => chat.chatId)).toEqual(['new-side'])
    expect(useChatStore.getState().sideChatsByBlockId['old-block']).toBeUndefined()
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

  it('선택한 블록을 부모 채팅으로 전환하며 Context로 적용한다 ', async () => {
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

  it('선택한 블록을 부모 채팅 메시지로 가져온 뒤 부모 탭으로 전환한다 ', async () => {
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

  it('사이드 채팅과 같은 지점에서 부모 아래 형제 브랜치를 만든다 ', async () => {
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

  it('부모가 없으면(메인 채팅) 반영 액션은 아무 일도 하지 않는다 ', async () => {
    useChatStore.setState({ parentChatId: null, parentBranchId: null, parentMessageBlockId: null })

    expect(await useChatStore.getState().sendSelectedToParentAsContext()).toBe(false)
    expect(await useChatStore.getState().importSelectedToParentAsMessages()).toBe(false)
    expect(await useChatStore.getState().createSiblingBranchFromSideChat('형제', '내용')).toBe(false)
    expect(chatApi.fetchChat).not.toHaveBeenCalled()
    expect(sideChatApi.importBlocksAsMessages).not.toHaveBeenCalled()
    expect(chatApi.createBranch).not.toHaveBeenCalled()
  })
})

// 0820_13: 드래그 범위 Context 선택과 지연 생성 사이드 채팅
describe('chatStore 드래그 범위 Context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sideChatApi.fetchSideChatTree.mockResolvedValue({ rootChatId: null, chats: [] })
    useChatStore.setState({
      chatId: 'chat-1', branchId: 'branch-1', blocks: [], branches: [],
      chatKind: 'MAIN', parentChatId: null, parentBranchId: null, parentMessageBlockId: null,
      draftText: '', draftAttachments: [], contextRangeTags: [],
      editingBlockId: null, editingDraft: '', editingOriginal: '',
      tabs: [{ id: 'chat-1', chatId: 'chat-1', branchId: 'branch-1', title: '대화', kind: 'MAIN', parentChatId: null }],
      activeTabId: 'chat-1',
      sideChatsByBlockId: {}, sideChatTree: [], sideChatTreeRootId: null,
    })
  })

  const rangeTag = {
    messageBlockId: 'block-1',
    messageVersionId: 'v1',
    role: 'assistant' as const,
    snapshotText: '전체 답변 내용입니다',
    selectedText: '답변 내용',
    startOffset: 2,
    endOffset: 6,
  }

  it('사이드 채팅에 질문을 누르면 태그가 붙은 빈 패널만 로컬로 열고, 서버에는 아무 것도 만들지 않는다 ', async () => {
    await useChatStore.getState().openDraftSideChatWithRange(rangeTag)

    expect(sideChatApi.createSideChat).not.toHaveBeenCalled()
    const state = useChatStore.getState()
    expect(state.chatId).toBeNull()
    expect(state.chatKind).toBe('SIDE')
    expect(state.parentChatId).toBe('chat-1')
    const draftTab = state.tabs.find((t) => t.id === state.activeTabId)!
    expect(draftTab.kind).toBe('SIDE')
    expect(draftTab.chatId).toBeNull()
    expect(draftTab.draftSideChatAnchor).toEqual({
      parentChatId: 'chat-1', parentBranchId: 'branch-1', anchorMessageBlockId: 'block-1',
    })
    expect(state.contextRangeTags).toHaveLength(1)
    expect(state.contextRangeTags[0]).toMatchObject({ selectedText: '답변 내용' })
  })

  it('첫 전송 전에 패널을 닫으면 서버 기록 없이 탭만 사라진다 ', async () => {
    await useChatStore.getState().openDraftSideChatWithRange(rangeTag)
    const draftId = useChatStore.getState().activeTabId!

    await useChatStore.getState().closeTab(draftId)

    expect(sideChatApi.createSideChat).not.toHaveBeenCalled()
    expect(chatApi.deleteChat).not.toHaveBeenCalled()
    expect(useChatStore.getState().tabs.some((t) => t.id === draftId)).toBe(false)
  })

  it('빈 사이드 채팅 패널에서 첫 메시지를 보낼 때만 서버에 사이드 채팅을 만들고, 태그를 Context로 함께 보낸다 ', async () => {
    await useChatStore.getState().openDraftSideChatWithRange(rangeTag)

    sideChatApi.createSideChat.mockResolvedValue({
      chatMeta: {
        chatId: 'side-1', title: '새 사이드 채팅', kind: 'SIDE', parentChatId: 'chat-1',
        parentBranchId: 'branch-1', parentMessageBlockId: 'block-1', rootChatId: 'chat-1', rootBranchId: 'branch-1',
      },
      branchMeta: { branchId: 'side-branch-1' },
      messageBlocks: [],
      branchList: [],
    })
    convApi.sendMessage.mockResolvedValue({
      userBlock: { blockId: 'u1', branchId: 'side-branch-1', role: 'user', content: '질문', currentVersionId: null, orderIndex: 0, createdAt: 't', attachments: [], searchSources: [] },
      assistantBlock: { blockId: 'a1', branchId: 'side-branch-1', role: 'assistant', content: '답변', currentVersionId: 'v2', orderIndex: 1, createdAt: 't', attachments: [], searchSources: [] },
      chatTitle: '새 사이드 채팅',
      titleGenerated: false,
    })

    await useChatStore.getState().sendMessage('이 내용 관련해서 더 알려줘')

    expect(sideChatApi.createSideChat).toHaveBeenCalledWith('chat-1', 'branch-1', { anchorMessageBlockId: 'block-1' })
    expect(convApi.sendMessage).toHaveBeenCalledWith(
      'side-1', 'side-branch-1', '이 내용 관련해서 더 알려줘', [],
      expect.anything(),
      [{ blockId: 'block-1', versionId: 'v1', snippetText: '답변 내용', startOffset: 2, endOffset: 6 }],
    )
    const state = useChatStore.getState()
    expect(state.chatId).toBe('side-1')
    expect(state.branchId).toBe('side-branch-1')
    // 한 번 쓴 태그는 다음 요청에 재사용되지 않도록 비운다
    expect(state.contextRangeTags).toEqual([])
  })

  it('태그를 추가·제거할 수 있다', () => {
    useChatStore.getState().addContextRangeTag(rangeTag)
    const id = useChatStore.getState().contextRangeTags[0].id
    expect(useChatStore.getState().contextRangeTags).toHaveLength(1)

    useChatStore.getState().removeContextRangeTag(id)
    expect(useChatStore.getState().contextRangeTags).toEqual([])
  })

  it('이미 열린 채팅에서 태그를 붙여 보내면 Context로 전달되고, 전송 뒤 태그를 비운다 ', async () => {
    useChatStore.getState().addContextRangeTag(rangeTag)
    convApi.sendMessage.mockResolvedValue({
      userBlock: { blockId: 'u1', branchId: 'branch-1', role: 'user', content: '질문', currentVersionId: null, orderIndex: 0, createdAt: 't', attachments: [], searchSources: [] },
      assistantBlock: { blockId: 'a1', branchId: 'branch-1', role: 'assistant', content: '답변', currentVersionId: 'v2', orderIndex: 1, createdAt: 't', attachments: [], searchSources: [] },
      chatTitle: '대화',
      titleGenerated: false,
    })

    await useChatStore.getState().sendMessage('이 부분 더 설명해줘')

    expect(sideChatApi.createSideChat).not.toHaveBeenCalled()
    expect(convApi.sendMessage).toHaveBeenCalledWith(
      'chat-1', 'branch-1', '이 부분 더 설명해줘', [],
      expect.anything(),
      [{ blockId: 'block-1', versionId: 'v1', snippetText: '답변 내용', startOffset: 2, endOffset: 6 }],
    )
    expect(useChatStore.getState().contextRangeTags).toEqual([])
  })

  it('전송된 인용 태그를 누르면 해당 블록과 범위를 하이라이트한다 (0821_10)', () => {
    const item = {
      blockId: 'block-1',
      versionId: 'v1',
      orderIndex: 0,
      content: 'K',
      startOffset: 12,
      endOffset: 13,
    }

    useChatStore.getState().jumpToAppliedContext(item)

    const state = useChatStore.getState()
    expect(state.highlightedBlockId).toBe('block-1')
    expect(state.highlightedRange).toEqual({
      blockId: 'block-1',
      versionId: 'v1',
      startOffset: 12,
      endOffset: 13,
    })
  })

  it('메시지 수정 시작 시 기존 appliedContext를 editingContextTags로 옮겨 담는다 (0821_09)', async () => {
    useChatStore.setState({
      chatId: 'chat-1',
      branchId: 'branch-1',
      blocks: [
        {
          blockId: 'b1',
          branchId: 'branch-1',
          role: 'user',
          content: '수정할 질문',
          currentVersionId: 'v1',
          orderIndex: 0,
          createdAt: 't',
          attachments: [],
          searchSources: [],
          generationStatus: 'complete',
          appliedContext: [
            {
              blockId: 'src-1',
              versionId: 'v-src',
              orderIndex: 0,
              content: '인용한 문구',
              startOffset: 0,
              endOffset: 6,
            },
          ],
        },
      ],
      editingBlockId: null,
      editingContextTags: [],
    })

    await useChatStore.getState().startEdit('b1', '수정할 질문')

    const state = useChatStore.getState()
    expect(state.editingBlockId).toBe('b1')
    expect(state.editingDraft).toBe('수정할 질문')
    expect(state.editingContextTags).toHaveLength(1)
    expect(state.editingContextTags[0]).toMatchObject({
      messageBlockId: 'src-1',
      messageVersionId: 'v-src',
      selectedText: '인용한 문구',
    })
  })

  it('수정 모드 중 드래그 인용 추가/삭제 및 저장이 올바르게 처리된다 (0821_09)', async () => {
    useChatStore.setState({
      chatId: 'chat-1',
      branchId: 'branch-1',
      blocks: [
        {
          blockId: 'b1',
          branchId: 'branch-1',
          role: 'user',
          content: '원래 질문',
          currentVersionId: 'v1',
          orderIndex: 0,
          createdAt: 't',
          attachments: [],
          searchSources: [],
          generationStatus: 'complete',
          appliedContext: [],
        },
      ],
      editingBlockId: 'b1',
      editingDraft: '원래 질문',
      editingContextTags: [],
    })

    // 수정 중에 태그 추가
    useChatStore.getState().addContextRangeTag({
      messageBlockId: 'src-2',
      messageVersionId: 'v-src-2',
      role: 'assistant',
      snapshotText: '새로운 인용문',
      selectedText: '새로운 인용문',
      startOffset: 0,
      endOffset: 7,
    })

    expect(useChatStore.getState().editingContextTags).toHaveLength(1)
    expect(useChatStore.getState().contextRangeTags).toHaveLength(0) // 새 질문 태그와 섞이지 않음

    // 수정본 저장 시 contextRanges 전달 및 블록 갱신 확인
    convApi.editBlock.mockResolvedValue({
      blockId: 'b1',
      branchId: 'branch-1',
      role: 'user',
      content: '수정된 질문',
      currentVersionId: 'v2',
      versionNo: 2,
      orderIndex: 0,
      createdAt: 't',
      attachments: [],
      searchSources: [],
      generationStatus: 'complete',
      appliedContext: [
        {
          blockId: 'src-2',
          versionId: 'v-src-2',
          orderIndex: 0,
          content: '새로운 인용문',
          startOffset: 0,
          endOffset: 7,
        },
      ],
    })
    convApi.fetchVersions.mockResolvedValue([])

    await useChatStore.getState().editBlock('b1', '수정된 질문')

    expect(convApi.editBlock).toHaveBeenCalledWith(
      'chat-1',
      'branch-1',
      'b1',
      '수정된 질문',
      [
        {
          blockId: 'src-2',
          versionId: 'v-src-2',
          snippetText: '새로운 인용문',
          startOffset: 0,
          endOffset: 7,
        },
      ],
    )

    const updated = useChatStore.getState()
    expect(updated.editingBlockId).toBeNull()
    expect(updated.editingContextTags).toEqual([])
    expect(updated.blocks[0].content).toBe('수정된 질문')
    expect(updated.blocks[0].appliedContext).toHaveLength(1)
  })

  it('수정 취소 시 변경된 태그와 수정 상태를 버린다 (0821_09)', () => {
    useChatStore.setState({
      editingBlockId: 'b1',
      editingDraft: '작성 중',
      editingOriginal: '원본',
      editingContextTags: [
        {
          id: 't1',
          messageBlockId: 'src-1',
          messageVersionId: 'v1',
          role: 'assistant',
          snapshotText: '인용',
          selectedText: '인용',
          startOffset: 0,
          endOffset: 2,
        },
      ],
    })

    useChatStore.getState().cancelEdit()

    const state = useChatStore.getState()
    expect(state.editingBlockId).toBeNull()
    expect(state.editingDraft).toBe('')
    expect(state.editingContextTags).toEqual([])
  })
})
