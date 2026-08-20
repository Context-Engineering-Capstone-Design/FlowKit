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
    is_generating: bool = Field(False, serialization_alias="isGenerating")
    has_unseen_completion: bool = Field(False, serialization_alias="hasUnseenCompletion")
    project_id: uuid.UUID | None = Field(None, serialization_alias="projectId")

    model_config = ConfigDict(populate_by_name=True)

    @classmethod
    def of(cls, chat: Chat, *, is_generating: bool = False, has_unseen_completion: bool = False) -> ChatSummary:
        return cls(chat_id=chat.id, title=chat.title, is_generating=is_generating, has_unseen_completion=has_unseen_completion, project_id=chat.project_id)


class CreateChatRequest(BaseModel):
    project_id: uuid.UUID | None = Field(None, alias="projectId")
    model_config = ConfigDict(populate_by_name=True)


class ChatListResponse(BaseModel):
    chats: list[ChatSummary]
    next_cursor: str | None = Field(None, serialization_alias="nextCursor")

    model_config = ConfigDict(populate_by_name=True)


class ChatMeta(BaseModel):
    chat_id: uuid.UUID = Field(..., serialization_alias="chatId")
    title: str
    created_at: datetime = Field(..., serialization_alias="createdAt")
    # 사이드 채팅 트리 (0820_08). 메인 채팅은 kind만 채워지고 나머지는 비어 있다.
    kind: Literal["MAIN", "SIDE"] = "MAIN"
    parent_chat_id: uuid.UUID | None = Field(None, serialization_alias="parentChatId")
    parent_branch_id: uuid.UUID | None = Field(None, serialization_alias="parentBranchId")
    parent_message_block_id: uuid.UUID | None = Field(
        None, serialization_alias="parentMessageBlockId"
    )
    root_chat_id: uuid.UUID | None = Field(None, serialization_alias="rootChatId")
    root_branch_id: uuid.UUID | None = Field(None, serialization_alias="rootBranchId")
    is_temporary: bool = Field(False, serialization_alias="isTemporary")
    project_id: uuid.UUID | None = Field(None, serialization_alias="projectId")

    model_config = ConfigDict(populate_by_name=True)

    @classmethod
    def of(cls, chat: Chat) -> ChatMeta:
        return cls(
            chat_id=chat.id,
            title=chat.title,
            created_at=chat.created_at,
            kind=chat.kind.value,
            parent_chat_id=chat.parent_chat_id,
            parent_branch_id=chat.parent_branch_id,
            parent_message_block_id=chat.parent_message_block_id,
            root_chat_id=chat.root_chat_id,
            root_branch_id=chat.root_branch_id,
            is_temporary=chat.is_temporary,
            project_id=chat.project_id,
        )


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
    # generating일 때만 채워진다. 새로고침·브랜치 재진입 시 이 값으로 스트리밍
    # 통로에 다시 붙는다(BE-AIRESP-009).
    generation_job_id: uuid.UUID | None = Field(None, serialization_alias="generationJobId")

    model_config = ConfigDict(populate_by_name=True)

    @classmethod
    def of(cls, block: MessageBlock, generation_job_id: uuid.UUID | None = None) -> MessageBlockOut:
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
            generation_job_id=generation_job_id,
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
    branch_name: str = Field("", alias="branchName")
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


class CreateSideChatRequest(BaseModel):
    """지정한 지점에서 사이드 채팅을 만든다 (0820_08 A3).

    anchorMessageBlockId 를 비우면 요청 시점의 부모 최신 메시지를 생성 시점으로 쓴다.
    """

    anchor_message_block_id: uuid.UUID | None = Field(
        None, alias="anchorMessageBlockId"
    )
    title: str | None = None
    is_temporary: bool = Field(False, alias="isTemporary")

    model_config = ConfigDict(populate_by_name=True)


class CreateSideChatResponse(ChatDetailResponse):
    action_meta: ActionMeta = Field(..., serialization_alias="actionMeta")


class SideChatSummary(BaseModel):
    """좌측 트리 그래프의 노드 하나 (0820_08 A2, B3)."""

    chat_id: uuid.UUID = Field(..., serialization_alias="chatId")
    title: str
    kind: Literal["MAIN", "SIDE"]
    parent_chat_id: uuid.UUID | None = Field(None, serialization_alias="parentChatId")
    parent_branch_id: uuid.UUID | None = Field(None, serialization_alias="parentBranchId")
    parent_message_block_id: uuid.UUID | None = Field(
        None, serialization_alias="parentMessageBlockId"
    )
    root_chat_id: uuid.UUID | None = Field(None, serialization_alias="rootChatId")
    is_temporary: bool = Field(False, serialization_alias="isTemporary")

    model_config = ConfigDict(populate_by_name=True)

    @classmethod
    def of(cls, chat: Chat) -> SideChatSummary:
        return cls(
            chat_id=chat.id,
            title=chat.title,
            kind=chat.kind.value,
            parent_chat_id=chat.parent_chat_id,
            parent_branch_id=chat.parent_branch_id,
            parent_message_block_id=chat.parent_message_block_id,
            root_chat_id=chat.root_chat_id,
            is_temporary=chat.is_temporary,
        )


class SideChatTreeResponse(BaseModel):
    root_chat_id: uuid.UUID | None = Field(None, serialization_alias="rootChatId")
    chats: list[SideChatSummary]

    model_config = ConfigDict(populate_by_name=True)


class ImportBlocksRequest(BaseModel):
    """사이드 채팅의 질문·답변을 부모(메인) 채팅 메시지로 가져온다 (0820_08 C2)."""

    block_ids: list[uuid.UUID] = Field(..., alias="blockIds")

    model_config = ConfigDict(populate_by_name=True)


class ImportBlocksResponse(BaseModel):
    imported_blocks: list[MessageBlockOut] = Field(..., serialization_alias="importedBlocks")
    action_meta: ActionMeta = Field(..., serialization_alias="actionMeta")

    model_config = ConfigDict(populate_by_name=True)
