import { FolderPlus, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import * as projectApi from '@/api/project'
import type { ProjectDetail, ProjectSummary } from '@/types/api'

// Project 목록과 지침·메모리·Library 자료를 한곳에서 관리하는 설정 창
export function ProjectManager({ onClose, chatId, initialProjectId = null }: { onClose: () => void; chatId: string | null; initialProjectId?: string | null }) {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [selected, setSelected] = useState<ProjectDetail | null>(null)
  const [name, setName] = useState('')
  const [instructions, setInstructions] = useState('')
  const [memory, setMemory] = useState('')
  const [resourceTitle, setResourceTitle] = useState('')
  const [resourceContent, setResourceContent] = useState('')
  const refresh = async () => setProjects(await projectApi.fetchProjects())
  useEffect(() => { void refresh() }, [])
  useEffect(() => { if (initialProjectId) void select(initialProjectId) }, [initialProjectId])
  async function select(id: string) { const item = await projectApi.fetchProject(id); setSelected(item); setName(item.name); setInstructions(item.instructions) }
  async function create() { const item = await projectApi.createProject('새 Project'); await refresh(); await select(item.projectId) }
  async function save() { if (!selected || !name.trim()) return; await projectApi.updateProject(selected.projectId, name, instructions); await select(selected.projectId); await refresh() }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-label="Project 관리">
    <section className="flex h-[min(680px,90vh)] w-[min(900px,100%)] overflow-hidden rounded-xl bg-bg-1 shadow-2xl">
      <aside className="w-52 shrink-0 border-r border-bg-3 p-3"><div className="mb-3 flex items-center justify-between"><span className="font-semibold">Projects</span><button onClick={() => void create()} title="Project 만들기"><FolderPlus className="h-4 w-4" /></button></div>{projects.map(p => <button key={p.projectId} onClick={() => void select(p.projectId)} className={`block w-full rounded px-2 py-2 text-left text-sm ${selected?.projectId === p.projectId ? 'bg-bg-3' : ''}`}>{p.name}<span className="float-right text-xs text-txt-3">{p.chatCount}</span></button>)}</aside>
      <main className="min-w-0 flex-1 overflow-y-auto p-5"><div className="mb-4 flex justify-end"><button onClick={onClose} aria-label="닫기"><X className="h-4 w-4" /></button></div>{selected ? <><input value={name} onChange={e => setName(e.target.value)} className="mb-3 w-full bg-transparent text-xl font-semibold outline-none" aria-label="Project 이름"/><textarea value={instructions} onChange={e => setInstructions(e.target.value)} placeholder="Project 지침" className="h-24 w-full rounded bg-bg-2 p-3 text-sm outline-none"/><button onClick={() => void save()} className="mt-2 rounded bg-blue px-3 py-1.5 text-sm text-white">저장</button>{chatId && <button onClick={async () => { await projectApi.moveChat(chatId, selected.projectId); await refresh() }} className="ml-2 text-sm">현재 대화 이동</button>}<h3 className="mt-6 font-semibold">메모리</h3><div className="flex gap-2 py-2"><input value={memory} onChange={e => setMemory(e.target.value)} placeholder="본문 메모" className="flex-1 rounded bg-bg-2 p-2 text-sm"/><button onClick={async () => { if (!memory.trim()) return; await projectApi.addMemory(selected.projectId, memory); setMemory(''); await select(selected.projectId) }}>추가</button></div>{selected.memories.map(m => <p key={m.memoryId} className="flex justify-between border-b border-bg-3 py-2 text-sm">{m.content}<button onClick={async () => { await projectApi.removeMemory(selected.projectId, m.memoryId); await select(selected.projectId) }}><Trash2 className="h-3.5 w-3.5" /></button></p>)}<h3 className="mt-6 font-semibold">Library 자료</h3><input value={resourceTitle} onChange={e => setResourceTitle(e.target.value)} placeholder="자료 제목" className="mt-2 w-full rounded bg-bg-2 p-2 text-sm"/><textarea value={resourceContent} onChange={e => setResourceContent(e.target.value)} placeholder="자료 내용" className="mt-2 h-20 w-full rounded bg-bg-2 p-2 text-sm"/><button onClick={async () => { if (!resourceTitle.trim() || !resourceContent.trim()) return; await projectApi.addResource(selected.projectId, resourceTitle, resourceContent); setResourceTitle(''); setResourceContent(''); await select(selected.projectId) }} className="mt-2 text-sm">자료 추가</button>{selected.libraryResources.map(r => <p key={r.resourceId} className="flex justify-between border-b border-bg-3 py-2 text-sm"><span>{r.title}</span><button onClick={async () => { await projectApi.removeResource(selected.projectId, r.resourceId); await select(selected.projectId) }}><Trash2 className="h-3.5 w-3.5" /></button></p>)}<button onClick={async () => { if (!confirm('Project 설정·메모리·자료를 삭제합니다. 대화는 Project 밖에 그대로 남습니다.')) return; await projectApi.deleteProject(selected.projectId); setSelected(null); await refresh() }} className="mt-8 text-sm text-red">Project 삭제</button></> : <p className="text-sm text-txt-3">왼쪽에서 Project를 고르거나 새로 만드세요.</p>}</main>
    </section>
  </div>
}
