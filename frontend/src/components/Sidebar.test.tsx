// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Sidebar } from '@/components/Sidebar'
import { setSidePanelOpener, useChatStore } from '@/store/chatStore'
import * as projectApi from '@/api/project'

vi.mock('@/components/ProfileMenu', () => ({ ProfileMenu: () => null }))
vi.mock('@/components/ProjectManager', () => ({ ProjectManager: ({ initialProjectId }: { initialProjectId?: string | null }) => <div>관리 중: {initialProjectId ?? '새 Project'}</div> }))
vi.mock('@/api/project', () => ({
  fetchProjects: vi.fn(),
  fetchProject: vi.fn(),
  updateProject: vi.fn(),
  moveChat: vi.fn(),
}))

afterEach(cleanup)

it('좌측 패널에 Project 폴더와 소속 대화를 표시한다', async () => {
  vi.mocked(projectApi.fetchProjects).mockResolvedValue([{ projectId: 'project-1', name: '졸업 프로젝트', chatCount: 3 }])
  const openChat = vi.fn()
  useChatStore.setState({
    chats: [{ chatId: 'chat-1', title: '설계 논의', projectId: 'project-1' }], chatId: null, branches: [], nextCursor: null, isLoadingChats: false,
    chatListError: null, deletingChatId: null, loadChats: vi.fn().mockResolvedValue(undefined),
    openChat,
  })

  render(<Sidebar onClose={() => undefined} />)

  const folder = await screen.findByRole('button', { name: '졸업 프로젝트' })
  fireEvent.click(folder)
  fireEvent.click(screen.getByRole('button', { name: '설계 논의' }))

  expect(openChat).toHaveBeenCalledWith('chat-1')
})

it('Project 대화만 검색돼도 폴더를 펼쳐 결과를 보여주고 빈 결과로 표시하지 않는다', async () => {
  vi.mocked(projectApi.fetchProjects).mockResolvedValue([{ projectId: 'project-1', name: 'Transformer 학습', chatCount: 1 }])
  useChatStore.setState({
    chats: [{ chatId: 'chat-1', title: 'FlashAttention 메모리 최적화', projectId: 'project-1' }],
    chatId: null,
    branches: [],
    nextCursor: null,
    isLoadingChats: false,
    chatListError: null,
    deletingChatId: null,
    loadChats: vi.fn().mockResolvedValue(undefined),
  })

  render(<Sidebar onClose={() => undefined} />)

  await screen.findByRole('button', { name: 'Transformer 학습' })
  expect(screen.queryByRole('button', { name: 'FlashAttention 메모리 최적화' })).toBeNull()

  fireEvent.change(screen.getByPlaceholderText('채팅 검색'), { target: { value: 'FlashAttention' } })

  expect(screen.getByRole('button', { name: 'FlashAttention 메모리 최적화' })).not.toBeNull()
  expect(screen.queryByText('검색 결과가 없습니다')).toBeNull()

  fireEvent.change(screen.getByPlaceholderText('채팅 검색'), { target: { value: '' } })
  await waitFor(() => expect(screen.queryByRole('button', { name: 'FlashAttention 메모리 최적화' })).toBeNull())
})

it('Project 이름 변경 아이콘으로 이름을 바로 고친다', async () => {
  vi.mocked(projectApi.fetchProjects).mockResolvedValue([{ projectId: 'project-1', name: '졸업 프로젝트', chatCount: 3 }])
  vi.mocked(projectApi.fetchProject).mockResolvedValue({
    projectId: 'project-1', name: '졸업 프로젝트', chatCount: 3, instructions: '지침', memories: [], libraryResources: [],
  })
  vi.mocked(projectApi.updateProject).mockResolvedValue({
    projectId: 'project-1', name: '캡스톤', chatCount: 3, instructions: '지침', memories: [], libraryResources: [],
  })
  useChatStore.setState({
    chats: [], chatId: null, branches: [], nextCursor: null, isLoadingChats: false,
    chatListError: null, deletingChatId: null, loadChats: vi.fn().mockResolvedValue(undefined),
  })

  render(<Sidebar onClose={() => undefined} />)

  fireEvent.click(await screen.findByRole('button', { name: '졸업 프로젝트 이름 변경' }))
  const input = screen.getByRole('textbox', { name: '졸업 프로젝트 이름 변경' })
  fireEvent.change(input, { target: { value: '캡스톤' } })
  fireEvent.keyDown(input, { key: 'Enter' })

  await waitFor(() => {
    expect(projectApi.updateProject).toHaveBeenCalledWith('project-1', '캡스톤', '지침')
  })
  expect(await screen.findByRole('button', { name: '캡스톤' })).not.toBeNull()
})

it('Project 목록을 불러오지 못하면 오류를 표시한다', async () => {
  vi.mocked(projectApi.fetchProjects).mockRejectedValue(new Error('network'))
  useChatStore.setState({
    chats: [], chatId: null, branches: [], nextCursor: null, isLoadingChats: false,
    chatListError: null, deletingChatId: null, loadChats: vi.fn().mockResolvedValue(undefined),
  })

  render(<Sidebar onClose={() => undefined} />)

  expect(await screen.findByText('Project를 불러오지 못했습니다')).not.toBeNull()
})

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

it('최근 대화는 처음 10개만 보여주고 더보기로 나머지를 펼친다', () => {
  vi.mocked(projectApi.fetchProjects).mockResolvedValue([])
  useChatStore.setState({
    chats: Array.from({ length: 12 }, (_, index) => ({ chatId: `chat-${index}`, title: `대화 ${index}` })),
    chatId: null,
    branches: [],
    nextCursor: null,
    isLoadingChats: false,
    chatListError: null,
    deletingChatId: null,
    loadChats: vi.fn().mockResolvedValue(undefined),
  })

  render(<Sidebar onClose={() => undefined} />)

  expect(screen.getByRole('button', { name: '대화 0' })).not.toBeNull()
  expect(screen.getByRole('button', { name: '대화 9' })).not.toBeNull()
  expect(screen.queryByRole('button', { name: '대화 10' })).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: '더보기' }))

  expect(screen.getByRole('button', { name: '대화 10' })).not.toBeNull()
  expect(screen.getByRole('button', { name: '대화 11' })).not.toBeNull()
  expect(screen.queryByRole('button', { name: '더보기' })).toBeNull()
})

it('표시할 목록을 다 펼친 뒤 더보기를 누르면 다음 페이지를 요청한다', async () => {
  vi.mocked(projectApi.fetchProjects).mockResolvedValue([])
  const loadMoreChats = vi.fn().mockResolvedValue(undefined)
  useChatStore.setState({
    chats: Array.from({ length: 10 }, (_, index) => ({ chatId: `chat-${index}`, title: `대화 ${index}` })),
    chatId: null,
    branches: [],
    nextCursor: 'cursor-1',
    isLoadingChats: false,
    isLoadingMoreChats: false,
    chatListError: null,
    deletingChatId: null,
    loadChats: vi.fn().mockResolvedValue(undefined),
    loadMoreChats,
  })

  render(<Sidebar onClose={() => undefined} />)
  fireEvent.click(screen.getByRole('button', { name: '더보기' }))

  await waitFor(() => {
    expect(loadMoreChats).toHaveBeenCalledOnce()
  })
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

it('고정되지 않은 사이드바에서 포인터가 나가면 미리보기 종료를 알린다', () => {
  vi.mocked(projectApi.fetchProjects).mockResolvedValue([])
  const onPeekLeave = vi.fn()
  useChatStore.setState({
    chats: [], chatId: null, branches: [], nextCursor: null, isLoadingChats: false,
    chatListError: null, deletingChatId: null, loadChats: vi.fn().mockResolvedValue(undefined),
  })

  render(<Sidebar open pinned={false} onClose={() => undefined} onPeekLeave={onPeekLeave} />)
  fireEvent.pointerLeave(document.getElementById('sidebar')!)

  expect(onPeekLeave).toHaveBeenCalledOnce()
})

it('호버로 열린 사이드바에서는 고정 버튼을 보여준다', () => {
  vi.mocked(projectApi.fetchProjects).mockResolvedValue([])
  const onPin = vi.fn()
  useChatStore.setState({
    chats: [], chatId: null, branches: [], nextCursor: null, isLoadingChats: false,
    chatListError: null, deletingChatId: null, loadChats: vi.fn().mockResolvedValue(undefined),
  })

  render(<Sidebar open pinned={false} onClose={() => undefined} onPin={onPin} />)

  expect(screen.queryByRole('button', { name: '사이드바 닫기' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '사이드바 고정' }))
  expect(onPin).toHaveBeenCalledOnce()
})

it('브랜치와 사이드 채팅이 없으면 대화 구조 섹션을 보여주지 않는다', () => {
  useChatStore.setState({
    chats: [], chatId: null, branches: [], nextCursor: null, isLoadingChats: false,
    chatListError: null, deletingChatId: null, loadChats: vi.fn().mockResolvedValue(undefined),
    sideChatTree: [], sideChatTreeRootId: null,
  })

  render(<Sidebar onClose={() => undefined} />)

  expect(screen.queryByText('대화 구조')).toBeNull()
})

it('루트와 자식 사이드 채팅을 트리로 보여주고, 누르면 그 채팅을 연다', () => {
  const openSide = vi.fn()
  setSidePanelOpener(openSide)
  useChatStore.setState({
    chats: [], chatId: 'chat-1', branches: [], nextCursor: null, isLoadingChats: false,
    chatListError: null, deletingChatId: null, loadChats: vi.fn().mockResolvedValue(undefined),
    activeTabId: 'chat-1',
    sideChatTreeRootId: 'chat-1',
    sideChatTree: [
      { chatId: 'chat-1', title: '메인 대화', kind: 'MAIN', parentChatId: null, parentBranchId: null, parentMessageBlockId: null, rootChatId: null },
      { chatId: 'side-1', title: '탐색 대화', kind: 'SIDE', parentChatId: 'chat-1', parentBranchId: 'branch-1', parentMessageBlockId: 'block-1', rootChatId: 'chat-1' },
    ],
  })

  render(<Sidebar onClose={() => undefined} />)

  expect(screen.getByText('대화 구조')).not.toBeNull()
  fireEvent.click(screen.getByText('탐색 대화'))

  expect(openSide).toHaveBeenCalledWith('side-1', undefined)
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

it('대화를 Project 폴더로 끌어다 놓으면 이동한다', async () => {
  vi.mocked(projectApi.fetchProjects).mockResolvedValue([{ projectId: 'project-1', name: '졸업 프로젝트', chatCount: 0 }])
  vi.mocked(projectApi.moveChat).mockResolvedValue(undefined)
  const loadChats = vi.fn().mockResolvedValue(undefined)
  useChatStore.setState({
    chats: [{ chatId: 'chat-1', title: '인사 나누기' }],
    chatId: null,
    branches: [],
    nextCursor: null,
    isLoadingChats: false,
    chatListError: null,
    deletingChatId: null,
    loadChats,
  })

  render(<Sidebar onClose={() => undefined} />)

  const chatRow = screen.getByRole('button', { name: '인사 나누기' }).parentElement
  const projectRow = (await screen.findByRole('button', { name: '졸업 프로젝트' })).parentElement
  expect(chatRow).not.toBeNull()
  expect(projectRow).not.toBeNull()

  const dataTransfer = {
    data: {} as Record<string, string>,
    types: [] as string[],
    effectAllowed: 'none',
    dropEffect: 'none',
    setData(type: string, value: string) {
      this.data[type] = value
      if (!this.types.includes(type)) this.types.push(type)
    },
    getData(type: string) {
      return this.data[type] ?? ''
    },
  }

  fireEvent.dragStart(chatRow!, { dataTransfer })
  fireEvent.dragOver(projectRow!, { dataTransfer })
  fireEvent.drop(projectRow!, { dataTransfer })

  await waitFor(() => {
    expect(projectApi.moveChat).toHaveBeenCalledWith('chat-1', 'project-1')
  })
  expect(loadChats).toHaveBeenCalled()
})

it('Project 안 대화를 최근 대화로 끌어다 놓으면 Project 밖으로 뺀다', async () => {
  vi.mocked(projectApi.fetchProjects).mockResolvedValue([{ projectId: 'project-1', name: '졸업 프로젝트', chatCount: 1 }])
  vi.mocked(projectApi.moveChat).mockResolvedValue(undefined)
  const loadChats = vi.fn().mockResolvedValue(undefined)
  useChatStore.setState({
    chats: [{ chatId: 'chat-1', title: '인사 나누기', projectId: 'project-1' }],
    chatId: null,
    branches: [],
    nextCursor: null,
    isLoadingChats: false,
    chatListError: null,
    deletingChatId: null,
    loadChats,
  })

  render(<Sidebar onClose={() => undefined} />)

  fireEvent.click(await screen.findByRole('button', { name: '졸업 프로젝트' }))
  const chatRow = screen.getByRole('button', { name: '인사 나누기' }).parentElement
  const recentSection = screen.getByText('최근 대화').parentElement
  expect(chatRow).not.toBeNull()
  expect(recentSection).not.toBeNull()

  const dataTransfer = {
    data: {} as Record<string, string>,
    types: [] as string[],
    effectAllowed: 'none',
    dropEffect: 'none',
    setData(type: string, value: string) {
      this.data[type] = value
      if (!this.types.includes(type)) this.types.push(type)
    },
    getData(type: string) {
      return this.data[type] ?? ''
    },
  }

  fireEvent.dragStart(chatRow!, { dataTransfer })
  fireEvent.dragOver(recentSection!, { dataTransfer })
  fireEvent.drop(recentSection!, { dataTransfer })

  await waitFor(() => {
    expect(projectApi.moveChat).toHaveBeenCalledWith('chat-1', null)
  })
})
