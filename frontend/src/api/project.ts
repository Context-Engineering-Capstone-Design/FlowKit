import { api } from './client'
import type { ProjectDetail, ProjectLibraryResource, ProjectMemory, ProjectSummary } from '@/types/api'

export async function fetchProjects() { return (await api.get<ProjectSummary[]>('/api/projects')).data }
export async function createProject(name: string, instructions = '') { return (await api.post<ProjectDetail>('/api/projects', { name, instructions })).data }
export async function fetchProject(projectId: string) { return (await api.get<ProjectDetail>(`/api/projects/${projectId}`)).data }
export async function updateProject(projectId: string, name: string, instructions: string) { return (await api.patch<ProjectDetail>(`/api/projects/${projectId}`, { name, instructions })).data }
export async function deleteProject(projectId: string) { return (await api.delete<{ deleteSuccess: boolean }>(`/api/projects/${projectId}`)).data }
export async function addMemory(projectId: string, content: string) { return (await api.post<ProjectMemory>(`/api/projects/${projectId}/memories`, { content })).data }
export async function removeMemory(projectId: string, memoryId: string) { await api.delete(`/api/projects/${projectId}/memories/${memoryId}`) }
export async function addResource(projectId: string, title: string, content: string, sourceUrl?: string) { return (await api.post<ProjectLibraryResource>(`/api/projects/${projectId}/library-resources`, { title, content, sourceUrl })).data }
export async function removeResource(projectId: string, resourceId: string) { await api.delete(`/api/projects/${projectId}/library-resources/${resourceId}`) }
export async function moveChat(chatId: string, projectId: string | null) { await api.patch(`/api/projects/chats/${chatId}`, { projectId }) }
