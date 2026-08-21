/** 질문 입력창에서 칩을 제외한 글만 읽고, 커서가 있는 자리에 칩을 넣는다. */

export const RANGE_CHIP_ATTR = 'data-range-tag-id'

export function extractComposerText(root: HTMLElement): string {
  const parts: string[] = []

  function walk(node: Node, isRoot = false) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement
      if (el.getAttribute(RANGE_CHIP_ATTR) != null) return
      if (el.tagName === 'BR') {
        parts.push('\n')
        return
      }
      const block = el.tagName === 'DIV' || el.tagName === 'P'
      if (block && !isRoot && parts.length > 0 && parts[parts.length - 1] !== '\n') {
        parts.push('\n')
      }
      for (const child of el.childNodes) walk(child)
      return
    }
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push((node.textContent ?? '').replace(/\u200B/g, ''))
    }
  }

  walk(root, true)
  return parts.join('')
}

export function listComposerChipIds(root: HTMLElement): string[] {
  return [...root.querySelectorAll(`[${RANGE_CHIP_ATTR}]`)].flatMap((el) => {
    const id = el.getAttribute(RANGE_CHIP_ATTR)
    return id ? [id] : []
  })
}

export function isComposerVisuallyEmpty(root: HTMLElement): boolean {
  return extractComposerText(root).trim() === '' && listComposerChipIds(root).length === 0
}

export function insertNodeAtCaret(editor: HTMLElement, node: Node) {
  const sel = window.getSelection()
  const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null
  const inside = Boolean(range && editor.contains(range.commonAncestorContainer))
  const zwsp = document.createTextNode('\u200B')
  if (inside && range && sel) {
    range.deleteContents()
    range.insertNode(node)
    node.parentNode?.insertBefore(zwsp, node.nextSibling)
    range.setStartAfter(zwsp)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
    return
  }
  editor.appendChild(node)
  editor.appendChild(zwsp)
}

export function insertPlainTextAtCaret(text: string) {
  if (!text) return
  if (document.queryCommandSupported?.('insertText')) {
    document.execCommand('insertText', false, text)
    return
  }
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return
  const range = sel.getRangeAt(0)
  range.deleteContents()
  const node = document.createTextNode(text)
  range.insertNode(node)
  range.setStartAfter(node)
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
}

export function createRangeChip(options: {
  id: string
  preview: string
  onRemove: () => void
  onEnter: (el: HTMLElement) => void
  onLeave: () => void
}): HTMLSpanElement {
  const chip = document.createElement('span')
  chip.contentEditable = 'false'
  chip.setAttribute(RANGE_CHIP_ATTR, options.id)
  chip.className = 'composer-range-chip'
  chip.addEventListener('mouseenter', () => options.onEnter(chip))
  chip.addEventListener('mouseleave', () => options.onLeave())

  const label = document.createElement('span')
  label.textContent = `“${options.preview}”`
  chip.appendChild(label)

  const button = document.createElement('button')
  button.type = 'button'
  button.title = '태그 제거'
  button.setAttribute('aria-label', '선택 범위 태그 제거')
  button.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'
  button.addEventListener('mousedown', (event) => {
    event.preventDefault()
    event.stopPropagation()
  })
  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    options.onRemove()
  })
  chip.appendChild(button)
  return chip
}
