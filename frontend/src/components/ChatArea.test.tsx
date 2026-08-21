// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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

function renderChat(sidebarOpen = true, onOpenSidebar = () => undefined) {
  const renameChat = vi.fn().mockResolvedValue(true)
  const sendMessage = vi.fn()
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
    sendMessage,
  })
  render(
    <ChatArea
      panelOpen={false}
      onTogglePanel={() => undefined}
      sidebarOpen={sidebarOpen}
      onOpenSidebar={onOpenSidebar}
    />,
  )
  return { renameChat, sendMessage }
}

it('AI 답변이 스트리밍으로 길어지는 동안에는 다시 스크롤하지 않는다', () => {
  useChatStore.setState({
    chatId: 'chat-1', chatTitle: '대화', branches: [], selectedBlockIds: [], appliedBlockIds: [],
    draftAttachments: [], models: [], isSending: false,
    loadInputAssist: () => Promise.resolve(), newChat: () => Promise.resolve(), addFiles: () => Promise.resolve(),
    sendMessage: () => Promise.resolve(),
    blocks: [
      { blockId: 'a1', branchId: 'branch-1', role: 'assistant', content: '답', currentVersionId: 'v1', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'generating' },
    ],
  })
  render(
    <ChatArea panelOpen={false} onTogglePanel={() => undefined} sidebarOpen onOpenSidebar={() => undefined} />,
  )
  const scrollSpy = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>
  scrollSpy.mockClear()

  // 블록 개수는 그대로, 같은 블록의 내용만 길어진다(스트리밍 조각 도착).
  act(() => {
    useChatStore.setState((s) => ({
      blocks: s.blocks.map((b) => (b.blockId === 'a1' ? { ...b, content: '답변이 점점 길어지는 중입니다' } : b)),
    }))
  })

  expect(scrollSpy).not.toHaveBeenCalled()
})

it('새 메시지 블록이 추가되면 맨 아래로 스크롤한다', () => {
  useChatStore.setState({
    chatId: 'chat-1', chatTitle: '대화', branches: [], selectedBlockIds: [], appliedBlockIds: [],
    draftAttachments: [], models: [], isSending: false,
    loadInputAssist: () => Promise.resolve(), newChat: () => Promise.resolve(), addFiles: () => Promise.resolve(),
    sendMessage: () => Promise.resolve(),
    blocks: [
      { blockId: 'u1', branchId: 'branch-1', role: 'user', content: '질문', currentVersionId: 'v1', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' },
    ],
  })
  render(
    <ChatArea panelOpen={false} onTogglePanel={() => undefined} sidebarOpen onOpenSidebar={() => undefined} />,
  )
  const scrollSpy = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>
  scrollSpy.mockClear()

  act(() => {
    useChatStore.setState((s) => ({
      blocks: [...s.blocks, { blockId: 'a1', branchId: 'branch-1', role: 'assistant', content: '', currentVersionId: null, orderIndex: 1, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'generating' }],
    }))
  })

  expect(scrollSpy).toHaveBeenCalled()
})

it('사이드바가 닫혀 있으면 여는 버튼이 보이고, 눌러 열 수 있다 (0821_01 B1)', () => {
  const onOpenSidebar = vi.fn()
  renderChat(false, onOpenSidebar)

  fireEvent.click(screen.getByRole('button', { name: '사이드바 열기' }))

  expect(onOpenSidebar).toHaveBeenCalledOnce()
})

it('사이드바가 열려 있으면 여는 버튼을 보여주지 않는다 (0821_01 B1)', () => {
  renderChat(true)

  expect(screen.queryByRole('button', { name: '사이드바 열기' })).toBeNull()
})

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

// 0821_07: 입력창 안 인라인 Context 태그 칩

it('선택 범위 태그를 입력창 안에 짧은 미리보기 칩으로 보여주고 X로 제거할 수 있다 ', () => {
  const selectedText = '원본 문장의 아주 중요한 일부분입니다'
  useChatStore.setState({
    contextRangeTags: [{
      id: 'tag-1', messageBlockId: 'b1', messageVersionId: 'v1', role: 'assistant',
      snapshotText: `앞부분 ${selectedText} 뒷부분`, selectedText,
      startOffset: 4, endOffset: 4 + selectedText.length,
    }],
  })
  renderChat()

  const editor = screen.getByRole('textbox', { name: '메시지 입력' })
  expect(editor.querySelector('[data-range-tag-id="tag-1"]')).not.toBeNull()
  expect(screen.getByText(`“${selectedText.slice(0, 10)}…”`)).toBeTruthy()

  fireEvent.click(screen.getByLabelText('선택 범위 태그 제거'))
  expect(useChatStore.getState().contextRangeTags).toEqual([])
  expect(editor.querySelector('[data-range-tag-id="tag-1"]')).toBeNull()
})

it('태그에 호버하면 선택 당시 스냅샷 기준으로 고른 범위를 강조해 보여준다 ', () => {
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
  const chip = screen.getByRole('textbox', { name: '메시지 입력' }).querySelector('[data-range-tag-id="tag-1"]')
  fireEvent.mouseEnter(chip!)
  const tooltip = screen.getByRole('tooltip')
  expect(tooltip.querySelector('mark')?.textContent).toBe(selectedText)
  expect(tooltip.textContent).toBe(snapshotText)
})

it('전송 본문에는 칩 미리보기 문구가 들어가지 않는다', () => {
  const selectedText = '원본 문장의 아주 중요한 일부분입니다'
  useChatStore.setState({
    contextRangeTags: [{
      id: 'tag-1', messageBlockId: 'b1', messageVersionId: 'v1', role: 'assistant',
      snapshotText: `앞부분 ${selectedText} 뒷부분`, selectedText,
      startOffset: 4, endOffset: 4 + selectedText.length,
    }],
  })
  const { sendMessage } = renderChat()

  const editor = screen.getByRole('textbox', { name: '메시지 입력' })
  editor.appendChild(document.createTextNode('이 부분 설명해줘'))
  fireEvent.input(editor)
  fireEvent.keyDown(editor, { key: 'Enter' })

  expect(sendMessage).toHaveBeenCalled()
  expect(sendMessage.mock.calls[0][0]).toBe('이 부분 설명해줘')
  expect(sendMessage.mock.calls[0][0]).not.toContain(selectedText.slice(0, 10))
})

it('한글 조합 중 Enter는 전송하지 않는다', () => {
  const { sendMessage } = renderChat()
  const editor = screen.getByRole('textbox', { name: '메시지 입력' })
  editor.appendChild(document.createTextNode('질문'))
  fireEvent.input(editor)
  fireEvent.keyDown(editor, { key: 'Enter', isComposing: true, keyCode: 229 })

  expect(sendMessage).not.toHaveBeenCalled()
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
      panelOpen={false}
      onTogglePanel={() => undefined}
      sidebarOpen
      onOpenSidebar={() => undefined}
    />,
  )

  expect(screen.queryByText('FlowKit')).toBeNull()
  expect(screen.queryByTitle('이름 변경')).toBeNull()
})
