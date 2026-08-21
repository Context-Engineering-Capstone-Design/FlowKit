"""메시지 블록 라우터 (2.4 메시지 블록 관리)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter

from app.deps import CurrentUser, DbSession
from app.models import MessageRole
from app.schemas.message import (
    AppliedContextOut,
    BlockMutationResponse,
    BlockResponse,
    CreateBlockRequest,
    EditBlockRequest,
    SetActiveVersionRequest,
    ValidateSelectionRequest,
    ValidateSelectionResponse,
    VersionResponse,
)
from app.schemas.notification import ActionMeta
from app.services import branch_service, chat_service, context_service, message_service

router = APIRouter(
    prefix="/api/chats/{chat_id}/branches/{branch_id}/blocks", tags=["MessageBlock"]
)


def _load(db, user, chat_id: uuid.UUID, branch_id: uuid.UUID):
    chat = chat_service.get_owned_chat(db, user, chat_id)
    branch = branch_service.get_branch_in_chat(db, chat, branch_id)
    return chat, branch


def _mutation_response(db, block, action_type: str, success_code: str, message: str):
    items = context_service.applied_items_for_version(db, block.current_version_id)
    response = BlockResponse.of(block, [
        AppliedContextOut(
            block_id=item.block_id,
            version_id=item.version_id,
            order_index=item.order_index,
            content=item.content,
            start_offset=item.start_offset,
            end_offset=item.end_offset,
        )
        for item in items
    ])
    return BlockMutationResponse(
        **response.model_dump(),
        action_meta=ActionMeta(
            action_type=action_type,
            success_code=success_code,
            message=message,
            affected_resource_id=block.id,
        ),
    )


@router.post("", response_model=BlockMutationResponse, status_code=201)
def create_block(
    chat_id: uuid.UUID,
    branch_id: uuid.UUID,
    payload: CreateBlockRequest,
    user: CurrentUser,
    db: DbSession,
) -> BlockMutationResponse:
    """사용자 질문 또는 AI 응답을 블록으로 저장한다."""
    chat, branch = _load(db, user, chat_id, branch_id)
    block = message_service.create_block(
        db, chat, branch, MessageRole(payload.role), payload.content
    )
    return _mutation_response(
        db, block, "message_block_create", "MESSAGE_BLOCK_CREATED", "메시지를 추가했습니다."
    )


@router.post("/validate", response_model=ValidateSelectionResponse)
def validate_selection(
    chat_id: uuid.UUID,
    branch_id: uuid.UUID,
    payload: ValidateSelectionRequest,
    user: CurrentUser,
    db: DbSession,
) -> ValidateSelectionResponse:
    """정제·적용·브랜치 생성 실행 직전에 선택이 유효한지 확인한다."""
    _, branch = _load(db, user, chat_id, branch_id)
    valid, invalid = message_service.validate_selection(
        db, branch, payload.selected_block_ids
    )
    return ValidateSelectionResponse(
        valid_block_ids=valid, invalid_block_ids=invalid, selected_count=len(valid)
    )


@router.patch("/{block_id}", response_model=BlockMutationResponse)
def edit_block(
    chat_id: uuid.UUID,
    branch_id: uuid.UUID,
    block_id: uuid.UUID,
    payload: EditBlockRequest,
    user: CurrentUser,
    db: DbSession,
) -> BlockMutationResponse:
    """수정본을 새 버전으로 저장하고 활성화한다."""
    chat, branch = _load(db, user, chat_id, branch_id)
    block = message_service.save_edit(
        db, chat, branch, block_id, payload.edited_content, payload.context_ranges
    )
    return _mutation_response(
        db, block, "message_block_update", "MESSAGE_BLOCK_UPDATED", "메시지를 수정했습니다."
    )


@router.get("/{block_id}/versions", response_model=list[VersionResponse])
def list_versions(
    chat_id: uuid.UUID,
    branch_id: uuid.UUID,
    block_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
) -> list[VersionResponse]:
    """버전 이력 조회."""
    _, branch = _load(db, user, chat_id, branch_id)
    versions = message_service.list_versions(db, branch, block_id)
    block = message_service.get_visible_block(db, branch, block_id)
    return [VersionResponse.of(v, block.current_version_id) for v in versions]


@router.patch("/{block_id}/version", response_model=BlockMutationResponse)
def set_active_version(
    chat_id: uuid.UUID,
    branch_id: uuid.UUID,
    block_id: uuid.UUID,
    payload: SetActiveVersionRequest,
    user: CurrentUser,
    db: DbSession,
) -> BlockMutationResponse:
    """활성 버전 변경. 되돌리기도 이 경로를 쓴다."""
    chat, branch = _load(db, user, chat_id, branch_id)
    block = message_service.set_active_version(
        db, chat, branch, block_id, payload.target_version_id
    )
    return _mutation_response(
        db,
        block,
        "message_version_activate",
        "MESSAGE_VERSION_ACTIVATED",
        "메시지 버전을 변경했습니다.",
    )
