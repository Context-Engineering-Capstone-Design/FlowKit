from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models import Branch, Chat, MessageBlock
from app.schemas.input_assist import AttachmentOut, SearchSourceOut
from app.schemas.notification import ActionMeta


class ChatSummary(BaseModel):
    """최근 대화 목록 항목. 정렬용 lastActivityAt 은 내부 필드라 노출하지 않는다."""

    chat_id: uuid.UUID = Field(..., serialization_alias="chatId")
    title: str

    model_config = ConfigDict(populate_by_name=True)

    @classmethod
    def of(cls, chat: Chat) -> ChatSummary:
        return cls(chat_id=chat.id, title=chat.title)


class ChatListResponse(BaseModel):
    chats: list[ChatSummary]
    next_cursor: str | None = Field(None, serialization_alias="nextCursor")

    model_config = ConfigDict(populate_by_name=True)


class ChatMeta(BaseModel):
    chat_id: uuid.UUID = Field(..., serialization_alias="chatId")
    title: str
    created_at: datetime = Field(..., serialization_alias="createdAt")

    model_config = ConfigDict(populate_by_name=True)

    @classmethod
    def of(cls, chat: Chat) -> ChatMeta:
        return cls(chat_id=chat.id, title=chat.title, created_at=chat.created_at)


class BranchMeta(BaseModel):
    branch_id: uuid.UUID = Field(..., serialization_alias="branchId")
    branch_name: str = Field(..., serialization_alias="branchName")
    branch_type: str = Field(..., serialization_alias="branchType")
    parent_branch_id: uuid.UUID | None = Field(
        None, serialization_alias="parentBranchId"
    )

    model_config = ConfigDict(populate_by_name=True)

    @classmethod
    def of(cls, branch: Branch) -> BranchMeta:
        return cls(
            branch_id=branch.id,
            branch_name=branch.name,
            branch_type=branch.branch_type.value,
            parent_branch_id=branch.parent_branch_id,
        )


class BranchListItem(BranchMeta):
    is_active: bool = Field(False, serialization_alias="isActive")


class MessageBlockOut(BaseModel):
    block_id: uuid.UUID = Field(..., serialization_alias="blockId")
    branch_id: uuid.UUID = Field(..., serialization_alias="branchId")
    role: Literal["user", "assistant"]
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
    def of(cls, block: MessageBlock) -> MessageBlockOut:
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


class ChatDetailResponse(BaseModel):
    """새 채팅 생성·상세 조회 공통 응답. FE가 화면을 바로 구성할 수 있는 형태."""

    chat_meta: ChatMeta = Field(..., serialization_alias="chatMeta")
    branch_meta: BranchMeta = Field(..., serialization_alias="branchMeta")
    message_blocks: list[MessageBlockOut] = Field(
        ..., serialization_alias="messageBlocks"
    )
    branch_list: list[BranchListItem] = Field(..., serialization_alias="branchList")

    model_config = ConfigDict(populate_by_name=True)


class CreateChatResponse(ChatDetailResponse):
    action_meta: ActionMeta = Field(..., serialization_alias="actionMeta")


class DeleteChatResponse(BaseModel):
    delete_success: bool = Field(..., serialization_alias="deleteSuccess")
    action_meta: ActionMeta = Field(..., serialization_alias="actionMeta")

    model_config = ConfigDict(populate_by_name=True)


class UpdateChatTitleResponse(ChatMeta):
    action_meta: ActionMeta = Field(..., serialization_alias="actionMeta")


class UpdateTitleRequest(BaseModel):
    generated_title: str = Field(..., alias="generatedTitle")

    model_config = ConfigDict(populate_by_name=True)


class SourceContextItem(BaseModel):
    context_block_id: str = Field(..., serialization_alias="contextBlockId")
    preview_text: str = Field(..., serialization_alias="previewText")
    role: Literal["user", "assistant"]
    source_message_block_id: str = Field(
        ..., serialization_alias="sourceMessageBlockId"
    )
    source_branch_id: str | None = Field(None, serialization_alias="sourceBranchId")
    scroll_target_index: int | None = Field(
        None, serialization_alias="scrollTargetIndex"
    )

    model_config = ConfigDict(populate_by_name=True)


class BranchDetailResponse(BaseModel):
    branch_meta: BranchMeta = Field(..., serialization_alias="branchMeta")
    message_blocks: list[MessageBlockOut] = Field(
        ..., serialization_alias="messageBlocks"
    )
    source_context_info: list[SourceContextItem] = Field(
        default_factory=list, serialization_alias="sourceContextInfo"
    )

    model_config = ConfigDict(populate_by_name=True)


class CreateBranchRequest(BaseModel):
    branch_name: str = Field(..., alias="branchName")
    base_branch_id: uuid.UUID = Field(..., alias="baseBranchId")
    base_message_block_id: uuid.UUID = Field(..., alias="baseMessageBlockId")
    context_block_ids: list[uuid.UUID] = Field(
        default_factory=list, alias="contextBlockIds"
    )
    edited_base_content: str | None = Field(None, alias="editedBaseContent")

    model_config = ConfigDict(populate_by_name=True)


class CreateBranchResponse(BranchMeta):
    source_context_ref_id: uuid.UUID = Field(
        ..., serialization_alias="sourceContextRefId"
    )
    action_meta: ActionMeta = Field(..., serialization_alias="actionMeta")
