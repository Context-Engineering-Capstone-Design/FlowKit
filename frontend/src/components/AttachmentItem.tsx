import { FileText, Image, LoaderCircle, RotateCw, X } from 'lucide-react'
import type { DraftAttachment } from '@/types/api'

interface Props { attachment: DraftAttachment; onRemove: () => void; onRetry: () => void }

// 입력창에 올린 파일의 업로드 상태와 제거 동작
export function AttachmentItem({ attachment, onRemove, onRetry }: Props) {
  const isImage = attachment.mimeType?.startsWith('image/')
  return (
    <div className="flex max-w-52 items-center gap-2 rounded-lg border border-line bg-bg-3 px-2 py-1.5 text-[11px]">
      {isImage && attachment.localUrl ? <img src={attachment.localUrl} className="h-7 w-7 rounded object-cover" /> : isImage ? <Image className="h-4 w-4 text-blue" /> : <FileText className="h-4 w-4 text-blue" />}
      <span className="min-w-0 flex-1 truncate text-txt-1">{attachment.fileName}</span>
      {attachment.status === 'uploading' && <LoaderCircle className="h-3.5 w-3.5 animate-spin text-txt-2" />}
      {attachment.status === 'failed' && <button type="button" title={attachment.error ?? '재시도'} onClick={onRetry} className="text-red"><RotateCw className="h-3.5 w-3.5" /></button>}
      <button type="button" onClick={onRemove} className="text-txt-2 hover:text-txt-0"><X className="h-3.5 w-3.5" /></button>
    </div>
  )
}
