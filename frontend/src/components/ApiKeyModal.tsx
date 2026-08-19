import {
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  PlugZap,
  Trash2,
  X,
  XCircle,
} from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useSettingsStore } from '@/store/settingsStore'
import type { ApiKeyConnectionStatus } from '@/types/api'

const STATUS_TEXT: Record<ApiKeyConnectionStatus, string> = {
  unchecked: '연결 확인 전',
  connected: '연결됨',
  failed: '연결 실패',
}

// API 키 모달 — 사용자 키의 저장·삭제·연결 확인과 마스킹 상태를 관리한다
export function ApiKeyModal() {
  const activeModal = useSettingsStore((state) => state.activeModal)
  const closeModal = useSettingsStore((state) => state.closeModal)
  const status = useSettingsStore((state) => state.apiKeyStatus)
  const isLoading = useSettingsStore((state) => state.isLoading)
  const isSaving = useSettingsStore((state) => state.isSaving)
  const isChecking = useSettingsStore((state) => state.isChecking)
  const isDeleting = useSettingsStore((state) => state.isDeleting)
  const error = useSettingsStore((state) => state.error)
  const notice = useSettingsStore((state) => state.notice)
  const clearMessages = useSettingsStore((state) => state.clearMessages)
  const saveApiKey = useSettingsStore((state) => state.saveApiKey)
  const deleteApiKey = useSettingsStore((state) => state.deleteApiKey)
  const checkApiKey = useSettingsStore((state) => state.checkApiKey)
  const [apiKey, setApiKey] = useState('')
  const [isVisible, setIsVisible] = useState(false)
  const isBusy = isSaving || isChecking || isDeleting

  useEffect(() => {
    if (activeModal !== 'apiKey') return
    setApiKey('')
    setIsVisible(false)
  }, [activeModal])

  useEffect(() => {
    if (activeModal !== 'apiKey') return
    function closeFromEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isBusy) closeModal()
    }
    document.addEventListener('keydown', closeFromEscape)
    return () => document.removeEventListener('keydown', closeFromEscape)
  }, [activeModal, closeModal, isBusy])

  if (activeModal !== 'apiKey') return null

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const saved = await saveApiKey(apiKey)
    if (saved) {
      setApiKey('')
      setIsVisible(false)
    }
  }

  async function remove() {
    if (!window.confirm('저장된 API 키를 삭제할까요?')) return
    await deleteApiKey()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget && !isBusy) closeModal()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="api-key-modal-title"
        className="w-full max-w-[480px] rounded-2xl border border-line bg-bg-1 shadow-2xl shadow-black/40"
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2
            id="api-key-modal-title"
            className="flex items-center gap-2 text-[14px] font-semibold"
          >
            <KeyRound className="h-4 w-4 text-blue" />
            Google AI API 키
          </h2>
          <button
            type="button"
            onClick={closeModal}
            disabled={isBusy}
            aria-label="닫기"
            className="text-txt-3 transition hover:text-txt-0 disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 px-5 py-5">
          <p className="text-[12px] leading-relaxed text-txt-2">
            키는 서버에서 암호화해 저장하며, 다시 화면에 표시하지 않습니다.
            답변·정제·제목 생성에는 현재 로그인한 사용자의 키만 사용합니다.
          </p>

          {isLoading ? (
            <div className="flex items-center gap-2 rounded-xl bg-bg-2 px-3.5 py-3 text-[12px] text-txt-2">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              등록 상태를 불러오는 중…
            </div>
          ) : (
            <SavedKeyStatus
              hasKey={status?.hasApiKey ?? false}
              last4={status?.last4 ?? null}
              connectionStatus={status?.connectedStatus ?? null}
              checkedAt={status?.checkedAt ?? null}
              message={status?.message ?? null}
            />
          )}

          <form onSubmit={(event) => void submit(event)}>
            <label className="mb-1.5 block text-[11.5px] font-medium text-txt-2">
              {status?.hasApiKey ? '새 키로 교체' : 'API 키 등록'}
            </label>
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <input
                  autoFocus
                  type={isVisible ? 'text' : 'password'}
                  autoComplete="off"
                  spellCheck={false}
                  value={apiKey}
                  onChange={(event) => {
                    setApiKey(event.target.value)
                    clearMessages()
                  }}
                  placeholder="Google AI API 키 입력"
                  className="w-full rounded-lg border border-line bg-bg-2 py-2.5 pl-3 pr-10 text-[13px] outline-none transition placeholder:text-txt-3 focus:border-blue"
                />
                <button
                  type="button"
                  title={isVisible ? '키 숨기기' : '키 보기'}
                  onClick={() => setIsVisible((visible) => !visible)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-txt-3 transition hover:text-txt-1"
                >
                  {isVisible ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              <button
                type="submit"
                disabled={isBusy || apiKey.trim().length < 16}
                className="rounded-lg bg-blue px-4 py-2 text-[12.5px] font-semibold text-white transition disabled:opacity-40"
              >
                {isSaving ? '저장 중…' : '저장'}
              </button>
            </div>
          </form>

          {error && <p className="text-[12px] text-red">{error}</p>}
          {notice && <p className="text-[12px] text-green">{notice}</p>}
        </div>

        {status?.hasApiKey && (
          <footer className="flex items-center justify-between border-t border-line px-5 py-4">
            <button
              type="button"
              onClick={() => void remove()}
              disabled={isBusy}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] text-red transition hover:bg-red/10 disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              키 삭제
            </button>
            <button
              type="button"
              onClick={() => void checkApiKey()}
              disabled={isBusy}
              className="flex items-center gap-1.5 rounded-lg border border-line-strong px-3.5 py-2 text-[12px] text-txt-1 transition hover:bg-bg-2 hover:text-txt-0 disabled:opacity-40"
            >
              {isChecking ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PlugZap className="h-3.5 w-3.5" />
              )}
              {isChecking ? '확인 중…' : '연결 확인'}
            </button>
          </footer>
        )}
      </div>
    </div>
  )
}

function SavedKeyStatus({
  hasKey,
  last4,
  connectionStatus,
  checkedAt,
  message,
}: {
  hasKey: boolean
  last4: string | null
  connectionStatus: ApiKeyConnectionStatus | null
  checkedAt: string | null
  message: string | null
}) {
  if (!hasKey) {
    return (
      <div className="rounded-xl border border-line bg-bg-2 px-3.5 py-3 text-[12px] text-txt-2">
        등록된 API 키가 없습니다.
      </div>
    )
  }

  const connected = connectionStatus === 'connected'
  const failed = connectionStatus === 'failed'
  const checkedDate = checkedAt ? new Date(checkedAt) : null

  return (
    <div className="rounded-xl border border-line bg-bg-2 px-3.5 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[13px] text-txt-0">
          •••• {last4}
        </span>
        <span
          className={`flex items-center gap-1.5 text-[11.5px] ${
            connected ? 'text-green' : failed ? 'text-red' : 'text-txt-2'
          }`}
        >
          {connected ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : failed ? (
            <XCircle className="h-3.5 w-3.5" />
          ) : null}
          {connectionStatus ? STATUS_TEXT[connectionStatus] : '연결 확인 전'}
        </span>
      </div>
      {message && (
        <p className={`mt-2 text-[11.5px] ${failed ? 'text-red' : 'text-txt-2'}`}>
          {message}
        </p>
      )}
      {checkedDate && !Number.isNaN(checkedDate.getTime()) && (
        <p className="mt-1 text-[10.5px] text-txt-3">
          마지막 확인: {checkedDate.toLocaleString('ko-KR')}
        </p>
      )}
    </div>
  )
}
