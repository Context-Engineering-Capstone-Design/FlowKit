"""채팅·브랜치 라우터 (2.2 채팅 관리, 2.3 브랜치 관리)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Query

from app.deps import CurrentUser, DbSession
from app.schemas.chat import (
    BranchDetailResponse,
    BranchListItem,
    BranchMeta,
    ChatDetailResponse,
    ChatListResponse,
    ChatMeta,
    ChatSummary,
    CreateBranchRequest,
    MessageBlockOut,
    SourceContextItem,
    UpdateTitleRequest,
)
from app.services import branch_service, chat_service

router = APIRouter(prefix="/api/chats", tags=["Chat"])


def _branch_list(db, chat, active_branch_id: uuid.UUID) -> list[BranchListItem]:
    return [
        BranchListItem(
            **BranchMeta.of(b).model_dump(),
            is_active=(b.id == active_branch_id),
        )
        for b in branch_service.list_branches(db, chat)
    ]


@router.post("", response_model=ChatDetailResponse, status_code=201)
def create_chat(user: CurrentUser, db: DbSession) -> ChatDetailResponse:
    """BE-CHAT-001, 002: 새 채팅 + Main 브랜치 생성 후 초기 화면 상태를 돌려준다."""
    chat, main_branch = chat_service.create_chat_with_main_branch(db, user)
    return ChatDetailResponse(
        chat_meta=ChatMeta.of(chat),
        branch_meta=BranchMeta.of(main_branch),
        message_blocks=[],
        branch_list=_branch_list(db, chat, main_branch.id),
    )


@router.get("", response_model=ChatListResponse)
def list_chats(
    user: CurrentUser,
    db: DbSession,
    cursor: str | None = None,
    limit: int = Query(chat_service.DEFAULT_LIMIT, ge=1, le=chat_service.MAX_LIMIT),
    keyword: str | None = None,
) -> ChatListResponse:
    """BE-CHAT-003, 006: 최근 대화 목록 및 제목 검색."""
    chats, next_cursor = chat_service.list_chats(
        db, user, cursor=cursor, limit=limit, keyword=keyword
    )
    return ChatListResponse(
        chats=[ChatSummary.of(c) for c in chats], next_cursor=next_cursor
    )


@router.get("/{chat_id}", response_model=ChatDetailResponse)
def get_chat(
    chat_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    branch_id: uuid.UUID | None = Query(None, alias="branchId"),
) -> ChatDetailResponse:
    """BE-CHAT-005: 채팅 상세. branchId 를 주지 않으면 Main 브랜치를 연다."""
    chat = chat_service.get_owned_chat(db, user, chat_id)
    branch = (
        branch_service.get_branch_in_chat(db, chat, branch_id)
        if branch_id
        else branch_service.get_main_branch(db, chat)
    )
    blocks = branch_service.resolve_blocks(db, branch)
    return ChatDetailResponse(
        chat_meta=ChatMeta.of(chat),
        branch_meta=BranchMeta.of(branch),
        message_blocks=[MessageBlockOut.of(b) for b in blocks],
        branch_list=_branch_list(db, chat, branch.id),
    )


@router.patch("/{chat_id}/title", response_model=ChatMeta)
def update_title(
    chat_id: uuid.UUID,
    payload: UpdateTitleRequest,
    user: CurrentUser,
    db: DbSession,
) -> ChatMeta:
    """BE-CHAT-004: AI가 생성한 제목을 검증 후 저장한다."""
    chat = chat_service.get_owned_chat(db, user, chat_id)
    updated = chat_service.update_title(db, chat, payload.generated_title)
    return ChatMeta.of(updated)


@router.get("/{chat_id}/branches", response_model=list[BranchListItem])
def list_branches(
    chat_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> list[BranchListItem]:
    """BE-BRANCH-001: 브랜치 목록. Main 이 항상 맨 앞."""
    chat = chat_service.get_owned_chat(db, user, chat_id)
    main = branch_service.get_main_branch(db, chat)
    return _branch_list(db, chat, main.id)


@router.get("/{chat_id}/branches/{branch_id}", response_model=BranchDetailResponse)
def get_branch(
    chat_id: uuid.UUID, branch_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> BranchDetailResponse:
    """BE-BRANCH-002: 브랜치 전환. 출발 Context 와 원본 위치 정보를 함께 준다."""
    chat = chat_service.get_owned_chat(db, user, chat_id)
    branch = branch_service.get_branch_in_chat(db, chat, branch_id)
    blocks = branch_service.resolve_blocks(db, branch)
    info = branch_service.build_source_context_info(db, branch)
    return BranchDetailResponse(
        branch_meta=BranchMeta.of(branch),
        message_blocks=[MessageBlockOut.of(b) for b in blocks],
        source_context_info=[SourceContextItem(**item) for item in info],
    )


@router.post("/{chat_id}/branches", response_model=BranchMeta, status_code=201)
def create_branch(
    chat_id: uuid.UUID,
    payload: CreateBranchRequest,
    user: CurrentUser,
    db: DbSession,
) -> BranchMeta:
    """BE-BRANCH-003, 004, 005: 선택 Context 기반 브랜치 생성."""
    chat = chat_service.get_owned_chat(db, user, chat_id)
    branch = branch_service.create_branch(
        db,
        user,
        chat,
        branch_name=payload.branch_name,
        base_branch_id=payload.base_branch_id,
        base_message_block_id=payload.base_message_block_id,
        context_block_ids=payload.context_block_ids,
        edited_base_content=payload.edited_base_content,
    )
    return BranchMeta.of(branch)
