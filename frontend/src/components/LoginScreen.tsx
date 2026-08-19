import { Layers } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { renderGoogleButton } from '@/lib/googleSignIn'
import { useAuthStore } from '@/store/authStore'

const FEATURES = ['블록 선택', 'Context 정제', '브랜치 생성', '버전 관리']

// 로그인 화면 — 서비스 소개와 Google 로그인 버튼 (REQ-001, REQ-002)
export function LoginScreen() {
  const error = useAuthStore((s) => s.error)

  return (
    <div className="flex h-full items-center justify-center bg-bg-0">
      <div className="w-[380px] rounded-2xl bg-bg-1 p-10 text-center">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-linear-to-br from-blue to-green">
            <Layers className="h-5 w-5 text-white" strokeWidth={2} />
          </span>
          <span className="text-xl font-bold">FlowKit</span>
        </div>

        <h1 className="text-2xl font-bold leading-tight">
          대화를 <span className="text-blue">설계</span>하는
          <br />
          AI 워크플로 도구
        </h1>
        <p className="mt-4 text-[13px] leading-relaxed text-txt-2">
          메시지 블록을 직접 선택하고 편집해
          <br />
          AI에게 전달할 Context를 정밀하게 제어하세요
        </p>

        <div className="mt-6 flex flex-wrap justify-center gap-1.5">
          {FEATURES.map((f) => (
            <span
              key={f}
              className="rounded-full border border-line px-2.5 py-1 text-[11px] text-txt-2"
            >
              {f}
            </span>
          ))}
        </div>

        <GoogleLoginButton />
        {import.meta.env.DEV && import.meta.env.VITE_DEV_LOGIN_ENABLED === 'true' && (
          <DevelopmentLoginButton />
        )}

        {error && <p className="mt-3 text-[12px] text-red">{error}</p>}
      </div>
    </div>
  )
}

// Cursor 내장 브라우저에서 로컬 개발 계정으로 진입하는 버튼
function DevelopmentLoginButton() {
  const loginForDevelopment = useAuthStore((s) => s.loginForDevelopment)
  const [pending, setPending] = useState(false)

  const login = async () => {
    setPending(true)
    await loginForDevelopment()
    setPending(false)
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        disabled={pending}
        onClick={() => void login()}
        className="w-[300px] rounded-full border border-line-strong py-2.5 text-[12.5px] font-semibold text-txt-1 transition hover:bg-bg-2 disabled:opacity-40"
      >
        {pending ? '로그인 중...' : '로컬 개발 로그인'}
      </button>
      <p className="mt-1.5 text-[10.5px] text-txt-3">로컬 개발 환경에서만 사용할 수 있습니다.</p>
    </div>
  )
}

// Google 로그인 버튼 — 구글이 제공하는 공식 버튼을 그린다
function GoogleLoginButton() {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  const loginWithGoogle = useAuthStore((s) => s.loginWithGoogle)
  const holder = useRef<HTMLDivElement>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!clientId || !holder.current) return
    renderGoogleButton(holder.current, clientId, (idToken) => {
      void loginWithGoogle(idToken)
    }).catch((e: Error) => setLoadError(e.message))
  }, [clientId, loginWithGoogle])

  if (!clientId) {
    return (
      <p className="mt-7 rounded-lg bg-bg-2 p-3 text-[11.5px] leading-relaxed text-orange">
        Google 클라이언트 ID가 없어 로그인할 수 없습니다.
        <br />
        <span className="text-txt-2">
          frontend/.env의 VITE_GOOGLE_CLIENT_ID를 채워주세요.
        </span>
      </p>
    )
  }

  return (
    <div className="mt-7">
      <div ref={holder} className="flex justify-center" />
      {loadError && <p className="mt-2 text-[11.5px] text-red">{loadError}</p>}
    </div>
  )
}
