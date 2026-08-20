// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BranchModal } from '@/components/BranchModal'
import { useChatStore } from '@/store/chatStore'

const blocks = [
  { blockId: 'block-1', role: 'user' as const, content: '첫 블록', currentVersionId: 'v1', versionNo: 1, orderIndex: 0, createdAt: new Date().toISOString(), attachments: [], searchSources: [] },
  { blockId: 'block-2', role: 'assistant' as const, content: '둘째 블록', currentVersionId: 'v2', versionNo: 1, orderIndex: 1, createdAt: new Date().toISOString(), attachments: [], searchSources: [] },
]

afterEach(cleanup)

beforeEach(() => {
  useChatStore.setState({ blocks, selectedBlockIds: [], isCreatingBranch: false, branchError: null })
})

it('헤더 진입은 마지막 블록, 블록 진입은 지정한 블록을 분기점으로 쓴다', () => {
  const first = render(<BranchModal onClose={() => undefined} />)
  expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('block-2')
  first.unmount()

  render(<BranchModal onClose={() => undefined} initialBaseBlockId="block-1" />)
  expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('block-1')
})

it('수정본 진입은 원본을 저장하지 않고 브랜치 요청에 수정 내용을 전달한다', async () => {
  const createBranch = vi.fn().mockResolvedValue(true)
  useChatStore.setState({ createBranch })
  render(<BranchModal onClose={() => undefined} initialBaseBlockId="block-1" editedBaseContent="브랜치 수정본" />)

  fireEvent.change(screen.getByPlaceholderText('예: 구조적 해저드 중심 설명'), { target: { value: '수정본 분기' } })
  fireEvent.click(screen.getByRole('button', { name: '브랜치 생성' }))

  await vi.waitFor(() => expect(createBranch).toHaveBeenCalledWith('수정본 분기', 'block-1', [], '브랜치 수정본'))
})
