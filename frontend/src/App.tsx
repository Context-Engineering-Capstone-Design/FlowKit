import { useEffect, useState } from 'react'
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

// 데스크톱 화면 폭(lg, 1024px) 미만에서는 좌측·우측 패널을 겹치지 않는 전체 화면
// 오버레이로 다루고, 한쪽이 열리면 다른 쪽은 접는다 (0821_01 B).
function isNarrowViewport() {
  return window.matchMedia('(max-width: 1023.98px)').matches
}

// 3단 작업 화면 — 좌측 대화·브랜치, 중앙 채팅, 우측 Context 편집 (NFR-001)
function Workspace() {
  // 좁은 화면에서는 기본으로 접어 둔다. 화면 폭은 마운트 시점에만 확인하고,
  // 이후 창 크기를 바꿔도 사용자가 이미 고른 열림 상태는 임의로 바꾸지 않는다.
  const [sidebarPinned, setSidebarPinned] = useState(() => !isNarrowViewport())
  const [sidebarPeeking, setSidebarPeeking] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelWidth, setPanelWidth] = useState(() => Number(sessionStorage.getItem('flowkit_context_panel_width')) || 310)
  const openDefaultChat = useChatStore((s) => s.openDefaultChat)
  const contextPanelSignal = useChatStore((s) => s.contextPanelSignal)
  const draftText = useChatStore((s) => s.draftText)
  const attachmentCount = useChatStore((s) => s.draftAttachments.length)
  const editingBlockId = useChatStore((s) => s.editingBlockId)
  const editingDraft = useChatStore((s) => s.editingDraft)
  const editingOriginal = useChatStore((s) => s.editingOriginal)

  const sidebarOpen = sidebarPinned || sidebarPeeking

  useEffect(() => {
    void openDefaultChat()
  }, [openDefaultChat])


  useEffect(() => {
    if (contextPanelSignal) openPanel()
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  function closeSidebar() {
    setSidebarPinned(false)
    setSidebarPeeking(false)
  }

  // 좁은 화면에서는 사이드바와 Context 패널이 동시에 화면을 덮지 않도록,
  // 한쪽을 열면 다른 쪽을 닫는다 (0821_01 B3).
  function openSidebar() {
    setSidebarPinned(true)
    setSidebarPeeking(false)
    if (isNarrowViewport()) setPanelOpen(false)
  }

  function openPanel() {
    setPanelOpen(true)
    if (isNarrowViewport()) {
      setSidebarPinned(false)
      setSidebarPeeking(false)
    }
  }

  function togglePanel() {
    if (panelOpen) setPanelOpen(false)
    else openPanel()
  }

  return (
    <div className="flex h-full">
      {/* lg 이상에서 고정 시에만 자리를 차지해 메인 패널이 부드럽게 밀리도록 한다.
          lg 미만에서는 사이드바가 항상 오버레이라 자리를 차지하지 않는다 (0821_01 B1). */}
      <div
        aria-hidden
        className={`shrink-0 transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none ${
          sidebarPinned ? 'w-0 lg:w-[236px]' : 'w-0'
        }`}
      />
      {/* 호버로 살짝 열어보는 방식은 마우스가 있는 넓은 화면에서만 쓴다 */}
      {!sidebarPinned && (
        <div
          aria-hidden
          data-testid="sidebar-hover-zone"
          className="fixed inset-y-0 left-0 z-30 hidden w-3 lg:block"
          onPointerEnter={() => setSidebarPeeking(true)}
        />
      )}
      {/* lg 미만에서 사이드바가 오버레이로 열려 있는 동안 뒤 화면 조작을 막는다 (0821_01 B2) */}
      {sidebarOpen && (
        <div
          aria-hidden
          onClick={closeSidebar}
          className="fixed inset-0 z-20 bg-black/50 lg:hidden"
        />
      )}
      <Sidebar
        open={sidebarOpen}
        pinned={sidebarPinned}
        onClose={closeSidebar}
        onPin={openSidebar}
        onPeekEnter={() => setSidebarPeeking(true)}
        onPeekLeave={() => setSidebarPeeking(false)}
      />
      <ChatArea
        panelOpen={panelOpen}
        onTogglePanel={togglePanel}
        sidebarOpen={sidebarOpen}
        onOpenSidebar={openSidebar}
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
      <UserProfileModal />
      <ApiKeyModal />
    </div>
  )
}
