from __future__ import annotations
import uuid
from fastapi import APIRouter
from app.deps import CurrentUser, DbSession
from app.schemas.notification import ActionMeta
from app.schemas.project import (CreateProjectRequest, MemoryRequest, MoveChatRequest, ProjectActionResponse, ProjectDetail, ProjectLibraryResourceOut, ProjectMemoryOut, ProjectSummary, ResourceRequest, UpdateProjectRequest)
from app.services import chat_service, project_service
from app.exceptions import ChatNotFoundError
from app.models import ProjectLibraryResource, ProjectMemory

router = APIRouter(prefix="/api/projects", tags=["Project"])

def detail(db, project, action=None):
    count, memories, resources = project_service.project_detail(db, project)
    data = dict(project_id=project.id, name=project.name, chat_count=count, instructions=project.instructions, memories=[ProjectMemoryOut.of(x) for x in memories], library_resources=[ProjectLibraryResourceOut.of(x) for x in resources])
    return ProjectActionResponse(**data, action_meta=action) if action else ProjectDetail(**data)

@router.get("", response_model=list[ProjectSummary])
def list_projects(user: CurrentUser, db: DbSession): return [ProjectSummary.of(p, count) for p, count in project_service.list_projects(db, user)]

@router.post("", response_model=ProjectActionResponse, status_code=201)
def create_project(payload: CreateProjectRequest, user: CurrentUser, db: DbSession):
    p = project_service.create_project(db, user, payload.name, payload.instructions)
    return detail(db, p, ActionMeta(action_type="project_create", success_code="PROJECT_CREATED", message="Project를 만들었습니다.", affected_resource_id=p.id))

@router.get("/{project_id}", response_model=ProjectDetail)
def get_project(project_id: uuid.UUID, user: CurrentUser, db: DbSession): return detail(db, project_service.get_owned_project(db, user, project_id))

@router.patch("/{project_id}", response_model=ProjectActionResponse)
def update_project(project_id: uuid.UUID, payload: UpdateProjectRequest, user: CurrentUser, db: DbSession):
    p = project_service.update_project(db, project_service.get_owned_project(db, user, project_id), payload.name, payload.instructions)
    return detail(db, p, ActionMeta(action_type="project_update", success_code="PROJECT_UPDATED", message="Project를 수정했습니다.", affected_resource_id=p.id))

@router.delete("/{project_id}")
def delete_project(project_id: uuid.UUID, user: CurrentUser, db: DbSession):
    p = project_service.get_owned_project(db, user, project_id); project_service.delete_project(db, p)
    return {"deleteSuccess": True}

@router.post("/{project_id}/memories", response_model=ProjectMemoryOut, status_code=201)
def add_memory(project_id: uuid.UUID, payload: MemoryRequest, user: CurrentUser, db: DbSession): return ProjectMemoryOut.of(project_service.add_memory(db, project_service.get_owned_project(db, user, project_id), payload.content))

@router.patch("/{project_id}/memories/{memory_id}", response_model=ProjectMemoryOut)
def update_memory(project_id: uuid.UUID, memory_id: uuid.UUID, payload: MemoryRequest, user: CurrentUser, db: DbSession): return ProjectMemoryOut.of(project_service.update_memory(db, project_service.get_owned_project(db, user, project_id), memory_id, payload.content))

@router.delete("/{project_id}/memories/{memory_id}")
def delete_memory(project_id: uuid.UUID, memory_id: uuid.UUID, user: CurrentUser, db: DbSession):
    p = project_service.get_owned_project(db, user, project_id); item = db.get(ProjectMemory, memory_id)
    if item is None or item.project_id != p.id: raise ChatNotFoundError("메모리를 찾을 수 없습니다.")
    db.delete(item); db.commit(); return {"deleteSuccess": True}

@router.post("/{project_id}/library-resources", response_model=ProjectLibraryResourceOut, status_code=201)
def add_resource(project_id: uuid.UUID, payload: ResourceRequest, user: CurrentUser, db: DbSession): return ProjectLibraryResourceOut.of(project_service.add_resource(db, project_service.get_owned_project(db, user, project_id), payload.title, payload.content, payload.source_url))

@router.patch("/{project_id}/library-resources/{resource_id}", response_model=ProjectLibraryResourceOut)
def update_resource(project_id: uuid.UUID, resource_id: uuid.UUID, payload: ResourceRequest, user: CurrentUser, db: DbSession): return ProjectLibraryResourceOut.of(project_service.update_resource(db, project_service.get_owned_project(db, user, project_id), resource_id, payload.title, payload.content, payload.source_url))

@router.delete("/{project_id}/library-resources/{resource_id}")
def delete_resource(project_id: uuid.UUID, resource_id: uuid.UUID, user: CurrentUser, db: DbSession):
    p = project_service.get_owned_project(db, user, project_id)
    item = db.get(ProjectLibraryResource, resource_id)
    if item is None or item.project_id != p.id: raise ChatNotFoundError("Library 자료를 찾을 수 없습니다.")
    db.delete(item); db.commit(); return {"deleteSuccess": True}

@router.patch("/chats/{chat_id}")
def move_chat(chat_id: uuid.UUID, payload: MoveChatRequest, user: CurrentUser, db: DbSession):
    chat = chat_service.get_owned_chat(db, user, chat_id); chat = project_service.move_chat(db, user, chat, payload.project_id)
    return {"chatId": str(chat.id), "projectId": str(chat.project_id) if chat.project_id else None}
