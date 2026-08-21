/** 한 메시지 안에서 드래그로 고른 텍스트 범위를 읽고 검증한다 (0820_13). */

export const SELECTABLE_ROOT_ATTR = 'data-selectable-root'

/** root 안의 텍스트를 문서 순서대로 이어붙인다. 선택 오프셋을 계산하는 기준 문자열이다. */
export function getFlatText(root: Node): string {
  let text = ''
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    text += node.textContent ?? ''
  }
  return text
}

export interface CapturedSelection {
  root: HTMLElement
  text: string
  /** 선택 당시 메시지 전체의 평면 텍스트 스냅샷. 이후 원문이 바뀌어도 이 값을 그대로 쓴다. */
  snapshotText: string
  startOffset: number
  endOffset: number
}

function closestSelectableRoot(node: Node | null): HTMLElement | null {
  if (!node) return null
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  return el ? (el.closest(`[${SELECTABLE_ROOT_ATTR}]`) as HTMLElement | null) : null
}

/**
 * 지금 브라우저 선택을 읽어 한 메시지 안의 유효한 드래그 범위로 바꾼다.
 * 여러 메시지를 가로지르거나 선택 가능 영역(본문·코드·표·인용문) 밖까지
 * 걸치면 null을 돌려준다 (첨부 미리보기 등은 이 영역 밖에 둔다).
 */
export function captureSelection(selection: Selection | null): CapturedSelection | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
  const text = selection.toString()
  if (!text.trim()) return null

  const anchorRoot = closestSelectableRoot(selection.anchorNode)
  const focusRoot = closestSelectableRoot(selection.focusNode)
  if (!anchorRoot || !focusRoot || anchorRoot !== focusRoot) return null

  const range = selection.getRangeAt(0)
  if (!anchorRoot.contains(range.commonAncestorContainer)) return null

  const flatText = getFlatText(anchorRoot)
  const startOffset = flatText.indexOf(text)
  if (startOffset === -1) return null

  return { root: anchorRoot, text, snapshotText: flatText, startOffset, endOffset: startOffset + text.length }
}

/** 태그 미리보기에 보일 짧은 문구 (0820_13 B1: 앞 5~10자 이하) */
export function toTagPreview(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  return trimmed.length > 10 ? `${trimmed.slice(0, 10)}…` : trimmed
}
