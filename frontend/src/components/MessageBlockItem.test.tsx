// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MessageBlockItem } from '@/components/MessageBlockItem'
import { useChatStore } from '@/store/chatStore'
import { useNotificationStore } from '@/store/notificationStore'

const block = { blockId: 'block-1', branchId: 'branch-1', role: 'user' as const, content: '복사할 내용', currentVersionId: 'v1', versionNo: 1, orderIndex: 0, createdAt: new Date().toISOString(), attachments: [], searchSources: [], generationStatus: 'complete' as const }

afterEach(cleanup)

beforeEach(() => {
  useNotificationStore.getState().clearToast()
  useChatStore.setState({ branchId: 'branch-1', selectedBlockIds: [], appliedBlockIds: [], inlineView: {}, ratings: {}, versionsByBlock: {}, pendingByBlockId: {}, failedJobsByBlockId: {}, editingBlockId: null, sideChatsByBlockId: {} })
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

it('표 칸 안의 <br> 을 줄바꿈 태그로 바꾼다', () => {
  const withBr = { ...block, role: 'assistant' as const, content: '| 이름 | 설명 |\n| --- | --- |\n| A<br>B | 둘째 줄 |' }
  const { container } = render(<MessageBlockItem block={withBr} />)

  expect(container.querySelector('td br')).not.toBeNull()
  expect(container.textContent).not.toContain('<br>')
})

it('스크립트가 섞인 응답에서도 실행 가능한 핸들러를 남기지 않는다', () => {
  const withScript = { ...block, role: 'assistant' as const, content: '설명<script>window.__hacked = true</script>' }
  const { container } = render(<MessageBlockItem block={withScript} />)

  expect(container.querySelector('script')).toBeNull()
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

it('이미지 첨부는 미리보기로 보여준다', () => {
  const withImage = {
    ...block,
    attachments: [{
      attachmentId: 'img-1',
      fileName: 'screen.png',
      mimeType: 'image/png',
      fileSize: 20,
      status: 'attached' as const,
      expiresAt: null,
      previewUrl: 'blob:image-preview',
    }],
  }
  render(<MessageBlockItem block={withImage} />)

  const image = screen.getByRole('img', { name: 'screen.png' })
  expect(image.getAttribute('src')).toBe('blob:image-preview')
  expect(screen.queryByText('screen.png')).toBeNull()
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

it('생성 중인 답변은 체크박스·Context·분기 버튼을 숨긴다 (D밀스톤)', () => {
  const generating = { ...block, role: 'assistant' as const, content: '', generationStatus: 'generating' as const }
  render(<MessageBlockItem block={generating} />)

  expect(screen.queryByLabelText('Context로 선택')).toBeNull()
  expect(screen.queryByTitle('Context 편집 시작')).toBeNull()
  expect(screen.queryByTitle('여기서 브랜치 생성')).toBeNull()
  expect(screen.getByText('생각하는 중…')).toBeTruthy()
})

it('아직 글자가 없는 생성 중 답변은 "생각하는 중"을 보여준다', () => {
  const thinking = { ...block, role: 'assistant' as const, content: '', generationStatus: 'generating' as const }
  render(<MessageBlockItem block={thinking} />)
  expect(screen.getByText('생각하는 중…')).toBeTruthy()
})

it('중단된 답변에는 중단됨 배지를 붙인다', () => {
  const cancelled = { ...block, role: 'assistant' as const, content: '여기까지만', generationStatus: 'cancelled' as const }
  render(<MessageBlockItem block={cancelled} />)
  expect(screen.getByText('중단됨')).toBeTruthy()
  expect(screen.getByText('여기까지만')).toBeTruthy()
  expect(screen.queryByLabelText('Context로 선택')).toBeNull()
})

it('실패한 답변에는 생성 실패 배지를 붙인다', () => {
  const failed = { ...block, role: 'assistant' as const, content: '', generationStatus: 'failed' as const }
  render(<MessageBlockItem block={failed} />)
  expect(screen.getByText('생성 실패')).toBeTruthy()
})

it('닫히지 않은 코드 울타리는 스트리밍 중에만 임시로 닫아 그린다', () => {
  const streaming = { ...block, role: 'assistant' as const, content: '```js\nconst a = 1', generationStatus: 'generating' as const }
  const { container } = render(<MessageBlockItem block={streaming} />)
  expect(container.querySelector('pre code')).not.toBeNull()
})

it('여기서 사이드 채팅 만들기 버튼을 누르면 이 블록을 지점으로 사이드 채팅을 만든다 (0820_08 B4)', () => {
  const createSideChatTab = vi.fn()
  useChatStore.setState({ createSideChatTab })
  render(<MessageBlockItem block={block} />)

  fireEvent.click(screen.getByTitle('여기서 사이드 채팅 만들기'))

  expect(createSideChatTab).toHaveBeenCalledWith('block-1')
})

it('이 지점에서 만든 사이드 채팅이 있으면 칩으로 보여주고, 누르면 그 채팅을 연다', () => {
  const openChat = vi.fn()
  useChatStore.setState({
    openChat,
    sideChatsByBlockId: {
      'block-1': [{ chatId: 'side-1', title: '탐색 대화', kind: 'SIDE', parentChatId: 'chat-1', parentBranchId: 'branch-1', parentMessageBlockId: 'block-1', rootChatId: 'chat-1' }],
    },
  })
  render(<MessageBlockItem block={block} />)

  const chip = screen.getByTitle('사이드 채팅 열기')
  expect(chip.textContent).toContain('탐색 대화')
  fireEvent.click(chip)

  expect(openChat).toHaveBeenCalledWith('side-1')
})

it('사용자 메시지는 오른쪽에, AI 답변은 왼쪽에 둔다', () => {
  const { container: userEl } = render(<MessageBlockItem block={block} />)
  expect(userEl.querySelector('.items-end')).not.toBeNull()
  cleanup()

  const assistant = { ...block, role: 'assistant' as const, content: '답변' }
  const { container: aiEl } = render(<MessageBlockItem block={assistant} />)
  expect(aiEl.querySelector('.items-start')).not.toBeNull()
  expect(aiEl.querySelector('.rounded-2xl')).toBeNull()
})
