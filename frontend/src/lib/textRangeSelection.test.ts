// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { captureSelection, getFlatText, SELECTABLE_ROOT_ATTR } from './textRangeSelection'

function selectText(startNode: Node, startOffset: number, endNode: Node, endOffset: number) {
  const selection = window.getSelection()!
  selection.removeAllRanges()
  const range = document.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  selection.addRange(range)
  return selection
}

afterEach(() => {
  document.body.innerHTML = ''
  window.getSelection()?.removeAllRanges()
})

describe('getFlatText', () => {
  it('여러 형식을 걸친 요소의 텍스트를 문서 순서대로 이어붙인다', () => {
    document.body.innerHTML = '<div id="root"><p>본문 <code>코드</code> 그리고</p><blockquote>인용</blockquote></div>'
    const root = document.getElementById('root')!
    expect(getFlatText(root)).toBe('본문 코드 그리고인용')
  })
})

describe('captureSelection', () => {
  it('한 메시지 안에서 코드 경계를 걸친 드래그 선택을 읽는다 ', () => {
    document.body.innerHTML = `<div ${SELECTABLE_ROOT_ATTR}="" id="root"><p>안녕 <code>world</code> 끝</p></div>`
    const root = document.getElementById('root')!
    const p = root.querySelector('p')!
    const textNode = p.firstChild! // "안녕 "
    const codeText = p.querySelector('code')!.firstChild! // "world"

    // "안녕 "의 1번째 글자부터 "world"의 3번째 글자까지 → "녕 wor"
    const selection = selectText(textNode, 1, codeText, 3)
    const captured = captureSelection(selection)

    expect(captured?.root).toBe(root)
    expect(captured?.text).toBe('녕 wor')
    expect(captured?.snapshotText).toBe(getFlatText(root))
    expect(captured?.startOffset).toBe(1)
    expect(captured?.endOffset).toBe(6)
  })

  it('빈(드래그하지 않은) 선택은 무시한다', () => {
    document.body.innerHTML = `<div ${SELECTABLE_ROOT_ATTR}="" id="root"><p>텍스트</p></div>`
    const p = document.querySelector('p')!
    const selection = selectText(p.firstChild!, 2, p.firstChild!, 2)
    expect(captureSelection(selection)).toBeNull()
  })

  it('여러 메시지를 가로지르는 드래그는 허용하지 않는다', () => {
    document.body.innerHTML = `
      <div ${SELECTABLE_ROOT_ATTR}="" id="root-1"><p>첫째 메시지</p></div>
      <div ${SELECTABLE_ROOT_ATTR}="" id="root-2"><p>둘째 메시지</p></div>
    `
    const first = document.querySelector('#root-1 p')!.firstChild!
    const second = document.querySelector('#root-2 p')!.firstChild!
    const selection = selectText(first, 0, second, 2)
    expect(captureSelection(selection)).toBeNull()
  })

  it('선택 가능 영역(data-selectable-root) 밖까지 걸치면 허용하지 않는다', () => {
    document.body.innerHTML = `
      <div id="wrapper">
        <div ${SELECTABLE_ROOT_ATTR}="" id="root"><p>본문</p></div>
        <div id="attachment">첨부</div>
      </div>
    `
    const inRoot = document.querySelector('#root p')!.firstChild!
    const outsideRoot = document.querySelector('#attachment')!.firstChild!
    const selection = selectText(inRoot, 0, outsideRoot, 1)
    expect(captureSelection(selection)).toBeNull()
  })

  it('같은 문구가 여러 번 나와도 실제로 드래그한 위치의 오프셋을 정확히 잡는다 (0821_10)', () => {
    document.body.innerHTML = `<div ${SELECTABLE_ROOT_ATTR}="" id="root"><p>첫 번째 K 그리고 두 번째 K와 세 번째 K</p></div>`
    const root = document.getElementById('root')!
    const textNode = root.querySelector('p')!.firstChild! // 텍스트 노드
    const fullText = textNode.textContent!
    const secondKOffset = fullText.indexOf('두 번째 K') + '두 번째 '.length

    // "두 번째 K"의 "K" 하나만 선택
    const selection = selectText(textNode, secondKOffset, textNode, secondKOffset + 1)
    const captured = captureSelection(selection)

    expect(captured?.root).toBe(root)
    expect(captured?.text).toBe('K')
    expect(captured?.startOffset).toBe(secondKOffset)
    expect(captured?.endOffset).toBe(secondKOffset + 1)
  })
})
