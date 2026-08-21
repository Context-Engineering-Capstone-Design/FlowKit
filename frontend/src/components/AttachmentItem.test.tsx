// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { AttachmentItem } from '@/components/AttachmentItem'
import type { DraftAttachment } from '@/types/api'

afterEach(cleanup)

function makeAttachment(overrides: Partial<DraftAttachment> = {}): DraftAttachment {
  return {
    localId: 'local-1',
    attachmentId: null,
    file: new File(['x'], 'photo.png', { type: 'image/png' }),
    fileName: 'photo.png',
    mimeType: 'image/png',
    localUrl: null,
    status: 'uploading',
    error: null,
    ...overrides,
  }
}

// 클립보드·드래그로 붙인 이미지는 파일 아이콘이 아니라 실제 이미지 미리보기로 보여야 한다
it('이미지 첨부는 로컬 미리보기 주소를 실제 <img>로 보여준다', () => {
  const attachment = makeAttachment({ localUrl: 'blob:local-preview' })
  render(<AttachmentItem attachment={attachment} onRemove={() => undefined} onRetry={() => undefined} />)

  const img = screen.getByRole('img')
  expect(img.getAttribute('src')).toBe('blob:local-preview')
})

it('이미지가 아닌 첨부는 파일 아이콘만 보여준다', () => {
  const attachment = makeAttachment({
    file: new File(['x'], 'doc.pdf', { type: 'application/pdf' }),
    fileName: 'doc.pdf',
    mimeType: 'application/pdf',
    localUrl: null,
  })
  render(<AttachmentItem attachment={attachment} onRemove={() => undefined} onRetry={() => undefined} />)

  expect(screen.queryByRole('img')).toBeNull()
})
