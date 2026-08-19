import { UserRound, X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { toErrorMessage } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { useSettingsStore } from '@/store/settingsStore'
import { useNotificationStore } from '@/store/notificationStore'

// 사용자 정보 모달 — 이름·이메일·메모를 수정하고 전역 프로필을 갱신한다
export function UserProfileModal() {
  const activeModal = useSettingsStore((state) => state.activeModal)
  const closeModal = useSettingsStore((state) => state.closeModal)
  const user = useAuthStore((state) => state.user)
  const updateProfile = useAuthStore((state) => state.updateProfile)
  const showError = useNotificationStore((state) => state.showError)
  const showToast = useNotificationStore((state) => state.showToast)
  const dismissBanner = useNotificationStore((state) => state.dismissBanner)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [memo, setMemo] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const currentUser = useAuthStore.getState().user
    if (activeModal !== 'profile' || !currentUser) return
    setName(currentUser.name)
    setEmail(currentUser.email)
    setMemo(currentUser.memo ?? '')
    setError(null)
    setSaved(false)
  }, [activeModal])

  useEffect(() => {
    if (activeModal !== 'profile') return
    function closeFromEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isSaving) closeModal()
    }
    document.addEventListener('keydown', closeFromEscape)
    return () => document.removeEventListener('keydown', closeFromEscape)
  }, [activeModal, closeModal, isSaving])

  if (activeModal !== 'profile' || !user) return null

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSaving(true)
    setError(null)
    setSaved(false)
    try {
      await updateProfile({
        name: name.trim(),
        email: email.trim(),
        memo: memo.trim() || null,
      })
      dismissBanner('profile')
      setSaved(true)
      showToast({ message: '사용자 정보를 저장했습니다.', kind: 'success' })
    } catch (submitError) {
      setError(toErrorMessage(submitError))
      showError(submitError, { scope: 'profile' })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget && !isSaving) closeModal()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-modal-title"
        className="w-full max-w-[440px] rounded-2xl border border-line bg-bg-1 shadow-2xl shadow-black/40"
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2
            id="profile-modal-title"
            className="flex items-center gap-2 text-[14px] font-semibold"
          >
            <UserRound className="h-4 w-4 text-blue" />
            사용자 정보
          </h2>
          <button
            type="button"
            onClick={closeModal}
            disabled={isSaving}
            aria-label="닫기"
            className="text-txt-3 transition hover:text-txt-0 disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <form onSubmit={(event) => void submit(event)}>
          <div className="space-y-4 px-5 py-5">
            <ModalField label="이름">
              <input
                autoFocus
                required
                maxLength={100}
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  setSaved(false)
                }}
                className="w-full rounded-lg border border-line bg-bg-2 px-3 py-2.5 text-[13px] outline-none transition focus:border-blue"
              />
            </ModalField>
            <ModalField label="이메일">
              <input
                required
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value)
                  setSaved(false)
                }}
                className="w-full rounded-lg border border-line bg-bg-2 px-3 py-2.5 text-[13px] outline-none transition focus:border-blue"
              />
            </ModalField>
            <ModalField label="메모">
              <textarea
                rows={3}
                value={memo}
                onChange={(event) => {
                  setMemo(event.target.value)
                  setSaved(false)
                }}
                placeholder="프로필에 남길 메모를 입력하세요"
                className="w-full resize-none rounded-lg border border-line bg-bg-2 px-3 py-2.5 text-[13px] outline-none transition placeholder:text-txt-3 focus:border-blue"
              />
            </ModalField>

            {error && <p className="text-[12px] text-red">{error}</p>}
            {saved && (
              <p className="text-[12px] text-green">
                사용자 정보를 저장했습니다.
              </p>
            )}
          </div>

          <footer className="flex justify-end gap-2 border-t border-line px-5 py-4">
            <button
              type="button"
              onClick={closeModal}
              disabled={isSaving}
              className="rounded-lg px-4 py-2 text-[12.5px] text-txt-2 transition hover:text-txt-0 disabled:opacity-40"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={isSaving || !name.trim() || !email.trim()}
              className="rounded-lg bg-blue px-4 py-2 text-[12.5px] font-semibold text-white transition disabled:opacity-40"
            >
              {isSaving ? '저장 중…' : '저장'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}

function ModalField({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11.5px] font-medium text-txt-2">
        {label}
      </span>
      {children}
    </label>
  )
}
