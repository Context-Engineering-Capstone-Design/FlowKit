// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MessageBlockItem } from '@/components/MessageBlockItem'
import { useChatStore } from '@/store/chatStore'
import { useNotificationStore } from '@/store/notificationStore'

const block = { blockId: 'block-1', branchId: 'branch-1', role: 'user' as const, content: '복사할 내용', currentVersionId: 'v1', versionNo: 1, orderIndex: 0, createdAt: new Date().toISOString(), attachments: [], searchSources: [] }

afterEach(cleanup)

beforeEach(() => {
  useNotificationStore.getState().clearToast()
  useChatStore.setState({ branchId: 'branch-1', selectedBlockIds: [], appliedBlockIds: [], inlineView: {}, ratings: {}, versionsByBlock: {}, pendingByBlockId: {}, failedJobsByBlockId: {}, editingBlockId: null })
})

it('활성 메시지 본문 복사 성공을 알린다', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  render(<MessageBlockItem block={block} />)

  fireEvent.click(screen.getByTitle('복사'))

  await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('복사할 내용'))
  expect(useNotificationStore.getState().toast?.message).toBe('메시지를 복사했습니다.')
})

it('마크다운 표를 표 태그로 그린다', () => {
  const withTable = { ...block, role: 'assistant' as const, content: '| 종류 | 설명 |\n| --- | --- |\n| A | 하나 |' }
  render(<MessageBlockItem block={withTable} />)

  expect(screen.getByRole('table')).toBeTruthy()
  expect(screen.getByRole('columnheader', { name: '종류' })).toBeTruthy()
  expect(screen.getByRole('cell', { name: '하나' })).toBeTruthy()
})

it('코드 블록에 언어별 강조와 블록 전용 복사 버튼을 붙인다', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  const withCode = { ...block, role: 'assistant' as const, content: '```js\nconst a = 1\n```' }
  const { container } = render(<MessageBlockItem block={withCode} />)

  expect(container.querySelector('code.hljs.language-js')).not.toBeNull()

  const [copyCodeButton] = screen.getAllByRole('button')
  fireEvent.click(copyCodeButton)

  await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('const a = 1'))
})

it('첨부 파일 이름을 보여준다', () => {
  const withAttachment = {
    ...block,
    attachments: [{ attachmentId: 'a1', fileName: 'notes.md', mimeType: 'text/markdown', fileSize: 10, status: 'attached' as const, expiresAt: null }],
  }
  render(<MessageBlockItem block={withAttachment} />)

  expect(screen.getByText('notes.md')).toBeTruthy()
})

it('다른 브랜치에서 이어받은 답변은 재생성 버튼을 숨긴다', () => {
  const inherited = { ...block, role: 'assistant' as const, branchId: 'other-branch' }
  render(<MessageBlockItem block={inherited} />)

  expect(screen.queryByTitle('답변 다시 시도')).toBeNull()
})

it('이 브랜치가 직접 만든 답변은 재생성 버튼을 보여준다', () => {
  const own = { ...block, role: 'assistant' as const }
  render(<MessageBlockItem block={own} />)

  expect(screen.getByTitle('답변 다시 시도')).toBeTruthy()
})

it('웹 검색 근거를 답변 아래에 보여준다', () => {
  const withSources = {
    ...block,
    role: 'assistant' as const,
    searchSources: [{ title: '공식 문서', url: 'https://example.com' }],
  }
  render(<MessageBlockItem block={withSources} />)

  const link = screen.getByRole('link', { name: '공식 문서' })
  expect(link.getAttribute('href')).toBe('https://example.com')
})
