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
import { handleAuthExpired } from '@/lib/authExpiration'
import { AUTH_EXPIRED_EVENT } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { useChatStore } from '@/store/chatStore'
import { useNotificationStore } from '@/store/notificationStore'

// 앱 최상단 틀 — 로그인 여부에 따라 로그인 화면 또는 3단 작업 화면을 보여준다
export default function App() {
  const user = useAuthStore((s) => s.user)
  const isChecking = useAuthStore((s) => s.isChecking)
  const check = useAuthStore((s) => s.check)
  const showError = useNotificationStore((s) => s.showError)
  const dismissBanner = useNotificationStore((s) => s.dismissBanner)
  const chatError = useChatStore((s) => s.error)
  const refineFailed = useChatStore((s) => s.refineFailed)

  useEffect(() => {
    void check()
  }, [check])

  useEffect(() => {
    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
  }, [])

  useEffect(() => { const onError = (event: ErrorEvent) => reportClientError('window_error', event.error ?? event.message, { page: window.location.pathname }); const onReject = (event: PromiseRejectionEvent) => reportClientError('unhandled_rejection', event.reason, { page: window.location.pathname }); window.addEventListener('error', onError); window.addEventListener('unhandledrejection', onReject); return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onReject) } }, [])

  useEffect(() => {
    // 정제 실패 사유는 Context 패널 안에 표시하므로 전역 배너로 중복 노출하지 않는다
    if (refineFailed) { dismissBanner('chat'); return }
    if (chatError) showError(chatError, { message: chatError, scope: 'chat' })
    else dismissBanner('chat')
  }, [chatError, dismissBanner, refineFailed, showError])

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
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelWidth, setPanelWidth] = useState(() => Number(sessionStorage.getItem('flowkit_context_panel_width')) || 310)
  const openDefaultChat = useChatStore((s) => s.openDefaultChat)
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
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <ChatArea
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        panelOpen={panelOpen}
        onTogglePanel={() => setPanelOpen((v) => !v)}
        onCreateBranch={() => openBranchModal(blocks.at(-1)?.blockId ?? '', undefined, 'header')}
      />
      <ContextPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        width={panelWidth}
        onResizeStart={() => {
        function move(event: PointerEvent) { resizePanel(event.clientX) }
        function end() { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end) }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', end)
      }} />
      {branchDraft && (
        <BranchModal
          onClose={closeBranchModal}
          initialBaseBlockId={branchDraft.baseBlockId}
          editedBaseContent={branchDraft.editedBaseContent}
        />
      )}
      <UserProfileModal />
      <ApiKeyModal />
    </div>
  )
}
