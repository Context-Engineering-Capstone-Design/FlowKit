import { useConfirmStore } from '@/store/confirmStore'

// 저장하지 않은 작업을 버리기 전에 앱 전체에서 같은 확인 UI를 보여준다
export function ConfirmDialog() {
  const message = useConfirmStore((state) => state.message)
  const accept = useConfirmStore((state) => state.accept)
  const cancel = useConfirmStore((state) => state.cancel)

  if (!message) return null

  return (
    <div role="presentation" className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-5" onClick={(event) => { if (event.target === event.currentTarget) cancel() }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-message" className="w-full max-w-sm rounded-xl bg-bg-1 p-5 shadow-2xl">
        <p id="confirm-message" className="text-[13px] leading-relaxed text-txt-0">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={cancel} className="rounded-lg px-3 py-2 text-[12px] text-txt-2 hover:bg-bg-2">취소</button>
          <button type="button" onClick={accept} autoFocus className="rounded-lg bg-red px-3 py-2 text-[12px] font-semibold text-white">버리기</button>
        </div>
      </div>
    </div>
  )
}
