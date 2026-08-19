const MIME_BY_EXTENSION: Record<string, string[]> = {
  '.png': ['image/png'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.webp': ['image/webp'],
  '.pdf': ['application/pdf'],
  '.txt': ['text/plain'],
  '.md': ['text/markdown', 'text/plain'],
  '.markdown': ['text/markdown', 'text/plain'],
}

export const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024

/** 서버 업로드 전에 형식·크기를 확인하고, 문제가 없으면 null을 반환한다. */
export function validateAttachment(file: File): string | null {
  if (file.size === 0) return '빈 파일은 첨부할 수 없습니다.'
  if (file.size > MAX_ATTACHMENT_SIZE_BYTES) return '파일 크기는 10 MiB 이하여야 합니다.'

  const extension = '.' + (file.name.split('.').pop()?.toLowerCase() ?? '')
  const allowedMimes = MIME_BY_EXTENSION[extension]
  if (!allowedMimes) return '지원하지 않는 파일 형식입니다.'
  if (file.type && !allowedMimes.includes(file.type)) {
    return '파일 확장자와 형식이 일치하지 않습니다.'
  }
  return null
}
