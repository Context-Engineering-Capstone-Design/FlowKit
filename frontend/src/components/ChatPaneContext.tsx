import { createContext, useContext } from 'react'
import { useChatStore, type ChatState } from '@/store/chatStore'

type ChatStoreHook = typeof useChatStore

const ChatPaneStoreContext = createContext<ChatStoreHook | null>(null)

export function ChatPaneStoreProvider({ store, children }: { store: ChatStoreHook; children: React.ReactNode }) {
  return <ChatPaneStoreContext.Provider value={store}>{children}</ChatPaneStoreContext.Provider>
}

/** 현재 패널의 대화 상태를 읽는다. 패널 밖에서는 기존 메인 상태를 그대로 쓴다. */
export function useChatPaneStore<T>(selector: (state: ChatState) => T): T {
  const store = useContext(ChatPaneStoreContext) ?? useChatStore
  return store(selector)
}
