export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

export interface RequestTaskContext {
  requestId: string
  signal: AbortSignal
}

export class RequestTimeoutError extends Error {
  readonly code = 'REQUEST_TIMEOUT'
  readonly timeoutMs: number

  constructor(timeoutMs: number) {
    super('요청 시간이 초과되었습니다.')
    this.name = 'RequestTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

/**
 * 요청을 정해진 시간까지만 기다리고, 시간이 지나면 가능한 작업은 취소한다.
 * 반환된 requestId는 화면에서 최신 요청인지 비교할 때 사용할 수 있다.
 */
export async function withRequestTimeout<T>(
  task: (context: RequestTaskContext) => Promise<T>,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController()
  const requestId = crypto.randomUUID()
  let timer: ReturnType<typeof setTimeout> | null = null

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new RequestTimeoutError(timeoutMs))
      controller.abort('request-timeout')
    }, timeoutMs)
  })

  try {
    return await Promise.race([task({ requestId, signal: controller.signal }), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function isRequestTimeout(error: unknown): boolean {
  return error instanceof RequestTimeoutError
}
