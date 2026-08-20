import { describe, expect, it } from 'vitest'
import { buildSideChatTreeOrder } from '@/lib/sideChatTree'
import type { SideChatSummary } from '@/types/api'

function chat(overrides: Partial<SideChatSummary> & { chatId: string }): SideChatSummary {
  return {
    title: overrides.chatId,
    kind: 'SIDE',
    parentChatId: null,
    parentBranchId: null,
    parentMessageBlockId: null,
    rootChatId: 'root',
    ...overrides,
  }
}

describe('buildSideChatTreeOrder', () => {
  it('루트가 없으면 빈 목록을 돌려준다', () => {
    expect(buildSideChatTreeOrder([], null)).toEqual([])
    expect(buildSideChatTreeOrder([chat({ chatId: 'a' })], 'missing-root')).toEqual([])
  })

  it('부모 아래로 자식을 깊이 우선으로 이어붙인다', () => {
    const chats = [
      chat({ chatId: 'root', kind: 'MAIN', parentChatId: null, rootChatId: null }),
      chat({ chatId: 'child-a', parentChatId: 'root' }),
      chat({ chatId: 'grandchild', parentChatId: 'child-a' }),
      chat({ chatId: 'child-b', parentChatId: 'root' }),
    ]

    const order = buildSideChatTreeOrder(chats, 'root')

    expect(order.map((n) => [n.chat.chatId, n.depth])).toEqual([
      ['root', 0],
      ['child-a', 1],
      ['grandchild', 2],
      ['child-b', 1],
    ])
  })

  it('부모 연결이 끊긴(고아) 사이드 채팅도 맨 아래에 남긴다', () => {
    const chats = [
      chat({ chatId: 'root', kind: 'MAIN', parentChatId: null, rootChatId: null }),
      chat({ chatId: 'orphan', parentChatId: null }),
    ]

    const order = buildSideChatTreeOrder(chats, 'root')

    expect(order.map((n) => n.chat.chatId)).toEqual(['root', 'orphan'])
    expect(order[1].depth).toBe(0)
  })
})
