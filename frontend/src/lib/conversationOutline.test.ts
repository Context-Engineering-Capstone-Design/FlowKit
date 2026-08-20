import { describe, expect, it } from 'vitest'
import { buildConversationOutline } from '@/lib/conversationOutline'
import type { MessageBlock } from '@/types/api'

function makeBlock(overrides: Partial<MessageBlock> & Pick<MessageBlock, 'blockId' | 'role' | 'content'>): MessageBlock {
  return {
    branchId: 'branch-1',
    currentVersionId: null,
    orderIndex: 0,
    createdAt: new Date().toISOString(),
    attachments: [],
    searchSources: [],
    generationStatus: 'complete',
    ...overrides,
  }
}

describe('대화 턴 목차 목록 만들기', () => {
  it('질문과 바로 다음 답변을 한 턴으로 묶는다', () => {
    const blocks = [
      makeBlock({ blockId: 'q1', role: 'user', content: '첫 번째 질문입니다' }),
      makeBlock({ blockId: 'a1', role: 'assistant', content: '첫 번째 답변입니다' }),
    ]

    const turns = buildConversationOutline(blocks)

    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({
      turnId: 'q1',
      questionBlockId: 'q1',
      answerBlockId: 'a1',
    })
    expect(turns[0].questionTitle).toContain('첫 번째 질문입니다')
    expect(turns[0].answerPreview).toContain('첫 번째 답변입니다')
  })

  it('답변이 아직 없는 질문은 질문만 있는 항목으로 만든다', () => {
    const blocks = [makeBlock({ blockId: 'q1', role: 'user', content: '아직 답이 없는 질문' })]

    const turns = buildConversationOutline(blocks)

    expect(turns).toHaveLength(1)
    expect(turns[0].answerBlockId).toBeNull()
    expect(turns[0].answerPreview).toBe('')
  })

  it('빈 질문 블록은 항목을 만들지 않는다', () => {
    const blocks = [
      makeBlock({ blockId: 'q1', role: 'user', content: '   ' }),
      makeBlock({ blockId: 'q2', role: 'user', content: '실제 질문' }),
    ]

    const turns = buildConversationOutline(blocks)

    expect(turns).toHaveLength(1)
    expect(turns[0].questionBlockId).toBe('q2')
  })

  it('스트리밍 중인 답변은 지금까지 받은 본문으로 미리보기를 갱신한다', () => {
    const partial = buildConversationOutline([
      makeBlock({ blockId: 'q1', role: 'user', content: '질문' }),
      makeBlock({ blockId: 'a1', role: 'assistant', content: '아직 짧은 답', generationStatus: 'generating' }),
    ])
    expect(partial[0].answerPreview).toContain('아직 짧은 답')

    const grown = buildConversationOutline([
      makeBlock({ blockId: 'q1', role: 'user', content: '질문' }),
      makeBlock({ blockId: 'a1', role: 'assistant', content: '아직 짧은 답이 점점 길어진다', generationStatus: 'generating' }),
    ])
    expect(grown[0].answerPreview).toContain('아직 짧은 답이 점점 길어진다')
  })

  it('여러 턴에 안정적인 순서를 매긴다', () => {
    const blocks = [
      makeBlock({ blockId: 'q1', role: 'user', content: '질문 1' }),
      makeBlock({ blockId: 'a1', role: 'assistant', content: '답변 1' }),
      makeBlock({ blockId: 'q2', role: 'user', content: '질문 2' }),
      makeBlock({ blockId: 'a2', role: 'assistant', content: '답변 2' }),
    ]

    const turns = buildConversationOutline(blocks)

    expect(turns.map((t) => t.turnId)).toEqual(['q1', 'q2'])
    expect(turns.map((t) => t.order)).toEqual([0, 1])
  })
})
