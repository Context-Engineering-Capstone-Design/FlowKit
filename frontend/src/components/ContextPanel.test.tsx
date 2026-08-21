// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ContextPanel } from '@/components/ContextPanel'
import { useChatStore } from '@/store/chatStore'

afterEach(cleanup)

function renderPanel() {
  return render(
    <ContextPanel open onClose={() => undefined} width={320} onResizeStart={() => undefined} />,
  )
}

it('열린 채팅이 없으면 사이드 채팅 섹션을 보여주지 않는다', () => {
  useChatStore.setState({
    chatId: null, blocks: [], selectedBlockIds: [], refineJob: null,
    sideChatTree: [], tabs: [], isCreatingSideChat: false,
  })

  renderPanel()

  expect(screen.queryByText('사이드 채팅')).toBeNull()
})

it('사이드 채팅이 아니면(부모가 없으면) 부모 반영 섹션을 보여주지 않는다 (0820_08 C1~C3)', () => {
  useChatStore.setState({
    chatId: 'chat-1', parentChatId: null, blocks: [
      { blockId: 'b1', branchId: 'branch-1', role: 'assistant', content: '답변', currentVersionId: 'v1', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete' },
    ],
    selectedBlockIds: ['b1'], refineJob: null, sideChatTree: [], tabs: [], isCreatingSideChat: false,
  })

  renderPanel()

  expect(screen.queryByText('부모 채팅에 반영')).toBeNull()
})

it('정제할 블록 옆 수정 아이콘으로 내용 편집을 시작한다', () => {
  const startEdit = vi.fn()
  useChatStore.setState({
    chatId: 'chat-1',
    branchId: 'branch-1',
    blocks: [
      {
        blockId: 'b1', branchId: 'branch-1', role: 'assistant', content: 'TV 화소 설명',
        currentVersionId: 'v1', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete',
      },
    ],
    refineTargetBlockId: 'b1',
    refineJob: null,
    editingBlockId: null,
    editingDraft: '',
    isSavingEdit: false,
    sideChatTree: [],
    tabs: [],
    isCreatingSideChat: false,
    startEdit,
  })

  renderPanel()
  fireEvent.click(screen.getByRole('button', { name: '정제할 블록 내용 수정' }))

  expect(startEdit).toHaveBeenCalledWith('b1', 'TV 화소 설명')
})

it('Context가 적용된 블록을 편집할 때 인용 범위를 보이고 제거할 수 있다', () => {
  const removeEditingContextTag = vi.fn()
  const selectedText = 'Query와 Key의 역할'
  useChatStore.setState({
    chatId: 'chat-1',
    branchId: 'branch-1',
    blocks: [
      {
        blockId: 'b1', branchId: 'branch-1', role: 'user', content: 'Q와 K를 비교해줘',
        currentVersionId: 'v1', orderIndex: 0, createdAt: 't', attachments: [], searchSources: [], generationStatus: 'complete',
      },
    ],
    refineTargetBlockId: 'b1',
    refineJob: null,
    editingBlockId: 'b1',
    editingDraft: 'Q와 K를 비교해줘',
    isSavingEdit: false,
    editingContextTags: [{
      id: 'tag-1', messageBlockId: 'source-1', messageVersionId: 'source-v1', role: 'assistant',
      snapshotText: `Self-Attention에서 ${selectedText}을 구분한다`, selectedText,
      startOffset: 18, endOffset: 18 + selectedText.length,
    }],
    removeEditingContextTag,
    sideChatTree: [],
    tabs: [],
    isCreatingSideChat: false,
  })

  renderPanel()

  expect(screen.getByText(`“${selectedText.slice(0, 10)}…”`)).toBeTruthy()
  fireEvent.click(screen.getByLabelText('선택 범위 태그 제거'))
  expect(removeEditingContextTag).toHaveBeenCalledWith('tag-1')
})
