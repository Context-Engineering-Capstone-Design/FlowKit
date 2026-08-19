import axios from 'axios'
import { submitClientError } from '@/api/observability'
import type { ClientErrorContext, ClientErrorType } from '@/types/api'

const EXPECTED_CLIENT_STATUSES = new Set([400, 401, 403, 404, 409, 422, 429])
const CLIENT_ERROR_TYPES = new Set<ClientErrorType>([
  'window_error',
  'unhandled_rejection',
  'react_render_error',
  'api_response_error',
])
const CONTEXT_KEYS = new Set<keyof ClientErrorContext>([
  'page',
  'feature',
  'chatId',
  'branchId',
  'resourceId',
])

/** 민감정보와 긴 입력을 제거한 뒤, 수집 요청의 실패는 조용히 끝낸다. */
export function reportClientError(
  clientErrorType: ClientErrorType | string,
  error: unknown,
  pageContext?: Record<string, string | null>,
) {
  if (!shouldReport(error)) return

  void submitClientError({
    clientErrorType: normalizeErrorType(clientErrorType),
    message: safeErrorMessage(error),
    pageContext: safeContext(pageContext),
  }).catch(() => undefined)
}

export function reportUnexpectedApiResponse(
  endpoint: string,
  contentType: string,
) {
  reportClientError(
    'api_response_error',
    `Unexpected API response type: ${contentType || 'unknown'}`,
    { feature: stripQuery(endpoint) },
  )
}

function shouldReport(error: unknown): boolean {
  if (axios.isCancel(error)) return false
  if (!axios.isAxiosError(error)) return true
  if (error.code === 'ERR_CANCELED') return false
  if (!error.response) {
    return typeof navigator === 'undefined' || navigator.onLine
  }
  return !EXPECTED_CLIENT_STATUSES.has(error.response.status)
}

function safeErrorMessage(error: unknown): string {
  let message = 'Unknown client error'
  if (error instanceof Error) message = error.message
  else if (typeof error === 'string') message = error
  else if (error !== null && error !== undefined) {
    message = Object.prototype.toString.call(error)
  }
  return maskSensitiveText(message).slice(0, 500)
}

function safeContext(
  context?: Record<string, string | null>,
): ClientErrorContext | undefined {
  if (!context) return undefined
  const safe: Record<string, string> = {}
  for (const [key, value] of Object.entries(context)) {
    if (!CONTEXT_KEYS.has(key as keyof ClientErrorContext) || value === null) continue
    safe[key] = maskSensitiveText(String(value)).slice(0, 100)
  }
  return Object.keys(safe).length > 0 ? safe : undefined
}

function normalizeErrorType(value: string): ClientErrorType {
  const normalized = value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_')
  return CLIENT_ERROR_TYPES.has(normalized as ClientErrorType)
    ? (normalized as ClientErrorType)
    : 'window_error'
}

function stripQuery(value: string): string {
  return value.split(/[?#]/, 1)[0].slice(0, 100)
}

function maskSensitiveText(value: string): string {
  return value
    .replace(/Bearer\s+\S+/gi, '[redacted]')
    .replace(/AIza[\w-]{20,}/g, '[redacted]')
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[redacted]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[redacted]')
    .replace(
      /(["']?(?:access[_-]?token|refresh[_-]?token|api[_-]?key|password|secret)["']?\s*[:=]\s*)["']?[^\s,"'}&]+/gi,
      '$1[redacted]',
    )
}
