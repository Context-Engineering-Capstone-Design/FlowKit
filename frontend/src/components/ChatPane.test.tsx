// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ChatPane } from '@/components/ChatPane'
import { createChatStore } from '@/store/chatStore'

vi.mock('@/components/ChatArea', () => ({
  ChatArea: ({ contextEditorButtonId, onOpenContextEditor }: { contextEditorButtonId?: string; onOpenContextEditor: () => void }) => (
    <button id={contextEditorButtonId} type="button" onClick={onOpenContextEditor}>Context 편집</button>
  ),
}))

vi.mock('@/components/ContextPanel', () => ({
  ContextPanel: ({ onClose }: { onClose: () => void }) => <button type="button" onClick={onClose}>Context 패널 닫기</button>,
}))

afterEach(cleanup)

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 0
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function createPaneStore() {
  const store = createChatStore()
  store.setState({
    tabs: [
      { id: 'chat-1', chatId: 'chat-1', branchId: 'branch-1', title: '첫째 대화', kind: 'MAIN', parentChatId: null },
      { id: 'chat-2', chatId: 'chat-2', branchId: 'branch-2', title: '둘째 대화', kind: 'MAIN', parentChatId: null },
    ],
    activeTabId: 'chat-1',
  })
  return store
}

function expectTabPanels() {
  for (const tab of screen.getAllByRole('tab')) {
    const panelId = tab.getAttribute('aria-controls')
    const panel = panelId ? document.getElementById(panelId) : null
    expect(panel?.getAttribute('role')).toBe('tabpanel')
    expect(panel?.hidden).toBe(tab.getAttribute('aria-selected') !== 'true')
  }
}

it('선택 여부와 관계없이 모든 탭이 존재하는 패널을 가리킨다', () => {
  render(<ChatPane store={createPaneStore()} sidebarOpen onOpenSidebar={() => undefined} />)

  expectTabPanels()
  fireEvent.click(screen.getByRole('button', { name: 'Context 편집' }))
  expectTabPanels()
})

it('탭이 하나라 탭 바가 없을 때도 현재 대화 이름으로 패널을 라벨한다', () => {
  const store = createChatStore()
  store.setState({
    tabs: [{ id: 'chat-1', chatId: 'chat-1', branchId: 'branch-1', title: 'Self-Attention 학습', kind: 'MAIN', parentChatId: null }],
    activeTabId: 'chat-1',
  })

  render(<ChatPane store={store} sidebarOpen onOpenSidebar={() => undefined} />)

  const panel = screen.getByRole('tabpanel', { name: 'Self-Attention 학습' })
  expect(panel.getAttribute('aria-labelledby')).toBeNull()
  expect(panel.getAttribute('aria-label')).toBe('Self-Attention 학습')
})

it('명시한 패널 ID로 Context 제어 버튼을 안정적으로 식별한다', () => {
  render(<ChatPane store={createPaneStore()} sidebarOpen onOpenSidebar={() => undefined} paneId="main-chat-pane" />)

  expect(screen.getByRole('button', { name: 'Context 편집' }).getAttribute('id')).toBe('main-chat-pane-context-editor-button')
})

it('메인과 사이드 패널이 같은 대화를 열어도 탭 ID가 겹치지 않는다', () => {
  render(
    <>
      <ChatPane store={createPaneStore()} sidebarOpen onOpenSidebar={() => undefined} />
      <ChatPane store={createPaneStore()} sidebarOpen onOpenSidebar={() => undefined} />
    </>,
  )

  const ids = [...document.querySelectorAll('[id]')].map((element) => element.id)
  expect(new Set(ids).size).toBe(ids.length)
})
