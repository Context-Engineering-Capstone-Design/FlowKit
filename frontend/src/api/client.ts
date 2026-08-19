import axios, { AxiosError, type AxiosRequestConfig } from 'axios'
import type { ApiError, TokenResponse } from '@/types/api'

const ACCESS_KEY = 'flowkit_access_token'
const REFRESH_KEY = 'flowkit_refresh_token'
export const AUTH_EXPIRED_EVENT = 'flowkit:auth-expired'

export const tokenStore = {
  get access() {
    return localStorage.getItem(ACCESS_KEY)
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY)
  },
  save(accessToken: string, refreshToken: string) {
    localStorage.setItem(ACCESS_KEY, accessToken)
    localStorage.setItem(REFRESH_KEY, refreshToken)
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY)
    localStorage.removeItem(REFRESH_KEY)
  },
}

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000',
})

api.interceptors.request.use((config) => {
  const token = tokenStore.access
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

/**
 * 재발급은 한 번에 하나만 진행한다.
 *
 * 서버가 refreshToken 을 회전시키기 때문에, 요청 여러 개가 동시에 만료를 만나
 * 각자 재발급을 부르면 두 번째부터는 이미 폐기된 토큰을 보내게 된다. 서버는 이를
 * 탈취로 보고 모든 세션을 끊으므로 사용자가 갑자기 로그아웃된다.
 */
let refreshing: Promise<string | null> | null = null

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = tokenStore.refresh
  if (!refreshToken) return null

  try {
    const { data } = await axios.post<TokenResponse>(
      `${api.defaults.baseURL}/api/auth/refresh`,
      { refreshToken },
    )
    tokenStore.save(data.accessToken, data.refreshToken)
    return data.accessToken
  } catch {
    tokenStore.clear()
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
    return null
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiError>) => {
    const original = error.config as AxiosRequestConfig & { _retried?: boolean }

    const shouldRefresh =
      error.response?.status === 401 &&
      original &&
      !original._retried &&
      !original.url?.includes('/api/auth/refresh')

    if (!shouldRefresh) return Promise.reject(error)

    original._retried = true
    refreshing ??= refreshAccessToken().finally(() => {
      refreshing = null
    })

    const newToken = await refreshing
    if (!newToken) return Promise.reject(error)

    original.headers = { ...original.headers, Authorization: `Bearer ${newToken}` }
    return api(original)
  },
)

/** 백엔드 오류 형식에서 사용자에게 보여줄 메시지를 꺼낸다. */
export function toErrorMessage(error: unknown): string {
  if (axios.isAxiosError<ApiError>(error) && error.response?.data?.message) {
    return error.response.data.message
  }
  return '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.'
}

export function errorCode(error: unknown): string | null {
  if (axios.isAxiosError<ApiError>(error)) {
    return error.response?.data?.errorCode ?? null
  }
  return null
}

export function errorDetail<T>(error: unknown): T | null {
  if (axios.isAxiosError<ApiError>(error)) return (error.response?.data?.detail as T | undefined) ?? null
  return null
}
