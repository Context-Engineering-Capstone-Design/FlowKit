import { Clock3, MessageSquare, SlidersHorizontal, Split, X } from 'lucide-react'
import { useChatPaneStore } from '@/components/ChatPaneContext'

// 열린 메인·사이드 채팅 탭 목록 — 클릭해 전환, X로 닫기 (0820_08 B1)
export function ChatTabBar({ contextOpen = false, onOpenContext = () => {}, onCloseContext = () => {} }: { contextOpen?: boolean; onOpenContext?: () => void; onCloseContext?: () => void }) {
  const tabs = useChatPaneStore((s) => s.tabs)
  const activeTabId = useChatPaneStore((s) => s.activeTabId)
  const switchTab = useChatPaneStore((s) => s.switchTab)
  const closeTab = useChatPaneStore((s) => s.closeTab)

  if (tabs.length + (contextOpen ? 1 : 0) < 2) return null

  return (
    <div
      role="tablist"
      aria-label="열린 채팅 탭"
      className="scrollbar-none flex items-center gap-1 overflow-x-auto border-b border-line px-3 py-1.5"
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
      {contextOpen && (
        <div role="tab" aria-selected className="group flex shrink-0 items-center gap-1.5 rounded-md bg-bg-3 py-1 pl-2 pr-1 text-[12px] text-txt-0">
          <button type="button" onClick={onOpenContext} className="flex items-center gap-1.5"><SlidersHorizontal className="h-3 w-3 text-blue" /><span>Context 편집</span></button>
          <button type="button" onClick={onCloseContext} title="Context 편집 닫기" aria-label="Context 편집 닫기" className="rounded p-0.5 text-txt-3 hover:bg-bg-4 hover:text-txt-0"><X className="h-3 w-3" /></button>
        </div>
      )}
    </div>
  )
}
