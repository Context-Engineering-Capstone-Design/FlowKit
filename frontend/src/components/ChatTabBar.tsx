import { Clock3, MessageSquare, SlidersHorizontal, Split, X } from 'lucide-react'
import { useRef, useState, type KeyboardEvent } from 'react'
import { useChatPaneStore } from '@/components/ChatPaneContext'

// 열린 메인·사이드 채팅 탭 목록 — 클릭해 전환, X로 닫기 (0820_08 B1)
export function ChatTabBar({
  contextOpen = false,
  onOpenContext = () => {},
  onCloseContext = () => {},
  paneId = 'chat-pane',
  contextTabId = 'context-tab',
  contextPanelId = 'context-tab-panel',
}: {
  contextOpen?: boolean
  onOpenContext?: () => void
  onCloseContext?: () => void
  paneId?: string
  contextTabId?: string
  contextPanelId?: string
}) {
  const tabs = useChatPaneStore((s) => s.tabs)
  const activeTabId = useChatPaneStore((s) => s.activeTabId)
  const switchTab = useChatPaneStore((s) => s.switchTab)
  const closeTab = useChatPaneStore((s) => s.closeTab)
  const tabButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const [focusedTabKey, setFocusedTabKey] = useState<string | null>(null)

  const tabKeys = [...tabs.map((tab) => tab.id), ...(contextOpen ? ['context'] : [])]
  const selectedTabKey = contextOpen ? 'context' : activeTabId
  const focusableTabKey = tabKeys.includes(focusedTabKey ?? '')
    ? focusedTabKey
    : selectedTabKey ?? tabKeys[0] ?? null

  function chatTabId(tabId: string) { return `${paneId}-chat-tab-${tabId}` }
  function chatPanelId(tabId: string) { return `${paneId}-chat-tab-panel-${tabId}` }

  function registerTabButton(key: string, element: HTMLButtonElement | null) {
    if (element) tabButtonRefs.current.set(key, element)
    else tabButtonRefs.current.delete(key)
  }

  function moveTabFocus(event: KeyboardEvent<HTMLButtonElement>, key: string) {
    const currentIndex = tabKeys.indexOf(key)
    if (currentIndex === -1) return
    let targetIndex: number | null = null
    if (event.key === 'ArrowRight') targetIndex = (currentIndex + 1) % tabKeys.length
    if (event.key === 'ArrowLeft') targetIndex = (currentIndex - 1 + tabKeys.length) % tabKeys.length
    if (event.key === 'Home') targetIndex = 0
    if (event.key === 'End') targetIndex = tabKeys.length - 1
    if (targetIndex === null) return
    event.preventDefault()
    const targetKey = tabKeys[targetIndex]
    setFocusedTabKey(targetKey)
    tabButtonRefs.current.get(targetKey)?.focus()
  }

  async function selectChatTab(tabId: string) {
    setFocusedTabKey(tabId)
    if (contextOpen) onCloseContext()
    await switchTab(tabId)
    requestAnimationFrame(() => tabButtonRefs.current.get(tabId)?.focus())
  }

  async function closeChatTab(tabId: string) {
    await closeTab(tabId)
    if (!contextOpen) return
    setFocusedTabKey('context')
    requestAnimationFrame(() => tabButtonRefs.current.get('context')?.focus())
  }

  if (tabs.length + (contextOpen ? 1 : 0) < 2) return null

  return (
    <div
      role="tablist"
      aria-label="열린 채팅 탭"
      className="scrollbar-none flex items-center gap-1 overflow-x-auto border-b border-line px-3 py-1.5"
    >
      {tabs.map((tab) => {
        const active = !contextOpen && tab.id === activeTabId
        return (
          <div
            key={tab.id}
            className={`group flex shrink-0 items-center gap-1.5 rounded-md py-1 pl-2 pr-1 text-[12px] transition ${
              active ? 'bg-bg-3 text-txt-0' : 'text-txt-2 hover:bg-bg-2 hover:text-txt-1'
            }`}
          >
            <button
              ref={(element) => registerTabButton(tab.id, element)}
              type="button"
              role="tab"
              id={chatTabId(tab.id)}
              aria-selected={active}
              aria-controls={chatPanelId(tab.id)}
              tabIndex={focusableTabKey === tab.id ? 0 : -1}
              onClick={() => void selectChatTab(tab.id)}
              onFocus={() => setFocusedTabKey(tab.id)}
              onKeyDown={(event) => moveTabFocus(event, tab.id)}
              className="flex min-w-0 max-w-[160px] items-center gap-1.5 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue"
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
              onClick={() => void closeChatTab(tab.id)}
              title="탭 닫기"
              aria-label={`${tab.title} 탭 닫기`}
              className="shrink-0 rounded p-0.5 text-txt-3 opacity-0 transition hover:bg-bg-4 hover:text-txt-0 group-hover:opacity-100 group-focus-within:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )
      })}
      {contextOpen && (
        <div className="group flex shrink-0 items-center gap-1.5 rounded-md bg-bg-3 py-1 pl-2 pr-1 text-[12px] text-txt-0">
          <button
            ref={(element) => registerTabButton('context', element)}
            type="button"
            role="tab"
            id={contextTabId}
            aria-selected
            aria-controls={contextPanelId}
            tabIndex={focusableTabKey === 'context' ? 0 : -1}
            onClick={onOpenContext}
            onFocus={() => setFocusedTabKey('context')}
            onKeyDown={(event) => moveTabFocus(event, 'context')}
            className="flex items-center gap-1.5 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue"
          >
            <SlidersHorizontal className="h-3 w-3 text-blue" />
            <span>Context 편집</span>
          </button>
          <button type="button" onClick={onCloseContext} title="Context 편집 닫기" aria-label="Context 편집 닫기" className="rounded p-0.5 text-txt-3 hover:bg-bg-4 hover:text-txt-0"><X className="h-3 w-3" /></button>
        </div>
      )}
    </div>
  )
}
