import {
  ChevronUp,
  KeyRound,
  LogOut,
  UserRound,
  MessageSquare,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useAuthStore } from '@/store/authStore'
import { useSettingsStore } from '@/store/settingsStore'
import { useChatStore } from '@/store/chatStore'
import { FeedbackModal } from '@/components/FeedbackModal'

// 프로필 메뉴 — 현재 사용자 정보와 계정·API 키·로그아웃 동작을 연결한다
export function ProfileMenu() {
  const user = useAuthStore((state) => state.user)
  const logout = useAuthStore((state) => state.logout)
  const openProfile = useSettingsStore((state) => state.openProfile)
  const openApiKey = useSettingsStore((state) => state.openApiKey)
  const resetSession = useChatStore((state) => state.resetSession)
  const [isOpen, setIsOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const holderRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return

    function closeFromOutside(event: PointerEvent) {
      if (!holderRef.current?.contains(event.target as Node)) setIsOpen(false)
    }

    function closeFromEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false)
    }

    document.addEventListener('pointerdown', closeFromOutside)
    document.addEventListener('keydown', closeFromEscape)
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside)
      document.removeEventListener('keydown', closeFromEscape)
    }
  }, [isOpen])

  if (!user) return null

  function run(action: () => void) {
    setIsOpen(false)
    action()
  }

  return (
    <><div ref={holderRef} className="relative border-t border-line">
      {isOpen && (
        <div className="absolute bottom-full left-2 right-2 z-40 mb-2 overflow-hidden rounded-xl border border-line bg-bg-2 p-1.5 shadow-2xl shadow-black/40">
          <div className="border-b border-line px-2.5 py-2.5">
            <p className="truncate text-[12.5px] font-semibold">{user.name}</p>
            <p className="mt-0.5 truncate text-[11px] text-txt-2">
              {user.email}
            </p>
          </div>
          <MenuButton
            icon={<UserRound className="h-3.5 w-3.5" />}
            label="사용자 정보"
            onClick={() => run(openProfile)}
          />
          <MenuButton icon={<MessageSquare className="h-3.5 w-3.5" />} label="피드백 남기기" onClick={() => run(() => setFeedbackOpen(true))} />
          <MenuButton
            icon={<KeyRound className="h-3.5 w-3.5" />}
            label="API 키 관리"
            onClick={() => run(() => openApiKey())}
          />
          <div className="my-1 border-t border-line" />
          <MenuButton
            icon={<LogOut className="h-3.5 w-3.5" />}
            label="로그아웃"
            danger
            onClick={() => run(() => { resetSession(); void logout() })}
          />
        </div>
      )}

      <button
        type="button"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        onClick={() => setIsOpen((open) => !open)}
        className="flex w-full items-center gap-2.5 px-3 py-3 text-left transition hover:bg-bg-2"
      >
        {user.profileImage ? (
          <img
            src={user.profileImage}
            alt=""
            className="h-7 w-7 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue text-[12px] font-semibold text-white">
            {user.name.charAt(0).toUpperCase()}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-semibold">
            {user.name}
          </span>
          <span className="block truncate text-[11px] text-txt-3">
            {user.email}
          </span>
        </span>
        <ChevronUp
          className={`h-3.5 w-3.5 shrink-0 text-txt-3 transition ${
            isOpen ? '' : 'rotate-180'
          }`}
        />
      </button>
    </div>{feedbackOpen && <FeedbackModal onClose={() => setFeedbackOpen(false)} />}</>
  )
}

function MenuButton({
  icon,
  label,
  danger = false,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[12px] transition hover:bg-bg-3 ${
        danger ? 'text-red' : 'text-txt-1 hover:text-txt-0'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}
