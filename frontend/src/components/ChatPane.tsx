import { useEffect, useId, useRef, useState } from 'react'
import { ChatArea } from '@/components/ChatArea'
import { ChatPaneStoreProvider, useChatPaneStore } from '@/components/ChatPaneContext'
import { ChatTabBar } from '@/components/ChatTabBar'
import { ContextPanel } from '@/components/ContextPanel'
import type { useChatStore } from '@/store/chatStore'

// 메인·사이드가 같은 기능을 독립적으로 갖는 하나의 대화 패널
export function ChatPane({ store, sidebarOpen, onOpenSidebar }: { store: typeof useChatStore; sidebarOpen: boolean; onOpenSidebar: () => void }) {
  return <ChatPaneStoreProvider store={store}><ChatPaneBody sidebarOpen={sidebarOpen} onOpenSidebar={onOpenSidebar} /></ChatPaneStoreProvider>
}

function ChatPaneBody({ sidebarOpen, onOpenSidebar }: { sidebarOpen: boolean; onOpenSidebar: () => void }) {
  const contextSignal = useChatPaneStore((s) => s.contextPanelSignal)
  const applyContext = useChatPaneStore((s) => s.applyContext)
  const tabs = useChatPaneStore((s) => s.tabs)
  const activeTabId = useChatPaneStore((s) => s.activeTabId)
  const [contextOpen, setContextOpen] = useState(false)
  const wasContextOpen = useRef(false)
  const paneId = useId()
  const contextTabId = `${paneId}-context-tab`
  const contextPanelId = `${paneId}-context-tab-panel`
  const contextEditorButtonId = `${paneId}-context-editor-button`
  const activeChatTabId = activeTabId ? `${paneId}-chat-tab-${activeTabId}` : null
  const chatTabId = (tabId: string) => `${paneId}-chat-tab-${tabId}`
  const chatPanelId = (tabId: string) => `${paneId}-chat-tab-panel-${tabId}`

  useEffect(() => { if (contextSignal) setContextOpen(true) }, [contextSignal])

  useEffect(() => {
    if (wasContextOpen.current === contextOpen) return
    wasContextOpen.current = contextOpen
    const targetId = contextOpen ? contextTabId : activeChatTabId ?? contextEditorButtonId
    requestAnimationFrame(() => {
      const target = document.getElementById(targetId)
        ?? (!contextOpen ? document.getElementById(contextEditorButtonId) : null)
      target?.focus()
    })
  }, [activeChatTabId, contextEditorButtonId, contextOpen, contextTabId])

  function applyAndReturn() { applyContext(); setContextOpen(false) }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden border-line last:border-l">
      <ChatTabBar contextOpen={contextOpen} onOpenContext={() => setContextOpen(true)} onCloseContext={() => setContextOpen(false)} paneId={paneId} contextTabId={contextTabId} contextPanelId={contextPanelId} />
      {tabs
        .filter((tab) => contextOpen || tab.id !== activeTabId)
        .map((tab) => <div key={tab.id} role="tabpanel" id={chatPanelId(tab.id)} aria-labelledby={chatTabId(tab.id)} hidden />)}
      {contextOpen ? (
        <div role="tabpanel" id={contextPanelId} aria-labelledby={contextTabId} className="flex min-h-0 flex-1">
          <ContextPanel onClose={() => setContextOpen(false)} />
        </div>
      ) : (
        <div
          role="tabpanel"
          id={chatPanelId(activeTabId ?? 'draft')}
          {...(activeTabId ? { 'aria-labelledby': chatTabId(activeTabId) } : { 'aria-label': '새 대화' })}
          className="flex min-h-0 flex-1"
        >
          <ChatArea onOpenContextEditor={() => setContextOpen(true)} contextEditorButtonId={contextEditorButtonId} sidebarOpen={sidebarOpen} onOpenSidebar={onOpenSidebar} />
        </div>
      )}
      {contextOpen && <button type="button" onClick={applyAndReturn} className="absolute bottom-5 right-5 rounded-lg bg-blue px-3 py-2 text-[12px] font-semibold text-white">Context 적용</button>}
    </div>
  )
}
