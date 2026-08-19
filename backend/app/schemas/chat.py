from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models import Branch, Chat, MessageBlock


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
    role: str
    content: str
    current_version_id: uuid.UUID | None = Field(
        None, serialization_alias="currentVersionId"
    )
    version_no: int | None = Field(None, serialization_alias="versionNo")
    order_index: int = Field(..., serialization_alias="orderIndex")
    created_at: datetime = Field(..., serialization_alias="createdAt")

    model_config = ConfigDict(populate_by_name=True)

    @classmethod
    def of(cls, block: MessageBlock) -> MessageBlockOut:
        version = block.current_version
        return cls(
            block_id=block.id,
            role=block.role.value,
            content=version.content if version else "",
            current_version_id=block.current_version_id,
            version_no=version.version_no if version else None,
            order_index=block.order_index,
            created_at=block.created_at,
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


class UpdateTitleRequest(BaseModel):
    generated_title: str = Field(..., alias="generatedTitle")

    model_config = ConfigDict(populate_by_name=True)


class SourceContextItem(BaseModel):
    context_block_id: str = Field(..., serialization_alias="contextBlockId")
    preview_text: str = Field(..., serialization_alias="previewText")
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

    model_config = ConfigDict(populate_by_name=True)
