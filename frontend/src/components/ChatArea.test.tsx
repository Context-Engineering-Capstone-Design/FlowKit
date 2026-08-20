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
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
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

// 0820_13: 하단 채팅 패널의 선택 안내와 범위 태그

it('채팅에 추가 버튼을 누르면 선택 안내 배너가 뜨고, 다시 누르면 닫힌다 (A2)', () => {
  renderChat()
  expect(screen.queryByText('메시지에서 원하는 부분을 드래그해 선택하세요.')).toBeNull()

  fireEvent.click(screen.getByTitle('채팅에 추가'))
  expect(screen.getByText('메시지에서 원하는 부분을 드래그해 선택하세요.')).toBeTruthy()

  fireEvent.click(screen.getByTitle('채팅에 추가'))
  expect(screen.queryByText('메시지에서 원하는 부분을 드래그해 선택하세요.')).toBeNull()
})

it('선택 범위 태그를 짧은 미리보기로 보여주고 X로 제거할 수 있다 (B1, D3)', () => {
  const selectedText = '원본 문장의 아주 중요한 일부분입니다'
  useChatStore.setState({
    contextRangeTags: [{
      id: 'tag-1', messageBlockId: 'b1', messageVersionId: 'v1', role: 'assistant',
      snapshotText: `앞부분 ${selectedText} 뒷부분`, selectedText,
      startOffset: 4, endOffset: 4 + selectedText.length,
    }],
  })
  renderChat()

  expect(screen.getByText(`“${selectedText.slice(0, 10)}…”`)).toBeTruthy()

  fireEvent.click(screen.getByLabelText('선택 범위 태그 제거'))
  expect(useChatStore.getState().contextRangeTags).toEqual([])
})

it('태그에 호버하면 선택 당시 스냅샷 기준으로 고른 범위를 강조해 보여준다 (B2, D4)', () => {
  const selectedText = '골라둔 부분'
  const snapshotText = `앞부분 ${selectedText} 뒷부분`
  useChatStore.setState({
    contextRangeTags: [{
      id: 'tag-1', messageBlockId: 'b1', messageVersionId: 'v1', role: 'assistant',
      snapshotText, selectedText,
      startOffset: snapshotText.indexOf(selectedText),
      endOffset: snapshotText.indexOf(selectedText) + selectedText.length,
    }],
  })
  renderChat()

  expect(screen.queryByRole('tooltip')).toBeNull()
  fireEvent.mouseEnter(screen.getByText(`“${selectedText}”`))
  const tooltip = screen.getByRole('tooltip')
  expect(tooltip.querySelector('mark')?.textContent).toBe(selectedText)
  expect(tooltip.textContent).toBe(snapshotText)
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
