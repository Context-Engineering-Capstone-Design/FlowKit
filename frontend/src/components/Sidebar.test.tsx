// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Sidebar } from '@/components/Sidebar'
import { useChatStore } from '@/store/chatStore'

vi.mock('@/components/ProfileMenu', () => ({ ProfileMenu: () => null }))
vi.mock('@/hooks/useInfiniteChatList', () => ({ useInfiniteChatList: () => undefined }))

afterEach(cleanup)

it('최근 대화 항목에서 삭제를 누르면 해당 대화를 지운다', () => {
  const deleteChat = vi.fn()
  useChatStore.setState({
    chats: [{ chatId: 'chat-1', title: '새 대화' }],
    chatId: 'chat-1',
    branches: [],
    nextCursor: null,
    isLoadingChats: false,
    chatListError: null,
    deletingChatId: null,
    deleteChat,
    loadChats: vi.fn().mockResolvedValue(undefined),
  })

  render(<Sidebar onClose={() => undefined} />)
  fireEvent.click(screen.getByRole('button', { name: '새 대화 삭제' }))

  expect(deleteChat).toHaveBeenCalledWith('chat-1')
})

it('사이드바 닫기를 누르면 닫기 동작을 호출한다', () => {
  const onClose = vi.fn()
  useChatStore.setState({
    chats: [],
    chatId: null,
    branches: [],
    nextCursor: null,
    isLoadingChats: false,
    chatListError: null,
    deletingChatId: null,
    loadChats: vi.fn().mockResolvedValue(undefined),
  })

  render(<Sidebar onClose={onClose} />)
  fireEvent.click(screen.getByRole('button', { name: '사이드바 닫기' }))

  expect(onClose).toHaveBeenCalledOnce()
})

it('접힌 사이드바에서는 닫기 버튼을 누르지 못한다', () => {
  useChatStore.setState({
    chats: [],
    chatId: null,
    branches: [],
    nextCursor: null,
    isLoadingChats: false,
    chatListError: null,
    deletingChatId: null,
    loadChats: vi.fn().mockResolvedValue(undefined),
  })

  render(<Sidebar open={false} onClose={() => undefined} />)

  expect(screen.queryByRole('button', { name: '사이드바 닫기' })).toBeNull()
})

it('사이드 채팅이 없으면 트리 섹션을 보여주지 않는다 (0820_08 B3)', () => {
  useChatStore.setState({
    chats: [], chatId: null, branches: [], nextCursor: null, isLoadingChats: false,
    chatListError: null, deletingChatId: null, loadChats: vi.fn().mockResolvedValue(undefined),
    sideChatTree: [], sideChatTreeRootId: null,
  })

  render(<Sidebar onClose={() => undefined} />)

  expect(screen.queryByText('사이드 채팅')).toBeNull()
})

it('루트와 자식 사이드 채팅을 트리로 보여주고, 누르면 그 채팅을 연다', () => {
  const openChat = vi.fn()
  useChatStore.setState({
    chats: [], chatId: 'chat-1', branches: [], nextCursor: null, isLoadingChats: false,
    chatListError: null, deletingChatId: null, loadChats: vi.fn().mockResolvedValue(undefined),
    activeTabId: 'chat-1',
    sideChatTreeRootId: 'chat-1',
    sideChatTree: [
      { chatId: 'chat-1', title: '메인 대화', kind: 'MAIN', parentChatId: null, parentBranchId: null, parentMessageBlockId: null, rootChatId: null },
      { chatId: 'side-1', title: '탐색 대화', kind: 'SIDE', parentChatId: 'chat-1', parentBranchId: 'branch-1', parentMessageBlockId: 'block-1', rootChatId: 'chat-1' },
    ],
    openChat,
  })

  render(<Sidebar onClose={() => undefined} />)

  expect(screen.getByText('사이드 채팅')).not.toBeNull()
  fireEvent.click(screen.getByText('탐색 대화'))

  expect(openChat).toHaveBeenCalledWith('side-1')
})

it('사이드 채팅 트리 노드의 삭제 버튼을 누르면 그 채팅을 삭제한다 (0820_08 A3)', () => {
  const deleteChat = vi.fn()
  useChatStore.setState({
    chats: [], chatId: 'chat-1', branches: [], nextCursor: null, isLoadingChats: false,
    chatListError: null, deletingChatId: null, loadChats: vi.fn().mockResolvedValue(undefined),
    activeTabId: 'chat-1',
    sideChatTreeRootId: 'chat-1',
    sideChatTree: [
      { chatId: 'chat-1', title: '메인 대화', kind: 'MAIN', parentChatId: null, parentBranchId: null, parentMessageBlockId: null, rootChatId: null },
      { chatId: 'side-1', title: '탐색 대화', kind: 'SIDE', parentChatId: 'chat-1', parentBranchId: 'branch-1', parentMessageBlockId: 'block-1', rootChatId: 'chat-1' },
    ],
    deleteChat,
  })

  render(<Sidebar onClose={() => undefined} />)
  fireEvent.click(screen.getByRole('button', { name: '탐색 대화 삭제' }))

  expect(deleteChat).toHaveBeenCalledWith('side-1')
  // 루트 메인 노드에는 삭제 버튼이 없다 — 기존 "최근 대화" 목록에서 관리한다
  expect(screen.queryByRole('button', { name: '메인 대화 삭제' })).toBeNull()
})
