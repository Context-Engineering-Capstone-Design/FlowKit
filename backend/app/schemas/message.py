from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models import MessageBlock, MessageBlockVersion
from app.schemas.input_assist import AttachmentOut, SearchSourceOut
from app.schemas.notification import ActionMeta


class CreateBlockRequest(BaseModel):
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str


class EditBlockRequest(BaseModel):
    edited_content: str = Field(..., alias="editedContent")

    model_config = ConfigDict(populate_by_name=True)


class SetActiveVersionRequest(BaseModel):
    target_version_id: uuid.UUID = Field(..., alias="targetVersionId")

    model_config = ConfigDict(populate_by_name=True)


class ValidateSelectionRequest(BaseModel):
    selected_block_ids: list[uuid.UUID] = Field(..., alias="selectedBlockIds")

    model_config = ConfigDict(populate_by_name=True)


class ValidateSelectionResponse(BaseModel):
    valid_block_ids: list[uuid.UUID] = Field(..., serialization_alias="validBlockIds")
    invalid_block_ids: list[uuid.UUID] = Field(
        ..., serialization_alias="invalidBlockIds"
    )
    selected_count: int = Field(..., serialization_alias="selectedCount")

    model_config = ConfigDict(populate_by_name=True)


class BlockResponse(BaseModel):
    block_id: uuid.UUID = Field(..., serialization_alias="blockId")
    branch_id: uuid.UUID = Field(..., serialization_alias="branchId")
    role: str
    content: str
    current_version_id: uuid.UUID | None = Field(
        None, serialization_alias="currentVersionId"
    )
    version_no: int | None = Field(None, serialization_alias="versionNo")
    order_index: int = Field(..., serialization_alias="orderIndex")
    created_at: datetime = Field(..., serialization_alias="createdAt")
    attachments: list[AttachmentOut] = Field(default_factory=list)
    search_sources: list[SearchSourceOut] = Field(
        default_factory=list, serialization_alias="searchSources"
    )
    # 생성 중/완료/중단됨/실패 (BE-AIRESP-007~009). 사용자 블록은 항상 complete.
    generation_status: str = Field(..., serialization_alias="generationStatus")

    model_config = ConfigDict(populate_by_name=True)

    @classmethod
    def of(cls, block: MessageBlock) -> BlockResponse:
        version = block.current_version
        return cls(
            block_id=block.id,
            branch_id=block.branch_id,
            role=block.role.value,
            content=version.content if version else "",
            current_version_id=block.current_version_id,
            version_no=version.version_no if version else None,
            order_index=block.order_index,
            created_at=block.created_at,
            generation_status=block.generation_status.value,
            attachments=[
                AttachmentOut(
                    attachment_id=link.attachment.id,
                    file_name=link.attachment.file_name,
                    mime_type=link.attachment.mime_type,
                    file_size=link.attachment.file_size,
                    status=link.attachment.status.value,
                    expires_at=link.attachment.expires_at,
                )
                for link in block.attachment_links
            ],
            search_sources=[
                SearchSourceOut(**item) for item in (version.search_sources if version else None) or []
            ],
        )


class BlockMutationResponse(BlockResponse):
    action_meta: ActionMeta = Field(..., serialization_alias="actionMeta")


class VersionResponse(BaseModel):
    version_id: uuid.UUID = Field(..., serialization_alias="versionId")
    version_no: int = Field(..., serialization_alias="versionNo")
    content: str
    source_type: str = Field(..., serialization_alias="sourceType")
    created_at: datetime = Field(..., serialization_alias="createdAt")
    is_current: bool = Field(..., serialization_alias="isCurrent")

    model_config = ConfigDict(populate_by_name=True)

    @classmethod
    def of(cls, version: MessageBlockVersion, current_id: uuid.UUID | None) -> VersionResponse:
        return cls(
            version_id=version.id,
            version_no=version.version_no,
            content=version.content,
            source_type=version.source_type.value,
            created_at=version.created_at,
            is_current=version.id == current_id,
        )
