import type { SideChatSummary } from '@/types/api'

export interface SideChatTreeNode {
  chat: SideChatSummary
  depth: number
}

/**
 * 좌측 트리 패널에 그릴 순서로 평탄화한다 (0820_08 B3). 루트를 맨 위에 두고,
 * 그 아래 자식을 parentChatId 를 따라 깊이 우선으로 이어붙인다.
 *
 * 부모가 삭제돼 parentChatId 연결이 끊긴 사이드 채팅도 트리 맨 아래에 남겨 둔다 —
 * 데이터는 그대로 있으니 화면에서도 사라지면 안 된다.
 */
export function buildSideChatTreeOrder(
  chats: SideChatSummary[],
  rootChatId: string | null,
): SideChatTreeNode[] {
  if (!rootChatId) return []
  const root = chats.find((c) => c.chatId === rootChatId)
  if (!root) return []

  const byParent = new Map<string, SideChatSummary[]>()
  for (const chat of chats) {
    if (chat.chatId === rootChatId || !chat.parentChatId) continue
    const list = byParent.get(chat.parentChatId) ?? []
    list.push(chat)
    byParent.set(chat.parentChatId, list)
  }

  const result: SideChatTreeNode[] = []
  const visited = new Set<string>()

  function visit(chat: SideChatSummary, depth: number) {
    if (visited.has(chat.chatId)) return
    visited.add(chat.chatId)
    result.push({ chat, depth })
    for (const child of byParent.get(chat.chatId) ?? []) visit(child, depth + 1)
  }

  visit(root, 0)
  for (const chat of chats) {
    if (!visited.has(chat.chatId)) visit(chat, 0)
  }
  return result
}
