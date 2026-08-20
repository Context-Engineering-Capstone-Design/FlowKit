import { api } from './client'
import type {
  ApiKeyStatus,
  DeleteApiKeyResponse,
  UserSettingResponse,
} from '@/types/api'

export async function fetchSettings(signal?: AbortSignal): Promise<UserSettingResponse> {
  const { data } = await api.get<UserSettingResponse>('/api/settings', { signal })
  return data
}

export async function saveApiKey(apiKey: string, signal?: AbortSignal): Promise<ApiKeyStatus> {
  const { data } = await api.put<ApiKeyStatus>('/api/settings/api-keys/openai', {
    apiKey,
  }, { signal })
  return data
}

export async function deleteApiKey(signal?: AbortSignal): Promise<DeleteApiKeyResponse> {
  const { data } = await api.delete<DeleteApiKeyResponse>(
    '/api/settings/api-keys/openai',
    { signal },
  )
  return data
}

export async function checkApiKey(signal?: AbortSignal): Promise<ApiKeyStatus> {
  const { data } = await api.post<ApiKeyStatus>(
    '/api/settings/api-keys/openai/check',
    undefined,
    { signal },
  )
  return data
}
