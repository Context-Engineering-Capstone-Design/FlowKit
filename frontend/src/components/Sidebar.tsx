import { ChevronDown, Folder, FolderCog, FolderPlus, GitBranch, MessageSquare, PanelLeftClose, Pencil, Search, Split, SquarePen, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ProfileMenu } from '@/components/ProfileMenu'
import { useChatStore } from '@/store/chatStore'
import { useInfiniteChatList } from '@/hooks/useInfiniteChatList'
import { buildSideChatTreeOrder } from '@/lib/sideChatTree'
import { ProjectManager } from '@/components/ProjectManager'
import * as projectApi from '@/api/project'
import type { ProjectSummary } from '@/types/api'

interface Props {
  open?: boolean
  onClose: () => void
}

// 좌측 사이드바 — 새 채팅, 대화 검색, 최근 대화 목록·삭제, 현재 대화의 브랜치 목록
export function Sidebar({ open = true, onClose }: Props) {
  const chats = useChatStore((s) => s.chats)
  const chatId = useChatStore((s) => s.chatId)
  const loadChats = useChatStore((s) => s.loadChats)
  const newChat = useChatStore((s) => s.newChat)
  const openChat = useChatStore((s) => s.openChat)
  const deleteChat = useChatStore((s) => s.deleteChat)
  const deletingChatId = useChatStore((s) => s.deletingChatId)
  const renameChat = useChatStore((s) => s.renameChat)
  const nextCursor = useChatStore((s) => s.nextCursor)
  const isLoadingChats = useChatStore((s) => s.isLoadingChats)
  const isLoadingMoreChats = useChatStore((s) => s.isLoadingMoreChats)
  const loadMoreChats = useChatStore((s) => s.loadMoreChats)
  const chatListError = useChatStore((s) => s.chatListError)

  const [keyword, setKeyword] = useState('')
  const loadMoreRef = useInfiniteChatList(Boolean(nextCursor), isLoadingMoreChats, loadMoreChats)
  const searchKeyword = keyword.trim()

  const [editingChatId, setEditingChatId] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const [projectManagerOpen, setProjectManagerOpen] = useState(false)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [projectListRefreshKey, setProjectListRefreshKey] = useState(0)
  const renameInputRef = useRef<HTMLInputElement>(null)

  function startRename(id: string, title: string) {
    setEditingChatId(id)
    setEditingValue(title)
  }

  async function commitRename(id: string) {
    const value = editingValue
    setEditingChatId(null)
    await renameChat(id, value)
  }

  useEffect(() => {
    // 입력할 때마다 요청하지 않도록 잠시 기다렸다 검색한다
    const timer = setTimeout(() => void loadChats(searchKeyword || undefined), 250)
    return () => clearTimeout(timer)
  }, [loadChats, searchKeyword])

  useEffect(() => {
    if (editingChatId) renameInputRef.current?.select()
  }, [editingChatId])

  return (
    <aside
      id="sidebar"
      aria-hidden={!open}
      inert={!open}
      className={`shrink-0 overflow-hidden bg-bg-1 transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none ${
        open ? 'w-[236px]' : 'w-0'
      }`}
    >
      <div className={`flex h-full w-[236px] flex-col transition-opacity duration-200 motion-reduce:transition-none ${open ? 'opacity-100' : 'opacity-0'}`}>
      <div className="flex items-center justify-between px-2 py-3.5">
        <span className="truncate px-1 text-[15px] font-bold">FlowKit</span>
        <div className="flex items-center">
          <button
            type="button"
            onClick={() => void newChat()}
            title="새 채팅"
            className="rounded-md p-1.5 text-txt-2 transition hover:bg-bg-3 hover:text-txt-0"
          >
            <SquarePen className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => { setSelectedProjectId(null); setProjectManagerOpen(true) }} title="Project 관리" className="rounded-md p-1.5 text-txt-2 transition hover:bg-bg-3 hover:text-txt-0"><FolderCog className="h-4 w-4" /></button>
          <button
            type="button"
            onClick={onClose}
            title="사이드바 닫기"
            aria-label="사이드바 닫기"
            aria-expanded={open}
            aria-controls="sidebar"
            className="rounded-md p-1.5 text-txt-2 transition hover:bg-bg-3 hover:text-txt-0"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="px-2 pb-3">
        <div className="flex items-center gap-2 rounded-lg bg-bg-2 px-2.5 py-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-txt-3" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="채팅 검색"
            className="w-full bg-transparent text-[12.5px] text-txt-0 outline-none placeholder:text-txt-3"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <ProjectListSection
          refreshKey={projectListRefreshKey}
          onNewChat={(projectId) => void newChat(projectId)}
        />
        <SectionLabel>최근 대화</SectionLabel>
        {chatListError && (
          <div className="mb-1 rounded-md bg-red/10 px-2 py-2 text-[11px] text-red">
            <p>{chatListError}</p>
            <button type="button" onClick={() => void loadChats(searchKeyword || undefined)} className="mt-1 underline">다시 시도</button>
          </div>
        )}
        {chats.length === 0 && !isLoadingChats && (
          <p className="px-2 py-1 text-[12px] text-txt-3">{keyword ? '검색 결과가 없습니다' : '대화가 없습니다'}</p>
        )}
        {chats.filter((c) => !c.projectId).map((c) => (
          <div
            key={c.chatId}
            className={`group flex items-center rounded-md ${
              c.chatId === chatId
                ? 'bg-bg-3 text-txt-0'
                : 'text-txt-1 hover:bg-bg-2'
            }`}
          >
            {editingChatId === c.chatId ? (
              <input
                ref={renameInputRef}
                value={editingValue}
                onChange={(e) => setEditingValue(e.target.value)}
                onBlur={() => void commitRename(c.chatId)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); void commitRename(c.chatId) }
                  if (e.key === 'Escape') { e.preventDefault(); setEditingChatId(null) }
                }}
                className="min-w-0 flex-1 rounded-md bg-bg-0 px-2 py-[6px] text-[12.5px] text-txt-0 outline-none ring-1 ring-blue-line"
              />
            ) : (
              <button
                type="button"
                onClick={() => void openChat(c.chatId)}
                className="min-w-0 flex-1 truncate px-2 py-[7px] text-left text-[12.5px] transition"
              >
                <span className="truncate">{c.title}</span>
                {c.chatId !== chatId && c.isGenerating && (
                  <span aria-label="답변 생성 중" className="ml-1 flex shrink-0 gap-0.5">
                    <i className="h-1 w-1 animate-bounce rounded-full bg-txt-2 [animation-delay:-0.2s]" />
                    <i className="h-1 w-1 animate-bounce rounded-full bg-txt-2 [animation-delay:-0.1s]" />
                    <i className="h-1 w-1 animate-bounce rounded-full bg-txt-2" />
                  </span>
                )}
                {c.chatId !== chatId && !c.isGenerating && c.hasUnseenCompletion && (
                  <span aria-label="새 답변" className="ml-1 h-1.5 w-1.5 shrink-0 rounded-full bg-blue" />
                )}
              </button>
            )}
            {editingChatId !== c.chatId && (
              <div className="flex shrink-0 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                <button
                  type="button"
                  title="이름 변경"
                  aria-label={`${c.title} 이름 변경`}
                  onClick={() => startRename(c.chatId, c.title)}
                  className="mr-0.5 rounded-md p-1 text-txt-3 transition hover:bg-bg-3 hover:text-txt-0"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="대화 삭제"
                  aria-label={`${c.title} 삭제`}
                  disabled={deletingChatId === c.chatId}
                  onClick={() => void deleteChat(c.chatId)}
                  className="mr-0.5 rounded-md p-1 text-txt-3 transition hover:bg-bg-3 hover:text-red disabled:opacity-40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        ))}
        {nextCursor && (
          <div ref={loadMoreRef} className="py-2 text-center text-[11px] text-txt-2">
            {isLoadingMoreChats ? '불러오는 중…' : '아래로 내리면 더 불러옵니다'}
          </div>
        )}

        <ConversationStructureSection />
      </div>

      <ProfileMenu />
      {projectManagerOpen && (
        <ProjectManager
          chatId={chatId}
          initialProjectId={selectedProjectId}
          onClose={() => { setProjectManagerOpen(false); setProjectListRefreshKey((key) => key + 1) }}
        />
      )}
      </div>
    </aside>
  )
}

// 좌측 패널에서 Project 이름과 소속 대화 수를 빠르게 확인하는 목록
function ProjectListSection({ refreshKey, onNewChat }: { refreshKey: number; onNewChat: (projectId: string) => void }) {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(false)
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>([])
  const chats = useChatStore((s) => s.chats)
  const openChat = useChatStore((s) => s.openChat)
  const loadChats = useChatStore((s) => s.loadChats)

  useEffect(() => {
    let active = true
    setIsLoading(true)
    setError(false)
    void projectApi.fetchProjects()
      .then((items) => { if (active) setProjects(items) })
      .catch(() => { if (active) setError(true) })
      .finally(() => { if (active) setIsLoading(false) })
    return () => { active = false }
  }, [refreshKey])

  return (
    <>
      <SectionLabel>Projects</SectionLabel>
      {isLoading && <p className="px-2 py-1 text-[12px] text-txt-3">불러오는 중…</p>}
      {error && <p className="px-2 py-1 text-[12px] text-red">Project를 불러오지 못했습니다</p>}
      {!isLoading && !error && projects.length === 0 && <p className="px-2 py-1 text-[12px] text-txt-3">Project가 없습니다</p>}
      {projects.map((project) => {
        const expanded = expandedProjectIds.includes(project.projectId)
        const projectChats = chats.filter((chat) => chat.projectId === project.projectId)
        return <div key={project.projectId}>
          <div className="group flex items-center rounded-md text-txt-1 hover:bg-bg-2">
            <button type="button" onClick={() => setExpandedProjectIds((ids) => expanded ? ids.filter((id) => id !== project.projectId) : [...ids, project.projectId])} className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-[7px] text-left text-[12.5px]">
              <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition ${expanded ? '' : '-rotate-90'}`} />
              <Folder className="h-3.5 w-3.5 shrink-0 text-blue" />
              <span className="min-w-0 flex-1 truncate">{project.name}</span>
              <span className="text-[11px] text-txt-3">{project.chatCount}</span>
            </button>
            <button type="button" title={`${project.name}에 새 대화 만들기`} onClick={() => onNewChat(project.projectId)} className="mr-1 rounded p-1 text-txt-3 opacity-0 hover:bg-bg-3 hover:text-txt-0 group-hover:opacity-100"><FolderPlus className="h-3.5 w-3.5" /></button>
          </div>
          {expanded && <div className="ml-4 border-l border-line pl-1">{projectChats.map((chat) => <ProjectChatRow key={chat.chatId} chat={chat} projects={projects} onOpen={openChat} onMoved={() => void loadChats()} />)}{projectChats.length === 0 && <p className="px-2 py-1 text-[11px] text-txt-3">대화가 없습니다</p>}</div>}
        </div>
      })}
    </>
  )
}

function ProjectChatRow({ chat, projects, onOpen, onMoved }: { chat: { chatId: string; title: string; projectId?: string | null }; projects: ProjectSummary[]; onOpen: (chatId: string) => Promise<void>; onMoved: () => void }) {
  async function move(projectId: string) {
    await projectApi.moveChat(chat.chatId, projectId || null)
    onMoved()
  }
  return <div className="flex items-center gap-1 rounded-md text-txt-2 hover:bg-bg-2"><button type="button" onClick={() => void onOpen(chat.chatId)} className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-[12px]">{chat.title}</button><select aria-label={`${chat.title} Project 이동`} value={chat.projectId ?? ''} onChange={(event) => void move(event.target.value)} className="mr-1 max-w-16 bg-transparent text-[10px] text-txt-3 outline-none"><option value="">밖</option>{projects.map((project) => <option key={project.projectId} value={project.projectId}>{project.name}</option>)}</select></div>
}

// 현재 대화의 브랜치와 루트 메인 아래 사이드 채팅을 한 목록으로 보여준다
function ConversationStructureSection() {
  const branches = useChatStore((s) => s.branches)
  const switchBranch = useChatStore((s) => s.switchBranch)
  const sideChatTree = useChatStore((s) => s.sideChatTree)
  const sideChatTreeRootId = useChatStore((s) => s.sideChatTreeRootId)
  const activeTabId = useChatStore((s) => s.activeTabId)
  const openChat = useChatStore((s) => s.openChat)
  const deleteChat = useChatStore((s) => s.deleteChat)
  const deletingChatId = useChatStore((s) => s.deletingChatId)

  const nodes = buildSideChatTreeOrder(sideChatTree, sideChatTreeRootId)
  if (branches.length === 0 && nodes.length < 2) return null

  return (
    <>
      <SectionLabel>대화 구조</SectionLabel>
      {branches.map((branch) => (
        <button
          key={branch.branchId}
          type="button"
          onClick={() => void switchBranch(branch.branchId)}
          className={`flex w-full items-center gap-2 rounded-md px-2 py-[7px] text-left text-[12.5px] transition ${branch.isActive ? 'bg-bg-3 text-txt-0' : 'text-txt-1 hover:bg-bg-2'}`}
        >
          <GitBranch className={`h-3.5 w-3.5 shrink-0 ${branch.branchType === 'MAIN' ? 'text-blue' : 'text-green'}`} />
          <span className="truncate">{branch.branchName}</span>
        </button>
      ))}
      {branches.length > 0 && nodes.length > 1 && <div className="mx-2 my-1 border-t border-line" />}
      {nodes.map(({ chat, depth }) => (
        <div
          key={chat.chatId}
          className={`group flex items-center rounded-md ${
            chat.chatId === activeTabId ? 'bg-bg-3 text-txt-0' : 'text-txt-1 hover:bg-bg-2'
          }`}
        >
          <button
            type="button"
            onClick={() => void openChat(chat.chatId)}
            style={{ paddingLeft: `${8 + depth * 14}px` }}
            className="flex min-w-0 flex-1 items-center gap-2 py-[7px] pr-1 text-left text-[12.5px] transition"
          >
            {chat.kind === 'MAIN' ? (
              <MessageSquare className="h-3.5 w-3.5 shrink-0 text-blue" />
            ) : (
              <Split className="h-3.5 w-3.5 shrink-0 text-green" />
            )}
            <span className="truncate">{chat.title}</span>
          </button>
          {chat.kind === 'SIDE' && (
            <button
              type="button"
              title="사이드 채팅 삭제"
              aria-label={`${chat.title} 삭제`}
              disabled={deletingChatId === chat.chatId}
              onClick={() => void deleteChat(chat.chatId)}
              className="mr-1 shrink-0 rounded-md p-1 text-txt-3 opacity-0 transition hover:bg-bg-3 hover:text-red disabled:opacity-40 group-hover:opacity-100"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}
    </>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
      {children}
    </p>
  )
}
