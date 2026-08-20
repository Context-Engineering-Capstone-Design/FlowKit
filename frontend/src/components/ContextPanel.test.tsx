// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ContextPanel } from '@/components/ContextPanel'
import { useChatStore } from '@/store/chatStore'

afterEach(cleanup)

function renderPanel() {
  return render(
    <ContextPanel open onClose={() => undefined} width={320} onResizeStart={() => undefined} />,
  )
}

it('열린 채팅이 없으면 사이드 채팅 섹션을 보여주지 않는다', () => {
  useChatStore.setState({
    chatId: null, blocks: [], selectedBlockIds: [], refineJob: null,
    sideChatTree: [], tabs: [], isCreatingSideChat: false,
  })

  renderPanel()

  expect(screen.queryByText('사이드 채팅')).toBeNull()
})

it('새 사이드 채팅 만들기를 누르면 지금 대화 흐름에서 사이드 채팅을 만든다 (0820_08 B2)', () => {
  const createSideChatTab = vi.fn()
  useChatStore.setState({
    chatId: 'chat-1', blocks: [], selectedBlockIds: [], refineJob: null,
    sideChatTree: [], tabs: [], isCreatingSideChat: false, createSideChatTab,
  })

  renderPanel()
  fireEvent.click(screen.getByText('새 사이드 채팅 만들기'))

  expect(createSideChatTab).toHaveBeenCalledWith()
})

it('사이드 채팅이 아니면(부모가 없으면) 부모 반영 섹션을 보여주지 않는다 (0820_08 C1~C3)', () => {
  useChatStore.setState({
    chatId: 'chat-1', parentChatId: null, blocks: [
      { blockId: 'b1', branchId: 'branch-1', role: 'assistant', content: '답변', currentVersionId: 'v1', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' },
    ],
    selectedBlockIds: ['b1'], refineJob: null, sideChatTree: [], tabs: [], isCreatingSideChat: false,
  })

  renderPanel()

  expect(screen.queryByText('부모 채팅에 반영')).toBeNull()
})

it('사이드 채팅에서 블록을 선택하면 부모 Context로 추가·가져오기 버튼을 보여준다', () => {
  const sendSelectedToParentAsContext = vi.fn()
  const importSelectedToParentAsMessages = vi.fn()
  useChatStore.setState({
    chatId: 'side-1', parentChatId: 'chat-1', blocks: [
      { blockId: 'b1', branchId: 'side-branch-1', role: 'assistant', content: '답변', currentVersionId: 'v1', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' },
    ],
    selectedBlockIds: ['b1'], refineJob: null, sideChatTree: [], tabs: [], isCreatingSideChat: false,
    sendSelectedToParentAsContext, importSelectedToParentAsMessages,
  })

  renderPanel()
  fireEvent.click(screen.getByText('부모 Context로 추가 (1)'))
  fireEvent.click(screen.getByText('부모 메시지로 가져오기'))

  expect(sendSelectedToParentAsContext).toHaveBeenCalledOnce()
  expect(importSelectedToParentAsMessages).toHaveBeenCalledOnce()
})

it('형제 브랜치 만들기 폼에 이름을 입력하고 제출하면 선택한 블록의 내용으로 브랜치를 만든다', () => {
  const createSiblingBranchFromSideChat = vi.fn().mockResolvedValue(true)
  useChatStore.setState({
    chatId: 'side-1', parentChatId: 'chat-1', blocks: [
      { blockId: 'b1', branchId: 'side-branch-1', role: 'assistant', content: '더 나은 답변', currentVersionId: 'v1', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' },
    ],
    selectedBlockIds: ['b1'], refineJob: null, sideChatTree: [], tabs: [], isCreatingSideChat: false,
    isCreatingBranch: false, branchError: null, createSiblingBranchFromSideChat,
  })

  renderPanel()
  fireEvent.click(screen.getByText('부모 아래 형제 브랜치 만들기'))
  fireEvent.change(screen.getByPlaceholderText('형제 브랜치 이름'), { target: { value: '탐색 결과' } })
  fireEvent.click(screen.getByText('만들기'))

  expect(createSiblingBranchFromSideChat).toHaveBeenCalledWith('탐색 결과', '더 나은 답변')
})

it('이 채팅에서 만든 사이드 채팅 목록을 보여주고, 누르면 그 채팅을 연다', () => {
  const openChat = vi.fn()
  useChatStore.setState({
    chatId: 'chat-1', blocks: [], selectedBlockIds: [], refineJob: null,
    sideChatTree: [
      { chatId: 'chat-1', title: '메인', kind: 'MAIN', parentChatId: null, parentBranchId: null, parentMessageBlockId: null, rootChatId: null },
      { chatId: 'side-1', title: '탐색 대화', kind: 'SIDE', parentChatId: 'chat-1', parentBranchId: 'branch-1', parentMessageBlockId: 'block-1', rootChatId: 'chat-1' },
    ],
    tabs: [], isCreatingSideChat: false, openChat,
  })

  renderPanel()
  fireEvent.click(screen.getByText('탐색 대화'))

  expect(openChat).toHaveBeenCalledWith('side-1')
})
