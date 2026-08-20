// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ChatArea } from '@/components/ChatArea'
import { useChatStore } from '@/store/chatStore'

vi.mock('@/components/SourceContextBanner', () => ({ SourceContextBanner: () => null }))

afterEach(cleanup)

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.scrollTo = vi.fn()
})

function renderChat() {
  const renameChat = vi.fn().mockResolvedValue(true)
  useChatStore.setState({
    chatId: 'chat-1',
    chatTitle: '기존 제목',
    blocks: [],
    branches: [],
    selectedBlockIds: [],
    appliedBlockIds: [],
    draftAttachments: [],
    models: [],
    isSending: false,
    loadInputAssist: vi.fn().mockResolvedValue(undefined),
    renameChat,
    newChat: vi.fn(),
    addFiles: vi.fn(),
    sendMessage: vi.fn(),
  })
  render(
    <ChatArea
      sidebarOpen
      onToggleSidebar={() => undefined}
      panelOpen={false}
      onTogglePanel={() => undefined}
      onCreateBranch={() => undefined}
    />,
  )
  return { renameChat }
}

it('화면 상단 제목을 바꾸면 이름 변경을 요청한다', () => {
  const { renameChat } = renderChat()

  fireEvent.click(screen.getByRole('button', { name: '기존 제목' }))
  const input = screen.getByRole('textbox', { name: '대화 이름 변경' })
  fireEvent.change(input, { target: { value: '새 제목' } })
  fireEvent.keyDown(input, { key: 'Enter' })

  expect(renameChat).toHaveBeenCalledWith('chat-1', '새 제목')
})

it('Esc를 누르면 상단 제목 변경을 취소한다', () => {
  const { renameChat } = renderChat()

  fireEvent.click(screen.getByRole('button', { name: '기존 제목' }))
  fireEvent.keyDown(screen.getByRole('textbox', { name: '대화 이름 변경' }), { key: 'Escape' })

  expect(renameChat).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '기존 제목' })).toBeTruthy()
})

it('새 채팅이 없으면 상단 제목을 보여주지 않는다', () => {
  useChatStore.setState({
    chatId: null,
    chatTitle: '',
    blocks: [],
    branches: [],
    selectedBlockIds: [],
    appliedBlockIds: [],
    draftAttachments: [],
    models: [],
    isSending: false,
    loadInputAssist: vi.fn().mockResolvedValue(undefined),
    newChat: vi.fn(),
    addFiles: vi.fn(),
    sendMessage: vi.fn(),
  })
  render(
    <ChatArea
      sidebarOpen
      onToggleSidebar={() => undefined}
      panelOpen={false}
      onTogglePanel={() => undefined}
      onCreateBranch={() => undefined}
    />,
  )

  expect(screen.queryByText('FlowKit')).toBeNull()
  expect(screen.queryByTitle('이름 변경')).toBeNull()
})
