from __future__ import annotations

import uuid
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.exceptions import ChatNotFoundError, ValidationError
from app.models import Chat, Project, ProjectLibraryResource, ProjectMemory, User
from app.models import ProjectLibrarySelection

MAX_NAME = 100

def _text(value: str, label: str, limit: int = 20000) -> str:
    value = (value or "").strip()
    if not value: raise ValidationError(f"{label}을 입력해주세요.")
    if len(value) > limit: raise ValidationError(f"{label}은 {limit}자를 넘을 수 없습니다.")
    return value

def get_owned_project(db: Session, user: User, project_id: uuid.UUID) -> Project:
    project = db.get(Project, project_id)
    if project is None or project.owner_id != user.id: raise ChatNotFoundError("Project를 찾을 수 없습니다.")
    return project

def list_projects(db: Session, user: User) -> list[tuple[Project, int]]:
    projects = list(db.scalars(select(Project).where(Project.owner_id == user.id).order_by(Project.updated_at.desc())).all())
    return [(p, db.scalar(select(func.count(Chat.id)).where(Chat.project_id == p.id)) or 0) for p in projects]

def create_project(db: Session, user: User, name: str, instructions: str = "") -> Project:
    project = Project(owner_id=user.id, name=_text(name, "Project 이름", MAX_NAME), instructions=(instructions or "").strip())
    db.add(project); db.commit(); db.refresh(project); return project

def update_project(db: Session, project: Project, name: str, instructions: str) -> Project:
    project.name = _text(name, "Project 이름", MAX_NAME); project.instructions = (instructions or "").strip(); db.commit(); db.refresh(project); return project

def project_detail(db: Session, project: Project):
    memories = list(db.scalars(select(ProjectMemory).where(ProjectMemory.project_id == project.id).order_by(ProjectMemory.order_index, ProjectMemory.created_at)).all())
    resources = list(db.scalars(select(ProjectLibraryResource).where(ProjectLibraryResource.project_id == project.id).order_by(ProjectLibraryResource.order_index, ProjectLibraryResource.created_at)).all())
    count = db.scalar(select(func.count(Chat.id)).where(Chat.project_id == project.id)) or 0
    return count, memories, resources

def add_memory(db: Session, project: Project, content: str) -> ProjectMemory:
    item = ProjectMemory(project_id=project.id, content=_text(content, "메모리"), order_index=db.scalar(select(func.count(ProjectMemory.id)).where(ProjectMemory.project_id == project.id)) or 0)
    db.add(item); db.commit(); db.refresh(item); return item

def update_memory(db: Session, project: Project, memory_id: uuid.UUID, content: str) -> ProjectMemory:
    item = db.get(ProjectMemory, memory_id)
    if item is None or item.project_id != project.id: raise ChatNotFoundError("메모리를 찾을 수 없습니다.")
    item.content = _text(content, "메모리"); db.commit(); db.refresh(item); return item

def add_resource(db: Session, project: Project, title: str, content: str, source_url: str | None) -> ProjectLibraryResource:
    item = ProjectLibraryResource(project_id=project.id, title=_text(title, "자료 제목", 200), content=_text(content, "자료 내용"), source_url=(source_url or "").strip() or None, order_index=db.scalar(select(func.count(ProjectLibraryResource.id)).where(ProjectLibraryResource.project_id == project.id)) or 0)
    db.add(item); db.commit(); db.refresh(item); return item

def update_resource(db: Session, project: Project, resource_id: uuid.UUID, title: str, content: str, source_url: str | None) -> ProjectLibraryResource:
    item = db.get(ProjectLibraryResource, resource_id)
    if item is None or item.project_id != project.id: raise ChatNotFoundError("Library 자료를 찾을 수 없습니다.")
    item.title, item.content, item.source_url = _text(title, "자료 제목", 200), _text(content, "자료 내용"), (source_url or "").strip() or None
    db.commit(); db.refresh(item); return item

def move_chat(db: Session, user: User, chat: Chat, project_id: uuid.UUID | None) -> Chat:
    project = get_owned_project(db, user, project_id) if project_id else None
    family = [chat] if chat.kind.value == "SIDE" else list(db.scalars(select(Chat).where((Chat.id == chat.id) | (Chat.root_chat_id == chat.id))).all())
    for item in family: item.project_id = project.id if project else None
    db.commit(); db.refresh(chat); return chat

def delete_project(db: Session, project: Project) -> None:
    # Project는 대화 폴더다. 삭제해도 대화·브랜치·사이드 채팅은 Project 밖에 보존한다.
    db.execute(
        Chat.__table__.update().where(Chat.project_id == project.id).values(project_id=None)
    )
    db.execute(delete(ProjectLibrarySelection).where(ProjectLibrarySelection.project_id == project.id))
    db.execute(delete(ProjectLibraryResource).where(ProjectLibraryResource.project_id == project.id))
    db.execute(delete(ProjectMemory).where(ProjectMemory.project_id == project.id))
    db.delete(project); db.commit()

def selected_library_context(db: Session, project: Project | None, resource_ids: list[uuid.UUID]) -> list[ProjectLibraryResource]:
    if project is None or not resource_ids:
        return []
    rows = list(db.scalars(select(ProjectLibraryResource).where(ProjectLibraryResource.project_id == project.id, ProjectLibraryResource.id.in_(resource_ids))).all())
    if len(rows) != len(set(resource_ids)):
        raise ValidationError("선택한 Library 자료를 찾을 수 없습니다.")
    by_id = {row.id: row for row in rows}
    return [by_id[resource_id] for resource_id in resource_ids]

def save_selected_library_context(db: Session, project: Project | None, user_block_id: uuid.UUID, resources: list[ProjectLibraryResource]) -> None:
    if project is None:
        return
    for index, resource in enumerate(resources):
        db.add(ProjectLibrarySelection(project_id=project.id, resource_id=resource.id, message_block_id=user_block_id, content=resource.content, order_index=index))
