import { describe, expect, it } from 'vitest'
import { closeUnterminatedMarkdown } from '@/lib/streamingMarkdown'

describe('스트리밍 중 마크다운 임시 닫기', () => {
  it('닫히지 않은 코드 울타리를 임시로 닫는다', () => {
    expect(closeUnterminatedMarkdown('설명\n```js\nconst a = 1')).toBe(
      '설명\n```js\nconst a = 1\n```',
    )
  })

  it('이미 닫힌 코드 울타리는 그대로 둔다', () => {
    const text = '설명\n```js\nconst a = 1\n```\n뒷말'
    expect(closeUnterminatedMarkdown(text)).toBe(text)
  })

  it('코드 울타리가 아예 없으면 그대로 둔다', () => {
    expect(closeUnterminatedMarkdown('그냥 일반 텍스트입니다')).toBe('그냥 일반 텍스트입니다')
  })

  it('코드 울타리가 여러 쌍이어도 짝이 맞으면 그대로 둔다', () => {
    const text = '```a\n1\n```\n중간\n```b\n2\n```'
    expect(closeUnterminatedMarkdown(text)).toBe(text)
  })
})
