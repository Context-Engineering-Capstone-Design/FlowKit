// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import {
  RANGE_CHIP_ATTR,
  createRangeChip,
  extractComposerText,
  isComposerVisuallyEmpty,
  listComposerChipIds,
} from './composerEditor'

function el(html: string): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = html
  return root
}

describe('extractComposerText', () => {
  it('칩 안의 미리보기 문구는 빼고 질문 글만 이어 붙인다', () => {
    const root = el('앞')
    const chip = document.createElement('span')
    chip.setAttribute(RANGE_CHIP_ATTR, 't1')
    chip.textContent = '“숨겨진 인용”'
    root.append(chip, document.createTextNode('뒤'))

    expect(extractComposerText(root)).toBe('앞뒤')
  })

  it('줄바꿈은 유지한다', () => {
    const root = el('한 줄<div>두 줄</div>')
    expect(extractComposerText(root)).toBe('한 줄\n두 줄')
  })
})

describe('composer chip helpers', () => {
  it('칩 id 목록을 읽고, 칩만 있으면 비어 있지 않다고 본다', () => {
    const root = document.createElement('div')
    const chip = createRangeChip({
      id: 'tag-1',
      preview: '인용',
      onRemove: () => undefined,
      onEnter: () => undefined,
      onLeave: () => undefined,
    })
    root.appendChild(chip)

    expect(listComposerChipIds(root)).toEqual(['tag-1'])
    expect(isComposerVisuallyEmpty(root)).toBe(false)
    expect(extractComposerText(root)).toBe('')
  })

  it('글과 칩이 모두 없으면 비어 있다', () => {
    expect(isComposerVisuallyEmpty(el(''))).toBe(true)
  })
})
