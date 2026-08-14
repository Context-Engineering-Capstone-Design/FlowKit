import { useEffect, useState } from 'react'
import { api } from '@/api/client'

// 앱 최상단 틀 — 현재는 백엔드 연결 상태만 확인하는 임시 화면
export default function App() {
  const [status, setStatus] = useState<'확인 중' | '연결됨' | '연결 실패'>('확인 중')

  useEffect(() => {
    api
      .get('/health')
      .then(() => setStatus('연결됨'))
      .catch(() => setStatus('연결 실패'))
  }, [])

  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-txt-0">FlowKit</h1>
        <p className="mt-2 text-sm text-txt-2">
          백엔드 연결: <span className="text-accent">{status}</span>
        </p>
      </div>
    </div>
  )
}
