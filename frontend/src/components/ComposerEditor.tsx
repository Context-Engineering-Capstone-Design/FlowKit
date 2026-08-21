import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  RANGE_CHIP_ATTR,
  createRangeChip,
  extractComposerText,
  insertNodeAtCaret,
  insertPlainTextAtCaret,
  isComposerVisuallyEmpty,
  listComposerChipIds,
} from '@/lib/composerEditor'
import { toTagPreview } from '@/lib/textRangeSelection'
import type { ContextRangeTag } from '@/store/chatStore'

interface Props {
  text: string
  tags: ContextRangeTag[]
  focusSignal: number
  autoFocus?: boolean
  placeholder?: string
  onChangeText: (text: string) => void
  onRemoveTag: (id: string) => void
  onSubmit: () => void
  onPasteFiles: (files: File[]) => void
}

export interface ComposerEditorHandle {
  focus: () => void
  resetHeight: () => void
  getText: () => string
}

// 질문 글 사이에 Context 태그 칩을 끼워 넣는 입력 영역
export const ComposerEditor = forwardRef<ComposerEditorHandle, Props>(function ComposerEditor(
  { text, tags, focusSignal, autoFocus = true, placeholder = '무엇이든 물어보세요', onChangeText, onRemoveTag, onSubmit, onPasteFiles },
  ref,
) {
  const editorRef = useRef<HTMLDivElement>(null)
  const tagsRef = useRef(tags)
  const onRemoveTagRef = useRef(onRemoveTag)
  const onChangeTextRef = useRef(onChangeText)
  const [hovered, setHovered] = useState<{ tag: ContextRangeTag; left: number; top: number } | null>(null)

  useEffect(() => {
    tagsRef.current = tags
    onRemoveTagRef.current = onRemoveTag
    onChangeTextRef.current = onChangeText
  })

  function resize() {
    const el = editorRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  function syncEmpty() {
    const el = editorRef.current
    if (!el) return
    el.dataset.empty = isComposerVisuallyEmpty(el) ? 'true' : 'false'
  }

  function readEditor() {
    const el = editorRef.current
    if (!el) return
    onChangeTextRef.current(extractComposerText(el))
    const ids = new Set(listComposerChipIds(el))
    for (const tag of tagsRef.current) {
      if (!ids.has(tag.id)) onRemoveTagRef.current(tag.id)
    }
    syncEmpty()
    resize()
  }

  useImperativeHandle(ref, () => ({
    focus() { editorRef.current?.focus() },
    resetHeight() {
      const el = editorRef.current
      if (el) el.style.height = 'auto'
    },
    getText() {
      return editorRef.current ? extractComposerText(editorRef.current) : ''
    },
  }))

  useEffect(() => {
    if (autoFocus) editorRef.current?.focus()
  }, [autoFocus, focusSignal])

  useEffect(() => {
    const el = editorRef.current
    if (!el || !text || extractComposerText(el) || listComposerChipIds(el).length > 0) return
    el.textContent = text
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    syncEmpty()
    resize()
  }, [text])

  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    const inDom = new Set(listComposerChipIds(el))
    for (const tag of tags) {
      if (inDom.has(tag.id)) continue
      const chip = createRangeChip({
        id: tag.id,
        preview: toTagPreview(tag.selectedText),
        onRemove: () => onRemoveTagRef.current(tag.id),
        onEnter: (chipEl) => {
          const rect = chipEl.getBoundingClientRect()
          const current = tagsRef.current.find((item) => item.id === tag.id)
          if (!current) return
          setHovered({ tag: current, left: rect.left, top: rect.top })
        },
        onLeave: () => setHovered((cur) => (cur?.tag.id === tag.id ? null : cur)),
      })
      insertNodeAtCaret(el, chip)
      el.focus()
    }
    for (const id of inDom) {
      if (tags.some((tag) => tag.id === id)) continue
      for (const node of el.querySelectorAll(`[${RANGE_CHIP_ATTR}]`)) {
        if (node.getAttribute(RANGE_CHIP_ATTR) === id) node.remove()
      }
      setHovered((cur) => (cur?.tag.id === id ? null : cur))
    }
    syncEmpty()
    resize()
  }, [tags])

  useEffect(() => {
    const el = editorRef.current
    if (!el || text !== '' || tags.length > 0) return
    if (!isComposerVisuallyEmpty(el) || listComposerChipIds(el).length > 0) {
      el.innerHTML = ''
    }
    syncEmpty()
    resize()
  }, [text, tags.length])

  return (
    <>
      <div
        ref={editorRef}
        role="textbox"
        aria-multiline="true"
        aria-label="메시지 입력"
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        data-empty="true"
        className="composer-editor w-full"
        onInput={readEditor}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.shiftKey) return
          if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return
          e.preventDefault()
          onSubmit()
        }}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.items)
            .filter((item) => item.kind === 'file')
            .map((item) => item.getAsFile())
            .filter((file): file is File => file !== null)
          if (files.length) {
            e.preventDefault()
            onPasteFiles(files)
            return
          }
          const pasted = e.clipboardData.getData('text/plain')
          if (!pasted) return
          e.preventDefault()
          insertPlainTextAtCaret(pasted)
          readEditor()
        }}
      />
      {hovered && createPortal(
        <div
          className="pointer-events-none fixed z-30"
          style={{ left: hovered.left, top: hovered.top - 8, transform: 'translateY(-100%)' }}
        >
          <ContextRangeTagPreview tag={hovered.tag} />
        </div>,
        document.body,
      )}
    </>
  )
})

// 태그에 호버하면 선택 당시 스냅샷 기준으로 고른 범위를 강조해 보여준다 (0820_13 B2)
function ContextRangeTagPreview({ tag }: { tag: ContextRangeTag }) {
  return (
    <div
      role="tooltip"
      className="max-h-52 w-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-bg-2 p-2.5 text-left text-[11.5px] leading-relaxed text-txt-2 shadow-lg"
    >
      <span>{tag.snapshotText.slice(0, tag.startOffset)}</span>
      <mark className="ctx-range-mark">{tag.snapshotText.slice(tag.startOffset, tag.endOffset)}</mark>
      <span>{tag.snapshotText.slice(tag.endOffset)}</span>
    </div>
  )
}
