// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

it('Context 편집이 열리면 Context 탭만 선택하고 현재 대화를 누르면 채팅으로 돌아간다', () => {
  const switchTab = vi.fn()
  const onCloseContext = vi.fn()
  useChatStore.setState({
    tabs: [
      { id: 'chat-1', chatId: 'chat-1', branchId: 'branch-1', title: '첫째 대화', kind: 'MAIN', parentChatId: null },
      { id: 'side-1', chatId: 'side-1', branchId: 'branch-2', title: '사이드 대화', kind: 'SIDE', parentChatId: 'chat-1' },
    ],
    activeTabId: 'chat-1',
    switchTab,
    closeTab: vi.fn(),
  })

  render(<ChatTabBar contextOpen onCloseContext={onCloseContext} />)

  expect(screen.getByRole('tab', { name: '첫째 대화' }).getAttribute('aria-selected')).toBe('false')
  expect(screen.getByRole('tab', { name: 'Context 편집' }).getAttribute('aria-selected')).toBe('true')

  fireEvent.click(screen.getByRole('tab', { name: '첫째 대화' }))

  expect(onCloseContext).toHaveBeenCalledOnce()
  expect(switchTab).toHaveBeenCalledWith('chat-1')
})

it('화살표와 Home·End 키로 탭 초점을 옮긴다', () => {
  useChatStore.setState({
    tabs: [
      { id: 'chat-1', chatId: 'chat-1', branchId: 'branch-1', title: '첫째 대화', kind: 'MAIN', parentChatId: null },
      { id: 'side-1', chatId: 'side-1', branchId: 'branch-2', title: '사이드 대화', kind: 'SIDE', parentChatId: 'chat-1' },
    ],
    activeTabId: 'chat-1',
    switchTab: vi.fn(),
    closeTab: vi.fn(),
  })

  render(<ChatTabBar />)

  const first = screen.getByRole('tab', { name: '첫째 대화' })
  const second = screen.getByRole('tab', { name: '사이드 대화' })
  first.focus()
  fireEvent.keyDown(first, { key: 'ArrowRight' })
  expect(document.activeElement).toBe(second)
  expect(first.getAttribute('tabindex')).toBe('-1')
  expect(second.getAttribute('tabindex')).toBe('0')

  fireEvent.keyDown(second, { key: 'Home' })
  expect(document.activeElement).toBe(first)
  expect(first.getAttribute('tabindex')).toBe('0')

  fireEvent.keyDown(first, { key: 'End' })
  expect(document.activeElement).toBe(second)
})

it('패널별 접두사를 탭과 패널 ID에 함께 쓴다', () => {
  useChatStore.setState({
    tabs: [
      { id: 'chat-1', chatId: 'chat-1', branchId: 'branch-1', title: '첫째 대화', kind: 'MAIN', parentChatId: null },
      { id: 'side-1', chatId: 'side-1', branchId: 'branch-2', title: '사이드 대화', kind: 'SIDE', parentChatId: 'chat-1' },
    ],
    activeTabId: 'chat-1',
    switchTab: vi.fn(),
    closeTab: vi.fn(),
  })

  render(<ChatTabBar paneId="main-pane" />)

  const first = screen.getByRole('tab', { name: '첫째 대화' })
  expect(first.getAttribute('id')).toBe('main-pane-chat-tab-chat-1')
  expect(first.getAttribute('aria-controls')).toBe('main-pane-chat-tab-panel-chat-1')
})

it('Context 편집 중 채팅 탭을 닫아도 Context 탭에 초점을 남긴다', async () => {
  const closeTab = vi.fn().mockResolvedValue(undefined)
  useChatStore.setState({
    tabs: [
      { id: 'chat-1', chatId: 'chat-1', branchId: 'branch-1', title: '첫째 대화', kind: 'MAIN', parentChatId: null },
      { id: 'side-1', chatId: 'side-1', branchId: 'branch-2', title: '사이드 대화', kind: 'SIDE', parentChatId: 'chat-1' },
    ],
    activeTabId: 'chat-1',
    switchTab: vi.fn(),
    closeTab,
  })

  render(<ChatTabBar contextOpen />)

  const contextTab = screen.getByRole('tab', { name: 'Context 편집' })
  fireEvent.click(screen.getByRole('button', { name: '첫째 대화 탭 닫기' }))

  await waitFor(() => {
    expect(closeTab).toHaveBeenCalledWith('chat-1')
    expect(document.activeElement).toBe(contextTab)
  })
})
