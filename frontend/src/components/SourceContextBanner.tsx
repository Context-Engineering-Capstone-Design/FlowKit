import { GitBranch, X } from 'lucide-react'
import { toPreview } from '@/lib/preview'
import { useChatStore } from '@/store/chatStore'

// 브랜치 상단 배너 — 현재 브랜치를 알리고, 출발 Context가 있으면 함께 보여준다 (REQ-011, REQ-012)
export function SourceContextBanner() {
  const sourceContext = useChatStore((s) => s.sourceContext)
  const branches = useChatStore((s) => s.branches)
  const jumpToSource = useChatStore((s) => s.jumpToSource)
  const navigationError = useChatStore((s) => s.sourceNavigationError)
  const clearNavigationError = useChatStore((s) => s.clearSourceNavigationError)

  const active = branches.find((b) => b.isActive)
  // Context를 고르지 않고도 브랜치를 만들 수 있어, 출발 Context가 없어도
  // 지금 보고 있는 브랜치가 무엇인지는 항상 알 수 있어야 한다
  if (!active || active.branchType === 'MAIN') {
    return null
  }

  return (
    <div className="mx-5 mb-3 rounded-lg border border-green/30 bg-green-dim px-3.5 py-3">
      <p className="flex items-center gap-1.5 text-[12px] font-semibold text-green">
        <GitBranch className="h-3.5 w-3.5" />
        현재 브랜치: {active.branchName}
      </p>
      {navigationError && <div className="mt-2 flex items-center gap-2 text-[11px] text-red"><span>{navigationError}</span><button type="button" onClick={clearNavigationError} aria-label="안내 닫기"><X className="h-3 w-3" /></button></div>}

      {sourceContext.length > 0 && (
        <>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-txt-2">
            아래 {sourceContext.length}개 Context를 기반으로 시작된 대화입니다.
          </p>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {sourceContext.map((c) => (
              <button
                key={c.contextBlockId}
                type="button"
                onClick={() => void jumpToSource(c)}
                title="원본 위치로 이동"
                className="max-w-[260px] truncate rounded-full bg-bg-2 px-2.5 py-1 text-[11px] text-txt-1 transition hover:bg-bg-3 hover:text-txt-0"
              >
                <span className={c.role === 'user' ? 'text-blue' : 'text-green'}>
                  {c.role === 'user' ? 'User' : 'AI'}
                </span>{' '}
                {toPreview(c.previewText)}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
