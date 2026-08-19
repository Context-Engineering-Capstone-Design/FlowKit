from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.notification import ActionMeta


class ModelOut(BaseModel):
    model_id: str = Field(..., serialization_alias="modelId")
    display_name: str = Field(..., serialization_alias="displayName")
    provider: str
    supports_web_search: bool = Field(..., serialization_alias="supportsWebSearch")
    supports_attachment: bool = Field(..., serialization_alias="supportsAttachment")
    is_default: bool = Field(..., serialization_alias="isDefault")
    is_available: bool = Field(True, serialization_alias="isAvailable")

    model_config = ConfigDict(populate_by_name=True)


class AttachmentOut(BaseModel):
    attachment_id: uuid.UUID = Field(..., serialization_alias="attachmentId")
    file_name: str = Field(..., serialization_alias="fileName")
    mime_type: str = Field(..., serialization_alias="mimeType")
    file_size: int = Field(..., serialization_alias="fileSize")
    status: str
    expires_at: datetime | None = Field(None, serialization_alias="expiresAt")

    model_config = ConfigDict(populate_by_name=True)


class AttachmentMutationResponse(AttachmentOut):
    action_meta: ActionMeta = Field(..., serialization_alias="actionMeta")


class DeleteAttachmentResponse(BaseModel):
    delete_success: bool = Field(..., serialization_alias="deleteSuccess")
    attachment_id: uuid.UUID = Field(..., serialization_alias="attachmentId")
    action_meta: ActionMeta = Field(..., serialization_alias="actionMeta")

    model_config = ConfigDict(populate_by_name=True)


class SearchSourceOut(BaseModel):
    title: str
    url: str

    model_config = ConfigDict(populate_by_name=True)
