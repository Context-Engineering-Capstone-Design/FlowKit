// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MessageBlockItem } from '@/components/MessageBlockItem'
import { useChatStore } from '@/store/chatStore'
import { useNotificationStore } from '@/store/notificationStore'

const block = { blockId: 'block-1', role: 'user' as const, content: '복사할 내용', currentVersionId: 'v1', versionNo: 1, orderIndex: 0, createdAt: new Date().toISOString() }

afterEach(cleanup)

beforeEach(() => {
  useNotificationStore.getState().clearToast()
  useChatStore.setState({ selectedBlockIds: [], appliedBlockIds: [], inlineView: {}, ratings: {}, versionsByBlock: {}, pendingByBlockId: {}, failedJobsByBlockId: {}, editingBlockId: null })
})

it('활성 메시지 본문 복사 성공을 알린다', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  render(<MessageBlockItem block={block} />)

  fireEvent.click(screen.getByTitle('복사'))

  await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('복사할 내용'))
  expect(useNotificationStore.getState().toast?.message).toBe('메시지를 복사했습니다.')
})
