type ActionResult = void | Promise<unknown>

interface Props {
  draft: string
  busy: boolean
  onDraftChange: (draft: string) => void
  onCancel: () => void
  onSaveBranch: () => ActionResult
  onSave: () => ActionResult
}

// 메시지 본문을 고치고 원본 저장 또는 새 브랜치 저장을 선택하게 한다
export function MessageEditForm({
  draft,
  busy,
  onDraftChange,
  onCancel,
  onSaveBranch,
  onSave,
}: Props) {
  const empty = !draft.trim()

  return (
    <div className="mt-1">
      <textarea
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        aria-label="메시지 내용 수정"
        className="min-h-24 w-full rounded-lg bg-bg-2 p-2 text-[13px] text-txt-0 outline-none"
      />
      <div className="mt-1 flex gap-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-2 py-1 text-[11px] text-txt-2"
        >
          취소
        </button>
        <button
          type="button"
          disabled={empty}
          onClick={() => void onSaveBranch()}
          className="rounded px-2 py-1 text-[11px] text-green disabled:opacity-40"
        >
          브랜치로 저장
        </button>
        <button
          type="button"
          disabled={busy || empty}
          onClick={() => void onSave()}
          className="rounded bg-blue px-2 py-1 text-[11px] text-white disabled:opacity-40"
        >
          저장
        </button>
      </div>
    </div>
  )
}
