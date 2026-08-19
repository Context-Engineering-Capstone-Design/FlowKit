import { GitBranch, Layers, Search, SquarePen } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ProfileMenu } from '@/components/ProfileMenu'
import { useChatStore } from '@/store/chatStore'
import { useInfiniteChatList } from '@/hooks/useInfiniteChatList'

// 좌측 사이드바 — 새 채팅, 대화 검색, 최근 대화 목록, 현재 대화의 브랜치 목록
export function Sidebar() {
  const chats = useChatStore((s) => s.chats)
  const chatId = useChatStore((s) => s.chatId)
  const branches = useChatStore((s) => s.branches)
  const loadChats = useChatStore((s) => s.loadChats)
  const newChat = useChatStore((s) => s.newChat)
  const openChat = useChatStore((s) => s.openChat)
  const switchBranch = useChatStore((s) => s.switchBranch)
  const nextCursor = useChatStore((s) => s.nextCursor)
  const isLoadingChats = useChatStore((s) => s.isLoadingChats)
  const isLoadingMoreChats = useChatStore((s) => s.isLoadingMoreChats)
  const loadMoreChats = useChatStore((s) => s.loadMoreChats)
  const chatListError = useChatStore((s) => s.chatListError)

  const [keyword, setKeyword] = useState('')
  const loadMoreRef = useInfiniteChatList(Boolean(nextCursor), isLoadingMoreChats, loadMoreChats)

  useEffect(() => {
    // 입력할 때마다 요청하지 않도록 잠시 기다렸다 검색한다
    const timer = setTimeout(() => void loadChats(keyword || undefined), 250)
    return () => clearTimeout(timer)
  }, [keyword, loadChats])

  return (
    <aside className="flex w-[236px] shrink-0 flex-col overflow-hidden bg-bg-1">
      <div className="flex items-center justify-between px-4 py-3.5">
        <span className="flex items-center gap-2 text-[15px] font-bold">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-linear-to-br from-blue to-green">
            <Layers className="h-3.5 w-3.5 text-white" strokeWidth={2.2} />
          </span>
          FlowKit
        </span>
        <button
          type="button"
          onClick={() => void newChat()}
          title="새 채팅"
          className="rounded-md p-1.5 text-txt-2 transition hover:bg-bg-3 hover:text-txt-0"
        >
          <SquarePen className="h-4 w-4" />
        </button>
      </div>

      <div className="px-3 pb-3">
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
        <SectionLabel>최근 대화</SectionLabel>
        {chatListError && (
          <div className="mb-1 rounded-md bg-red/10 px-2 py-2 text-[11px] text-red">
            <p>{chatListError}</p>
            <button type="button" onClick={() => void loadChats(keyword || undefined)} className="mt-1 underline">다시 시도</button>
          </div>
        )}
        {chats.length === 0 && !isLoadingChats && (
          <p className="px-2 py-1 text-[12px] text-txt-3">{keyword ? '검색 결과가 없습니다' : '대화가 없습니다'}</p>
        )}
        {chats.map((c) => (
          <button
            key={c.chatId}
            type="button"
            onClick={() => void openChat(c.chatId)}
            className={`block w-full truncate rounded-md px-2 py-[7px] text-left text-[12.5px] transition ${
              c.chatId === chatId
                ? 'bg-bg-3 text-txt-0'
                : 'text-txt-1 hover:bg-bg-2'
            }`}
          >
            {c.title}
          </button>
        ))}
        {nextCursor && (
          <div ref={loadMoreRef} className="py-2 text-center text-[11px] text-txt-2">
            {isLoadingMoreChats ? '불러오는 중…' : '아래로 내리면 더 불러옵니다'}
          </div>
        )}

        {branches.length > 0 && (
          <>
            <SectionLabel>현재 대화 — 브랜치</SectionLabel>
            {branches.map((b) => (
              <button
                key={b.branchId}
                type="button"
                onClick={() => void switchBranch(b.branchId)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-[7px] text-left text-[12.5px] transition ${
                  b.isActive ? 'bg-bg-3 text-txt-0' : 'text-txt-1 hover:bg-bg-2'
                }`}
              >
                <GitBranch
                  className={`h-3.5 w-3.5 shrink-0 ${
                    b.branchType === 'MAIN' ? 'text-blue' : 'text-green'
                  }`}
                />
                <span className="truncate">{b.branchName}</span>
              </button>
            ))}
          </>
        )}
      </div>

      <ProfileMenu />
    </aside>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
      {children}
    </p>
  )
}
