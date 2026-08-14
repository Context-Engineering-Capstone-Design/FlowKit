import { Layers } from 'lucide-react'
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

        {error && <p className="mt-3 text-[12px] text-red">{error}</p>}

        <p className="mt-4 text-[11px] text-txt-3">
          계정 정보는 이 기기에만 저장됩니다
        </p>
      </div>
    </div>
  )
}

// Google 로그인 버튼 — 실제 로그인은 Google 클라이언트 ID 설정 후 동작한다
function GoogleLoginButton() {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  const configured = Boolean(clientId)

  return (
    <div className="mt-7">
      <button
        type="button"
        disabled={!configured}
        className="w-full rounded-lg bg-bg-3 py-3 text-[13px] font-semibold transition hover:bg-bg-4 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Google로 계속하기
      </button>
      {!configured && (
        <p className="mt-2 text-[11px] leading-relaxed text-orange">
          Google 클라이언트 ID가 설정되지 않았습니다.
          <br />
          frontend/.env의 VITE_GOOGLE_CLIENT_ID를 채워주세요.
        </p>
      )}
    </div>
  )
}
