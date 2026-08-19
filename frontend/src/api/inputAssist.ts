import { api } from './client'
import type { AttachmentResponse, ModelOption } from '@/types/api'

export async function fetchModels(): Promise<ModelOption[]> {
  const { data } = await api.get<ModelOption[]>('/api/models')
  return data
}

export async function uploadAttachment(chatId: string, file: File): Promise<AttachmentResponse> {
  const body = new FormData()
  body.append('file', file)
  const { data } = await api.post<AttachmentResponse>(`/api/chats/${chatId}/attachments`, body)
  return data
}

export async function deleteAttachment(chatId: string, attachmentId: string): Promise<void> {
  await api.delete(`/api/chats/${chatId}/attachments/${attachmentId}`)
}
