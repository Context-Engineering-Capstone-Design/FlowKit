from __future__ import annotations

import uuid
from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field

from app.models import Project, ProjectLibraryResource, ProjectMemory
from app.schemas.notification import ActionMeta


class ProjectSummary(BaseModel):
    project_id: uuid.UUID = Field(..., serialization_alias="projectId")
    name: str
    chat_count: int = Field(0, serialization_alias="chatCount")
    model_config = ConfigDict(populate_by_name=True)

    @classmethod
    def of(cls, project: Project, chat_count: int = 0):
        return cls(project_id=project.id, name=project.name, chat_count=chat_count)


class ProjectMemoryOut(BaseModel):
    memory_id: uuid.UUID = Field(..., serialization_alias="memoryId")
    content: str
    created_at: datetime = Field(..., serialization_alias="createdAt")
    model_config = ConfigDict(populate_by_name=True)
    @classmethod
    def of(cls, item: ProjectMemory): return cls(memory_id=item.id, content=item.content, created_at=item.created_at)


class ProjectLibraryResourceOut(BaseModel):
    resource_id: uuid.UUID = Field(..., serialization_alias="resourceId")
    title: str
    content: str
    source_url: str | None = Field(None, serialization_alias="sourceUrl")
    model_config = ConfigDict(populate_by_name=True)
    @classmethod
    def of(cls, item: ProjectLibraryResource): return cls(resource_id=item.id, title=item.title, content=item.content, source_url=item.source_url)


class ProjectDetail(ProjectSummary):
    instructions: str
    memories: list[ProjectMemoryOut] = []
    library_resources: list[ProjectLibraryResourceOut] = Field(default_factory=list, serialization_alias="libraryResources")


class CreateProjectRequest(BaseModel):
    name: str
    instructions: str = ""


class UpdateProjectRequest(CreateProjectRequest):
    pass


class ProjectActionResponse(ProjectDetail):
    action_meta: ActionMeta = Field(..., serialization_alias="actionMeta")


class MemoryRequest(BaseModel):
    content: str


class ResourceRequest(BaseModel):
    title: str
    content: str
    source_url: str | None = Field(None, alias="sourceUrl")
    model_config = ConfigDict(populate_by_name=True)


class MoveChatRequest(BaseModel):
    project_id: uuid.UUID | None = Field(None, alias="projectId")
    model_config = ConfigDict(populate_by_name=True)
