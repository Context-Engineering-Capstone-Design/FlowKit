/**
 * 렌더링된 마크다운(본문·코드·표·인용문 포함) 트리에서, 문자 오프셋 범위에
 * 해당하는 텍스트를 <mark data-range-ids="..."> 로 감싼다 (0820_13 A5, A6).
 *
 * ReactMarkdown이 만든 hast 트리를 문서 순서대로 훑으며 텍스트 노드마다
 * 누적 오프셋을 매기고, 겹치는 범위 경계에서 텍스트 노드를 쪼갠다. 여러
 * 범위가 같은 구간을 덮으면 하나의 <mark>에 id를 모두 붙인다.
 */

export interface HighlightRange {
  id: string
  start: number
  end: number
}

interface HastNode {
  type: string
  value?: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

export function rehypeHighlightRanges(options: { ranges: HighlightRange[] }) {
  return (tree: HastNode) => {
    if (!options.ranges.length) return
    walk(tree, { offset: 0 }, options.ranges)
  }
}

function walk(node: HastNode, cursor: { offset: number }, ranges: HighlightRange[]): void {
  if (!node.children) return
  const next: HastNode[] = []
  for (const child of node.children) {
    if (child.type === 'text' && typeof child.value === 'string') {
      next.push(...splitTextNode(child.value, cursor, ranges))
    } else {
      walk(child, cursor, ranges)
      next.push(child)
    }
  }
  node.children = next
}

function splitTextNode(value: string, cursor: { offset: number }, ranges: HighlightRange[]): HastNode[] {
  const start = cursor.offset
  const end = start + value.length
  cursor.offset = end

  const applicable = ranges.filter((r) => r.start < end && r.end > start)
  if (applicable.length === 0) return [{ type: 'text', value }]

  const cuts = new Set<number>([0, value.length])
  for (const r of applicable) {
    cuts.add(Math.max(0, r.start - start))
    cuts.add(Math.min(value.length, r.end - start))
  }
  const points = [...cuts].sort((a, b) => a - b)

  const pieces: HastNode[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const segStart = points[i]
    const segEnd = points[i + 1]
    if (segStart === segEnd) continue
    const segAbsStart = start + segStart
    const segAbsEnd = start + segEnd
    const segText = value.slice(segStart, segEnd)
    const coveringIds = applicable
      .filter((r) => r.start <= segAbsStart && r.end >= segAbsEnd)
      .map((r) => r.id)

    if (coveringIds.length === 0) {
      pieces.push({ type: 'text', value: segText })
    } else {
      pieces.push({
        type: 'element',
        tagName: 'mark',
        properties: { className: ['ctx-range-mark'], 'data-range-ids': coveringIds.join(',') },
        children: [{ type: 'text', value: segText }],
      })
    }
  }
  return pieces
}
