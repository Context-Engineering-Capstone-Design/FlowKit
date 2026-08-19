import axios from 'axios'
import type {
  ClientErrorContext,
  ClientErrorResponse,
  ClientErrorType,
} from '@/types/api'

const CLIENT_ERROR_TIMEOUT_MS = 5_000
const ACCESS_TOKEN_KEY = 'flowkit_access_token'
const baseURL = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000'

export interface ClientErrorInput {
  clientErrorType: ClientErrorType
  message: string
  pageContext?: ClientErrorContext
}

/** 공통 API 인터셉터를 거치지 않아 오류 수집 실패가 다시 수집되지 않는다. */
export async function submitClientError(
  input: ClientErrorInput,
): Promise<ClientErrorResponse> {
  const token =
    typeof localStorage === 'undefined'
      ? null
      : localStorage.getItem(ACCESS_TOKEN_KEY)
  const { data } = await axios.post<ClientErrorResponse>(
    `${baseURL}/api/client-errors`,
    input,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      timeout: CLIENT_ERROR_TIMEOUT_MS,
    },
  )
  return data
}
