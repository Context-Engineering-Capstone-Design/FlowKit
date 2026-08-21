import { useEffect, useState } from 'react'
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
  const [contextOpen, setContextOpen] = useState(false)

  useEffect(() => { if (contextSignal) setContextOpen(true) }, [contextSignal])

  function applyAndReturn() { applyContext(); setContextOpen(false) }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden border-line last:border-l">
      <ChatTabBar contextOpen={contextOpen} onOpenContext={() => setContextOpen(true)} onCloseContext={() => setContextOpen(false)} />
      {contextOpen ? <ContextPanel onClose={() => setContextOpen(false)} /> : <ChatArea onOpenContextEditor={() => setContextOpen(true)} sidebarOpen={sidebarOpen} onOpenSidebar={onOpenSidebar} />}
      {contextOpen && <button type="button" onClick={applyAndReturn} className="absolute bottom-5 right-5 rounded-lg bg-blue px-3 py-2 text-[12px] font-semibold text-white">Context 적용</button>}
    </div>
  )
}
