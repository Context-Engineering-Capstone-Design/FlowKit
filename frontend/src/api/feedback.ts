import { api } from './client'
export async function submitFeedback(feedbackType: string, content: string, contextInfo?: Record<string, string | null>) { const { data } = await api.post('/api/settings/feedback', { feedbackType, content, contextInfo }); return data }
