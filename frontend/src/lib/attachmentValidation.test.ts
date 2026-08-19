import { describe, expect, it } from 'vitest'
import {
  MAX_ATTACHMENT_SIZE_BYTES,
  validateAttachment,
} from '@/lib/attachmentValidation'

function file(name: string, type: string, size: number) {
  return new File([new Uint8Array(size)], name, { type })
}

describe('첨부 파일 사전 검증', () => {
  it('허용 형식과 10 MiB 이하 파일을 통과시킨다', () => {
    expect(validateAttachment(file('note.md', 'text/markdown', 10))).toBeNull()
    expect(validateAttachment(file('photo.png', 'image/png', MAX_ATTACHMENT_SIZE_BYTES))).toBeNull()
  })

  it('형식과 크기 오류를 업로드 전에 거절한다', () => {
    expect(validateAttachment(file('script.exe', 'application/octet-stream', 10))).toContain('지원하지 않는')
    expect(validateAttachment(file('large.pdf', 'application/pdf', MAX_ATTACHMENT_SIZE_BYTES + 1))).toContain('10 MiB')
    expect(validateAttachment(file('empty.txt', 'text/plain', 0))).toContain('빈 파일')
  })

  it('MIME과 확장자가 다르면 거절한다', () => {
    expect(validateAttachment(file('photo.png', 'image/jpeg', 10))).toContain('일치하지')
  })
})
