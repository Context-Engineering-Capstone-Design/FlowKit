import { toPreview } from '@/lib/preview'
import type { MessageBlock } from '@/types/api'

export interface ConversationOutlineTurn {
  /** 안정적인 식별자. 질문 블록 ID를 그대로 쓴다. */
  turnId: string
  questionBlockId: string
  questionTitle: string
  answerBlockId: string | null
  answerPreview: string
  order: number
}

const TITLE_MAX_LENGTH = 60
const PREVIEW_MAX_LENGTH = 120

/** 현재 브랜치의 블록 목록에서 사용자 질문 기준의 대화 턴 목록을 만든다.
 *
 * 질문 바로 다음 블록이 AI 답변일 때만 그 답변을 같은 턴으로 묶는다. 답변이
 * 아직 없거나(생성 대기), 내용이 빈 사용자 블록은 항목에서 뺀다.
 */
export function buildConversationOutline(blocks: MessageBlock[]): ConversationOutlineTurn[] {
  const turns: ConversationOutlineTurn[] = []
  blocks.forEach((block, index) => {
    if (block.role !== 'user') return
    const questionTitle = toPreview(block.content).slice(0, TITLE_MAX_LENGTH)
    if (!questionTitle) return

    const nextBlock = blocks[index + 1]
    const answerBlock = nextBlock?.role === 'assistant' ? nextBlock : null

    turns.push({
      turnId: block.blockId,
      questionBlockId: block.blockId,
      questionTitle,
      answerBlockId: answerBlock?.blockId ?? null,
      answerPreview: answerBlock ? toPreview(answerBlock.content).slice(0, PREVIEW_MAX_LENGTH) : '',
      order: turns.length,
    })
  })
  return turns
}
