// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ChatTabBar } from '@/components/ChatTabBar'
import { useChatStore } from '@/store/chatStore'

afterEach(cleanup)

it('탭이 하나뿐이면 탭 바를 보여주지 않는다', () => {
  useChatStore.setState({
    tabs: [{ id: 'chat-1', chatId: 'chat-1', branchId: 'branch-1', title: '대화', kind: 'MAIN', parentChatId: null }],
    activeTabId: 'chat-1',
  })

  render(<ChatTabBar />)

  expect(screen.queryByRole('tablist')).toBeNull()
})

it('탭을 누르면 그 탭으로 전환한다', () => {
  const switchTab = vi.fn()
  useChatStore.setState({
    tabs: [
      { id: 'chat-1', chatId: 'chat-1', branchId: 'branch-1', title: '첫째 대화', kind: 'MAIN', parentChatId: null },
      { id: 'side-1', chatId: 'side-1', branchId: 'branch-2', title: '사이드 대화', kind: 'SIDE', parentChatId: 'chat-1' },
    ],
    activeTabId: 'chat-1',
    switchTab,
    closeTab: vi.fn(),
  })

  render(<ChatTabBar />)
  fireEvent.click(screen.getByText('사이드 대화'))

  expect(switchTab).toHaveBeenCalledWith('side-1')
})

it('X를 누르면 탭을 닫는다', () => {
  const closeTab = vi.fn()
  useChatStore.setState({
    tabs: [
      { id: 'chat-1', chatId: 'chat-1', branchId: 'branch-1', title: '첫째 대화', kind: 'MAIN', parentChatId: null },
      { id: 'side-1', chatId: 'side-1', branchId: 'branch-2', title: '사이드 대화', kind: 'SIDE', parentChatId: 'chat-1' },
    ],
    activeTabId: 'chat-1',
    switchTab: vi.fn(),
    closeTab,
  })

  render(<ChatTabBar />)
  fireEvent.click(screen.getByRole('button', { name: '사이드 대화 탭 닫기' }))

  expect(closeTab).toHaveBeenCalledWith('side-1')
})
