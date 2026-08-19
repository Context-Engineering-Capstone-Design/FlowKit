import { api } from './client'
import type {
  ServiceFeedbackContext,
  ServiceFeedbackResponse,
  ServiceFeedbackType,
} from '@/types/api'

export async function submitFeedback(
  feedbackType: ServiceFeedbackType,
  content: string,
  contextInfo?: ServiceFeedbackContext,
): Promise<ServiceFeedbackResponse> {
  const safeContext = contextInfo
    ? {
        page: contextInfo.page?.slice(0, 200),
        chatId: contextInfo.chatId?.slice(0, 200),
        branchId: contextInfo.branchId?.slice(0, 200),
      }
    : undefined
  const { data } = await api.post<ServiceFeedbackResponse>(
    '/api/settings/feedback',
    { feedbackType, content, contextInfo: safeContext },
  )
  return data
}
