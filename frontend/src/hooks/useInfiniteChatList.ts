import { useEffect, useRef } from 'react'

/** 목록 끝이 가까워지면 다음 cursor 페이지를 한 번 요청한다. */
export function useInfiniteChatList(
  hasMore: boolean,
  isLoading: boolean,
  loadMore: () => Promise<void>,
) {
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const target = sentinelRef.current
    if (!target || !hasMore || isLoading) return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) void loadMore()
    }, { rootMargin: '120px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [hasMore, isLoading, loadMore])

  return sentinelRef
}
