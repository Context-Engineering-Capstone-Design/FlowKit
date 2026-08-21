"""채팅·브랜치 라우터 (2.2 채팅 관리, 2.3 브랜치 관리)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Query
from sqlalchemy import select
from sqlalchemy.orm import joinedload

from app.deps import CurrentUser, DbSession
from app.models import AppliedContextLog
from app.schemas.message import AppliedContextOut
from app.schemas.chat import (
    BranchDetailResponse,
    BranchListItem,
    BranchMeta,
    ChatDetailResponse,
    ChatListResponse,
    ChatMeta,
    ChatSummary,
    CreateChatRequest,
    CreateBranchRequest,
    CreateBranchResponse,
    CreateChatResponse,
    DeleteChatResponse,
    MessageBlockOut,
    SourceContextItem,
    UpdateTitleRequest,
    UpdateChatTitleResponse,
)
from app.schemas.notification import ActionMeta
from app.services import ai_response_service, branch_service, chat_service, project_service

router = APIRouter(prefix="/api/chats", tags=["Chat"])


def _applied_context_by_block(db, user_blocks) -> dict[uuid.UUID, list[AppliedContextOut]]:
    """화면에 표시 중인 사용자 메시지 버전의 Context 스니펫을 일괄 조회한다."""
    version_to_block = {
        block.current_version_id: block.id
        for block in user_blocks
        if block.current_version_id is not None
    }
    if not version_to_block:
        return {}
    logs = db.scalars(
        select(AppliedContextLog)
        .where(AppliedContextLog.message_block_version_id.in_(version_to_block))
        .options(joinedload(AppliedContextLog.items))
    ).unique()
    return {
        version_to_block[log.message_block_version_id]: [
            AppliedContextOut(
                block_id=item.source_block_id,
                version_id=item.version_id,
                order_index=item.order_index,
                content=item.content,
                start_offset=item.start_offset,
                end_offset=item.end_offset,
            )
            for item in log.items
        ]
        for log in logs
    }


def _block_list(db, blocks) -> list[MessageBlockOut]:
    """진행 중 작업과 마지막 실패 생성 작업을 화면 복구용으로 함께 실어 보낸다."""
    # 생성 스레드는 별도 세션에서 블록·작업 상태를 확정한다. 개발 서버와 테스트의
    # 요청 세션이 이전 객체를 잡고 있어도, 상세 조회는 반드시 DB의 마지막 상태를
    # 직렬화해야 한다.
    db.expire_all()
    generating_ids = [b.id for b in blocks if b.generation_status.value == "generating"]
    job_by_block = ai_response_service.generating_job_ids_for_blocks(db, generating_ids)
    user_blocks = [b for b in blocks if b.role.value == "user"]
    applied_context_by_block = _applied_context_by_block(db, user_blocks)
    retry_job_by_user_block = ai_response_service.retryable_failed_job_ids_for_user_blocks(
        db, [b.id for b in user_blocks]
    )
    return [
        MessageBlockOut.of(
            b,
            generation_job_id=job_by_block.get(b.id),
            applied_context=applied_context_by_block.get(b.id),
            retry_ai_response_job_id=retry_job_by_user_block.get(b.id),
        )
        for b in blocks
    ]


def _branch_list(db, chat, active_branch_id: uuid.UUID) -> list[BranchListItem]:
    return [
        BranchListItem(
            **BranchMeta.of(b).model_dump(),
            is_active=(b.id == active_branch_id),
        )
        for b in branch_service.list_branches(db, chat)
    ]


@router.post("", response_model=CreateChatResponse, status_code=201)
def create_chat(user: CurrentUser, db: DbSession, payload: CreateChatRequest | None = None) -> CreateChatResponse:
    """, 002: 새 채팅 + Main 브랜치 생성 후 초기 화면 상태를 돌려준다."""
    project_id = payload.project_id if payload else None
    if project_id:
        project_service.get_owned_project(db, user, project_id)
    chat, main_branch = chat_service.create_chat_with_main_branch(db, user, project_id)
    return CreateChatResponse(
        chat_meta=ChatMeta.of(chat),
        branch_meta=BranchMeta.of(main_branch),
        message_blocks=[],
        branch_list=_branch_list(db, chat, main_branch.id),
        action_meta=ActionMeta(
            action_type="chat_create",
            success_code="CHAT_CREATED",
            message="새 채팅을 만들었습니다.",
            affected_resource_id=chat.id,
        ),
    )


@router.get("", response_model=ChatListResponse)
def list_chats(
    user: CurrentUser,
    db: DbSession,
    cursor: str | None = None,
    limit: int = Query(chat_service.DEFAULT_LIMIT, ge=1, le=chat_service.MAX_LIMIT),
    keyword: str | None = None,
) -> ChatListResponse:
    """, 006: 최근 대화 목록 및 제목 검색."""
    chats, next_cursor = chat_service.list_chats(
        db, user, cursor=cursor, limit=limit, keyword=keyword
    )
    activity = chat_service.list_chat_activity_states(db, user, chats)
    return ChatListResponse(chats=[ChatSummary.of(c, is_generating=activity[c.id][0], has_unseen_completion=activity[c.id][1]) for c in chats], next_cursor=next_cursor)


@router.get("/{chat_id}", response_model=ChatDetailResponse)
def get_chat(
    chat_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    branch_id: uuid.UUID | None = Query(None, alias="branchId"),
) -> ChatDetailResponse:
    """채팅 상세. branchId 를 주지 않으면 Main 브랜치를 연다."""
    chat = chat_service.get_owned_chat(db, user, chat_id)
    chat_service.mark_chat_seen(db, user, chat)
    branch = (
        branch_service.get_branch_with_legacy_compatibility(db, chat, branch_id)
        if branch_id
        else branch_service.get_main_branch(db, chat)
    )
    blocks = branch_service.resolve_blocks(db, branch)
    return ChatDetailResponse(
        chat_meta=ChatMeta.of(chat),
        branch_meta=BranchMeta.of(branch),
        message_blocks=_block_list(db, blocks),
        branch_list=_branch_list(db, chat, branch.id),
    )


@router.delete("/{chat_id}", response_model=DeleteChatResponse)
def delete_chat(
    chat_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> DeleteChatResponse:
    """채팅과 하위 데이터를 실제로 삭제한다."""
    chat = chat_service.get_owned_chat(db, user, chat_id)
    chat_service.delete_chat(db, chat)
    return DeleteChatResponse(
        delete_success=True,
        action_meta=ActionMeta(
            action_type="chat_delete",
            success_code="CHAT_DELETED",
            message="대화를 삭제했습니다.",
            affected_resource_id=chat_id,
        ),
    )


@router.patch("/{chat_id}/title", response_model=UpdateChatTitleResponse)
def update_title(
    chat_id: uuid.UUID,
    payload: UpdateTitleRequest,
    user: CurrentUser,
    db: DbSession,
) -> UpdateChatTitleResponse:
    """AI가 생성한 제목을 검증 후 저장한다."""
    chat = chat_service.get_owned_chat(db, user, chat_id)
    updated = chat_service.update_title(db, chat, payload.generated_title)
    meta = ChatMeta.of(updated)
    return UpdateChatTitleResponse(
        **meta.model_dump(),
        action_meta=ActionMeta(
            action_type="chat_title_update",
            success_code="CHAT_TITLE_UPDATED",
            message="채팅 제목을 수정했습니다.",
            affected_resource_id=updated.id,
        ),
    )


@router.get("/{chat_id}/branches", response_model=list[BranchListItem])
def list_branches(
    chat_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> list[BranchListItem]:
    """브랜치 목록. Main 이 항상 맨 앞."""
    chat = chat_service.get_owned_chat(db, user, chat_id)
    main = branch_service.get_main_branch(db, chat)
    return _branch_list(db, chat, main.id)


@router.get("/{chat_id}/branches/{branch_id}", response_model=BranchDetailResponse)
def get_branch(
    chat_id: uuid.UUID, branch_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> BranchDetailResponse:
    """브랜치 전환. 출발 Context 와 원본 위치 정보를 함께 준다."""
    chat = chat_service.get_owned_chat(db, user, chat_id)
    branch = branch_service.get_branch_with_legacy_compatibility(db, chat, branch_id)
    blocks = branch_service.resolve_blocks(db, branch)
    info = branch_service.build_source_context_info(db, branch)
    return BranchDetailResponse(
        branch_meta=BranchMeta.of(branch),
        message_blocks=_block_list(db, blocks),
        source_context_info=[SourceContextItem(**item) for item in info],
    )


@router.post(
    "/{chat_id}/branches", response_model=CreateBranchResponse, status_code=201
)
def create_branch(
    chat_id: uuid.UUID,
    payload: CreateBranchRequest,
    user: CurrentUser,
    db: DbSession,
) -> CreateBranchResponse:
    """, 004, 005: 선택 Context 기반 브랜치 생성."""
    chat = chat_service.get_owned_chat(db, user, chat_id)
    result = branch_service.create_branch(
        db,
        user,
        chat,
        branch_name=payload.branch_name,
        base_branch_id=payload.base_branch_id,
        base_message_block_id=payload.base_message_block_id,
        context_block_ids=payload.context_block_ids,
        edited_base_content=payload.edited_base_content,
    )
    branch = result.branch
    meta = BranchMeta.of(branch)
    return CreateBranchResponse(
        **meta.model_dump(),
        source_context_ref_id=result.source_context_id,
        action_meta=ActionMeta(
            action_type="branch_create",
            success_code="BRANCH_CREATED",
            message="새 브랜치를 만들었습니다.",
            affected_resource_id=branch.id,
        ),
    )
