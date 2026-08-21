import { describe, expect, it } from 'vitest'
import { rehypeHighlightRanges } from './rehypeHighlightRanges'

interface HastNode {
  type: string
  value?: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

function text(value: string): HastNode {
  return { type: 'text', value }
}

function paragraph(...children: HastNode[]): HastNode {
  return { type: 'root', children: [{ type: 'element', tagName: 'p', children }] }
}

function marks(tree: HastNode): HastNode[] {
  const p = tree.children![0]
  return (p.children ?? []).filter((n) => n.tagName === 'mark')
}

describe('rehypeHighlightRanges', () => {
  it('범위가 없으면 트리를 그대로 둔다', () => {
    const tree = paragraph(text('안녕하세요'))
    rehypeHighlightRanges({ ranges: [] })(tree)
    expect(tree.children![0].children).toEqual([text('안녕하세요')])
  })

  it('한 텍스트 노드 안의 범위를 <mark>로 감싼다', () => {
    const tree = paragraph(text('안녕하세요'))
    rehypeHighlightRanges({ ranges: [{ id: 'r1', start: 1, end: 3 }] })(tree)

    const children = tree.children![0].children!
    expect(children).toEqual([
      text('안'),
      { type: 'element', tagName: 'mark', properties: { className: ['ctx-range-mark'], 'data-range-ids': 'r1' }, children: [text('녕하')] },
      text('세요'),
    ])
  })

  it('여러 요소(본문+코드)에 걸친 범위를 각 텍스트 노드마다 나눠 감싼다 ', () => {
    // "안녕 " + <code>"world"</code> + " 끝" 이고, 오프셋 1~8 ("녕 world")을 고른 경우
    const tree: HastNode = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'p',
          children: [text('안녕 '), { type: 'element', tagName: 'code', children: [text('world')] }, text(' 끝')],
        },
      ],
    }
    rehypeHighlightRanges({ ranges: [{ id: 'r1', start: 1, end: 8 }] })(tree)

    const mark = (value: string): HastNode => ({
      type: 'element', tagName: 'mark',
      properties: { className: ['ctx-range-mark'], 'data-range-ids': 'r1' },
      children: [text(value)],
    })

    const p = tree.children![0]
    const [first, second, codeEl, last] = p.children!
    expect(first).toEqual(text('안')) // 범위 밖은 그대로 둔다
    expect(second).toEqual(mark('녕 '))
    expect(codeEl.children).toEqual([mark('world')])
    expect(last).toEqual(text(' 끝')) // 범위 끝(8) 이후는 코드 블록에서 끝나 그대로 둔다
  })

  it('겹치는 범위는 같은 구간에 두 id를 함께 붙인다', () => {
    const tree = paragraph(text('안녕하세요'))
    rehypeHighlightRanges({
      ranges: [
        { id: 'a', start: 0, end: 3 },
        { id: 'b', start: 2, end: 5 },
      ],
    })(tree)

    const result = marks(tree).map((m) => [m.properties!['data-range-ids'], (m.children![0] as HastNode).value])
    expect(result).toEqual([
      ['a', '안녕'],
      ['a,b', '하'],
      ['b', '세요'],
    ])
  })
})
