import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reportClientError } from '@/lib/errorReporting'

interface Props { children: ReactNode }
interface State { failed: boolean }

// 렌더링 예외를 안전하게 보고하고, 빈 화면 대신 복구 안내를 보여준다
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportClientError('react_render_error', error, { page: window.location.pathname, feature: info.componentStack?.slice(0, 100) ?? null })
  }

  render() {
    if (this.state.failed) {
      return <div className="flex h-full flex-col items-center justify-center gap-3 text-[13px] text-txt-2"><p>화면을 표시하지 못했습니다.</p><button type="button" onClick={() => window.location.reload()} className="rounded bg-blue px-3 py-2 text-white">새로고침</button></div>
    }
    return this.props.children
  }
}
