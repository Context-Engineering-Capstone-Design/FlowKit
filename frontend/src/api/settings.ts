import { api } from './client'
import type {
  ApiKeyStatus,
  DeleteApiKeyResponse,
  UserSettingResponse,
} from '@/types/api'

export async function fetchSettings(): Promise<UserSettingResponse> {
  const { data } = await api.get<UserSettingResponse>('/api/settings')
  return data
}

export async function saveApiKey(apiKey: string): Promise<ApiKeyStatus> {
  const { data } = await api.put<ApiKeyStatus>('/api/settings/api-keys/google', {
    apiKey,
  })
  return data
}

export async function deleteApiKey(): Promise<DeleteApiKeyResponse> {
  const { data } = await api.delete<DeleteApiKeyResponse>(
    '/api/settings/api-keys/google',
  )
  return data
}

export async function checkApiKey(): Promise<ApiKeyStatus> {
  const { data } = await api.post<ApiKeyStatus>(
    '/api/settings/api-keys/google/check',
  )
  return data
}
