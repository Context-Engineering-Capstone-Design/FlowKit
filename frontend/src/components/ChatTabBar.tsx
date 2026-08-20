import { Clock3, MessageSquare, Split, X } from 'lucide-react'
import { useChatStore } from '@/store/chatStore'

// 열린 메인·사이드 채팅 탭 목록 — 클릭해 전환, X로 닫기 (0820_08 B1)
export function ChatTabBar() {
  const tabs = useChatStore((s) => s.tabs)
  const activeTabId = useChatStore((s) => s.activeTabId)
  const switchTab = useChatStore((s) => s.switchTab)
  const closeTab = useChatStore((s) => s.closeTab)

  if (tabs.length < 2) return null

  return (
    <div
      role="tablist"
      aria-label="열린 채팅 탭"
      className="flex items-center gap-1 overflow-x-auto border-b border-line px-3 py-1.5"
    >
      {tabs.map((tab) => {
        const active = tab.id === activeTabId
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            className={`group flex shrink-0 items-center gap-1.5 rounded-md py-1 pl-2 pr-1 text-[12px] transition ${
              active ? 'bg-bg-3 text-txt-0' : 'text-txt-2 hover:bg-bg-2 hover:text-txt-1'
            }`}
          >
            <button
              type="button"
              onClick={() => void switchTab(tab.id)}
              className="flex min-w-0 max-w-[160px] items-center gap-1.5"
            >
              {tab.kind === 'SIDE' ? (
                <Split className="h-3 w-3 shrink-0 text-green" />
              ) : (
                <MessageSquare className="h-3 w-3 shrink-0 text-blue" />
              )}
              <span className="truncate">{tab.title}</span>
              {tab.isTemporary && <Clock3 aria-label="Temporary Chat" className="h-3 w-3 shrink-0 text-amber" />}
            </button>
            <button
              type="button"
              onClick={() => void closeTab(tab.id)}
              title="탭 닫기"
              aria-label={`${tab.title} 탭 닫기`}
              className="shrink-0 rounded p-0.5 text-txt-3 opacity-0 transition hover:bg-bg-4 hover:text-txt-0 group-hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
