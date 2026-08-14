import { GitBranch } from 'lucide-react'
import { toPreview } from '@/lib/preview'
import { useChatStore } from '@/store/chatStore'

// 브랜치 상단 출발 Context 배너 — 어떤 내용에서 갈라져 나왔는지 보여준다 (REQ-011, REQ-012)
export function SourceContextBanner() {
  const sourceContext = useChatStore((s) => s.sourceContext)
  const branches = useChatStore((s) => s.branches)
  const jumpToSource = useChatStore((s) => s.jumpToSource)

  const active = branches.find((b) => b.isActive)
  if (!active || active.branchType === 'MAIN' || sourceContext.length === 0) {
    return null
  }

  return (
    <div className="mx-5 mb-3 rounded-lg border border-green/30 bg-green-dim px-3.5 py-3">
      <p className="flex items-center gap-1.5 text-[12px] font-semibold text-green">
        <GitBranch className="h-3.5 w-3.5" />
        현재 브랜치: {active.branchName}
      </p>
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
            {toPreview(c.previewText)}
          </button>
        ))}
      </div>
    </div>
  )
}
