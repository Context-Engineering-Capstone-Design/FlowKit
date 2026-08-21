import { useEffect, useRef, useState } from 'react'
import { ApiKeyModal } from '@/components/ApiKeyModal'
import { ChatPane } from '@/components/ChatPane'
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
import { connectRealtime, createChatStore, disconnectRealtime, setSidePanelOpener, useChatStore } from '@/store/chatStore'
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

// 좌측 사이드바와 최대 두 개의 독립 대화 패널을 배치한다.
function Workspace() {
  // 좁은 화면에서는 기본으로 접어 둔다. 화면 폭은 마운트 시점에만 확인하고,
  // 이후 창 크기를 바꿔도 사용자가 이미 고른 열림 상태는 임의로 바꾸지 않는다.
  const [sidebarPinned, setSidebarPinned] = useState(() => !isNarrowViewport())
  const [sidebarPeeking, setSidebarPeeking] = useState(false)
  const [sideStore, setSideStore] = useState<typeof useChatStore | null>(null)
  const sideStoreRef = useRef<typeof useChatStore | null>(null)
  const [sideWidth, setSideWidth] = useState(() => Number(sessionStorage.getItem('flowkit_side_panel_width')) || 520)
  const openDefaultChat = useChatStore((s) => s.openDefaultChat)
  // Vite가 상태 모듈을 교체하는 순간에도 이전 Store 모양 때문에 작업 화면 전체가
  // 무너지지 않도록, 아직 없는 초안 필드는 빈 값으로 읽는다.
  const draftText = useChatStore((s) => s.draftText ?? '')
  const attachmentCount = useChatStore((s) => s.draftAttachments?.length ?? 0)
  const editingBlockId = useChatStore((s) => s.editingBlockId)
  const editingDraft = useChatStore((s) => s.editingDraft)
  const editingOriginal = useChatStore((s) => s.editingOriginal)

  const sidebarOpen = sidebarPinned || sidebarPeeking

  useEffect(() => {
    void openDefaultChat()
  }, [openDefaultChat])

  // 0821_05: 로그인해 있는 동안(=Workspace가 떠 있는 동안) 다른 창의 변화를
  // 받는 실시간 채널을 열어 둔다. 로그아웃하면 Workspace가 사라지며 닫힌다.
  useEffect(() => {
    connectRealtime()
    return () => disconnectRealtime()
  }, [])


  useEffect(() => {
    setSidePanelOpener(async (chatId, branchId) => {
      let store = sideStoreRef.current
      if (!store) {
        store = createChatStore({ onEmptyTabs: () => { sideStoreRef.current = null; setSideStore(null) } })
        sideStoreRef.current = store
        setSideStore(() => store)
      }
      await store.getState().openChat(chatId, branchId)
    })
    return () => setSidePanelOpener(null)
  }, [])

  useEffect(() => {
    const dirty = Boolean(draftText.trim() || attachmentCount || (editingBlockId && editingDraft !== editingOriginal))
    if (!dirty) return
    function guard(event: BeforeUnloadEvent) { event.preventDefault() }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [attachmentCount, draftText, editingBlockId, editingDraft, editingOriginal])

  function resizeSidePanel(clientX: number) {
    const next = Math.min(Math.floor(window.innerWidth * 0.7), Math.max(360, window.innerWidth - clientX))
    setSideWidth(next)
    sessionStorage.setItem('flowkit_side_panel_width', String(next))
  }

  function closeSidebar() {
    setSidebarPinned(false)
    setSidebarPeeking(false)
  }

  function openSidebar() {
    setSidebarPinned(true)
    setSidebarPeeking(false)
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
      <div className="flex min-w-0 flex-1">
        <ChatPane store={useChatStore} sidebarOpen={sidebarOpen} onOpenSidebar={openSidebar} />
        {sideStore && (
          <div style={{ width: sideWidth }} className="relative hidden min-w-[360px] shrink-0 lg:flex">
            <div
              aria-label="사이드 패널 너비 조절"
              onPointerDown={() => {
                function move(event: PointerEvent) { resizeSidePanel(event.clientX) }
                function end() { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end) }
                window.addEventListener('pointermove', move)
                window.addEventListener('pointerup', end)
              }}
              className="absolute inset-y-0 left-0 z-20 w-1 cursor-col-resize hover:bg-blue"
            />
            <ChatPane store={sideStore} sidebarOpen={sidebarOpen} onOpenSidebar={openSidebar} />
          </div>
        )}
      </div>
      <UserProfileModal />
      <ApiKeyModal />
    </div>
  )
}
