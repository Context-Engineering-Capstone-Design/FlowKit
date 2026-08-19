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

  render(<Sidebar />)
  fireEvent.click(screen.getByRole('button', { name: '새 대화 삭제' }))

  expect(deleteChat).toHaveBeenCalledWith('chat-1')
})
