import { useEffect, useState } from 'react'
import { BranchModal } from '@/components/BranchModal'
import { ApiKeyModal } from '@/components/ApiKeyModal'
import { ChatArea } from '@/components/ChatArea'
import { ContextPanel } from '@/components/ContextPanel'
import { LoginScreen } from '@/components/LoginScreen'
import { Sidebar } from '@/components/Sidebar'
import { UserProfileModal } from '@/components/UserProfileModal'
import { AUTH_EXPIRED_EVENT } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'

// 앱 최상단 틀 — 로그인 여부에 따라 로그인 화면 또는 3단 작업 화면을 보여준다
export default function App() {
  const user = useAuthStore((s) => s.user)
  const isChecking = useAuthStore((s) => s.isChecking)
  const check = useAuthStore((s) => s.check)
  const clearSession = useAuthStore((s) => s.clearSession)
  const closeSettings = useSettingsStore((s) => s.closeModal)
  const resetSession = useChatStore((s) => s.resetSession)

  useEffect(() => {
    void check()
  }, [check])

  useEffect(() => {
    function expireSession() {
      clearSession()
      closeSettings()
      resetSession()
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, expireSession)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, expireSession)
  }, [clearSession, closeSettings, resetSession])

  if (isChecking) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-txt-3">
        불러오는 중…
      </div>
    )
  }

  return user ? <Workspace /> : <LoginScreen />
}

// 3단 작업 화면 — 좌측 대화·브랜치, 중앙 채팅, 우측 Context 편집 (NFR-001)
function Workspace() {
  const [panelOpen, setPanelOpen] = useState(true)
  const [branchModalOpen, setBranchModalOpen] = useState(false)
  const openDefaultChat = useChatStore((s) => s.openDefaultChat)
  const selectedCount = useChatStore((s) => s.selectedBlockIds.length)

  useEffect(() => {
    void openDefaultChat()
  }, [openDefaultChat])

  // 블록을 고르면 편집할 곳이 보여야 한다
  useEffect(() => {
    if (selectedCount > 0) setPanelOpen(true)
  }, [selectedCount])

  return (
    <div className="flex h-full">
      <Sidebar />
      <ChatArea
        panelOpen={panelOpen}
        onTogglePanel={() => setPanelOpen((v) => !v)}
        onCreateBranch={() => setBranchModalOpen(true)}
      />
      {panelOpen && <ContextPanel onClose={() => setPanelOpen(false)} />}
      {branchModalOpen && (
        <BranchModal onClose={() => setBranchModalOpen(false)} />
      )}
      <UserProfileModal />
      <ApiKeyModal />
    </div>
  )
}
