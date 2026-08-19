import { useEffect, useState } from 'react'
import { BranchModal } from '@/components/BranchModal'
import { ApiKeyModal } from '@/components/ApiKeyModal'
import { ChatArea } from '@/components/ChatArea'
import { ContextPanel } from '@/components/ContextPanel'
import { LoginScreen } from '@/components/LoginScreen'
import { Sidebar } from '@/components/Sidebar'
import { UserProfileModal } from '@/components/UserProfileModal'
import { Toast } from '@/components/Toast'
import { AppErrorBoundary } from '@/components/AppErrorBoundary'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { reportClientError } from '@/lib/errorReporting'
import { AUTH_EXPIRED_EVENT } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'
import { useNotificationStore } from '@/store/notificationStore'

// 앱 최상단 틀 — 로그인 여부에 따라 로그인 화면 또는 3단 작업 화면을 보여준다
export default function App() {
  const user = useAuthStore((s) => s.user)
  const isChecking = useAuthStore((s) => s.isChecking)
  const check = useAuthStore((s) => s.check)
  const clearSession = useAuthStore((s) => s.clearSession)
  const closeSettings = useSettingsStore((s) => s.closeModal)
  const resetSession = useChatStore((s) => s.resetSession)
  const showNotification = useNotificationStore((s) => s.show)
  const showError = useNotificationStore((s) => s.showError)
  const chatError = useChatStore((s) => s.error)

  useEffect(() => {
    void check()
  }, [check])

  useEffect(() => {
    function expireSession() {
      clearSession()
      closeSettings()
      resetSession()
      showNotification('세션이 만료되었습니다. 다시 로그인해주세요.', 'info')
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, expireSession)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, expireSession)
  }, [clearSession, closeSettings, resetSession, showNotification])

  useEffect(() => { const onError = (event: ErrorEvent) => reportClientError('window_error', event.error ?? event.message, { page: window.location.pathname }); const onReject = (event: PromiseRejectionEvent) => reportClientError('unhandled_rejection', event.reason, { page: window.location.pathname }); window.addEventListener('error', onError); window.addEventListener('unhandledrejection', onReject); return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onReject) } }, [])

  useEffect(() => {
    if (chatError) showError(chatError, { message: chatError })
  }, [chatError, showError])

  if (isChecking) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-txt-3">
        불러오는 중…
      </div>
    )
  }

  return <AppErrorBoundary>{user ? <Workspace /> : <LoginScreen />}<Toast /><ConfirmDialog /></AppErrorBoundary>
}

// 3단 작업 화면 — 좌측 대화·브랜치, 중앙 채팅, 우측 Context 편집 (NFR-001)
function Workspace() {
  const [panelOpen, setPanelOpen] = useState(true)
  const [panelWidth, setPanelWidth] = useState(() => Number(sessionStorage.getItem('flowkit_context_panel_width')) || 310)
  const openDefaultChat = useChatStore((s) => s.openDefaultChat)
  const selectedCount = useChatStore((s) => s.selectedBlockIds.length)
  const blocks = useChatStore((s) => s.blocks)
  const branchDraft = useChatStore((s) => s.branchDraft)
  const openBranchModal = useChatStore((s) => s.openBranchModal)
  const closeBranchModal = useChatStore((s) => s.closeBranchModal)
  const contextPanelSignal = useChatStore((s) => s.contextPanelSignal)
  const draftText = useChatStore((s) => s.draftText)
  const attachmentCount = useChatStore((s) => s.draftAttachments.length)
  const editingBlockId = useChatStore((s) => s.editingBlockId)
  const editingDraft = useChatStore((s) => s.editingDraft)
  const editingOriginal = useChatStore((s) => s.editingOriginal)

  useEffect(() => {
    void openDefaultChat()
  }, [openDefaultChat])

  // 블록을 고르면 편집할 곳이 보여야 한다
  useEffect(() => {
    if (selectedCount > 0) setPanelOpen(true)
  }, [selectedCount])

  useEffect(() => {
    if (contextPanelSignal) setPanelOpen(true)
  }, [contextPanelSignal])

  useEffect(() => {
    const dirty = Boolean(draftText.trim() || attachmentCount || (editingBlockId && editingDraft !== editingOriginal))
    if (!dirty) return
    function guard(event: BeforeUnloadEvent) { event.preventDefault() }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [attachmentCount, draftText, editingBlockId, editingDraft, editingOriginal])

  function resizePanel(clientX: number) {
    const next = Math.min(480, Math.max(260, window.innerWidth - clientX))
    setPanelWidth(next)
    sessionStorage.setItem('flowkit_context_panel_width', String(next))
  }

  return (
    <div className="flex h-full">
      <Sidebar />
      <ChatArea
        panelOpen={panelOpen}
        onTogglePanel={() => setPanelOpen((v) => !v)}
        onCreateBranch={() => openBranchModal(blocks.at(-1)?.blockId ?? '', undefined, 'header')}
      />
      {panelOpen && <ContextPanel onClose={() => setPanelOpen(false)} width={panelWidth} onResizeStart={() => {
        function move(event: PointerEvent) { resizePanel(event.clientX) }
        function end() { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end) }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', end)
      }} />}
      {branchDraft && (
        <BranchModal
          onClose={closeBranchModal}
          initialBaseBlockId={branchDraft.baseBlockId}
          initialContextBlockIds={branchDraft.contextBlockIds}
          editedBaseContent={branchDraft.editedBaseContent}
        />
      )}
      <UserProfileModal />
      <ApiKeyModal />
    </div>
  )
}
