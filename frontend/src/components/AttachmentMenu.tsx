import { FileUp, ImageUp, Paperclip } from 'lucide-react'
import { useRef, useState } from 'react'

interface Props {
  disabled: boolean
  onSelect: (files: File[]) => void
}

// 사진과 문서 파일을 고르는 작은 입력 메뉴
export function AttachmentMenu({ disabled, onSelect }: Props) {
  const [open, setOpen] = useState(false)
  const imageRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function selected(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    if (files.length) onSelect(files)
    event.target.value = ''
    setOpen(false)
  }

  return (
    <div className="relative">
      <input ref={imageRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={selected} />
      <input ref={fileRef} type="file" accept="application/pdf,text/plain,text/markdown,.txt,.md,.markdown" multiple hidden onChange={selected} />
      <button type="button" disabled={disabled} onClick={() => setOpen((v) => !v)} title="파일 첨부" className="rounded-md p-1.5 text-txt-2 hover:bg-bg-3 hover:text-txt-0 disabled:opacity-30">
        <Paperclip className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute bottom-9 left-0 z-10 w-36 rounded-lg border border-line bg-bg-2 p-1 shadow-xl">
          <button type="button" onClick={() => imageRef.current?.click()} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12px] text-txt-1 hover:bg-bg-3"><ImageUp className="h-3.5 w-3.5 text-blue" />사진 업로드</button>
          <button type="button" onClick={() => fileRef.current?.click()} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12px] text-txt-1 hover:bg-bg-3"><FileUp className="h-3.5 w-3.5 text-blue" />파일 업로드</button>
        </div>
      )}
    </div>
  )
}
