"""메시지 블록 라우터 (2.4 메시지 블록 관리)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter

from app.deps import CurrentUser, DbSession
from app.models import MessageRole
from app.schemas.message import (
    BlockResponse,
    CreateBlockRequest,
    EditBlockRequest,
    SetActiveVersionRequest,
    ValidateSelectionRequest,
    ValidateSelectionResponse,
    VersionResponse,
)
from app.services import branch_service, chat_service, message_service

router = APIRouter(
    prefix="/api/chats/{chat_id}/branches/{branch_id}/blocks", tags=["MessageBlock"]
)


def _load(db, user, chat_id: uuid.UUID, branch_id: uuid.UUID):
    chat = chat_service.get_owned_chat(db, user, chat_id)
    branch = branch_service.get_branch_in_chat(db, chat, branch_id)
    return chat, branch


@router.post("", response_model=BlockResponse, status_code=201)
def create_block(
    chat_id: uuid.UUID,
    branch_id: uuid.UUID,
    payload: CreateBlockRequest,
    user: CurrentUser,
    db: DbSession,
) -> BlockResponse:
    """BE-MSG-001: 사용자 질문 또는 AI 응답을 블록으로 저장한다."""
    chat, branch = _load(db, user, chat_id, branch_id)
    block = message_service.create_block(
        db, chat, branch, MessageRole(payload.role), payload.content
    )
    return BlockResponse.of(block)


@router.post("/validate", response_model=ValidateSelectionResponse)
def validate_selection(
    chat_id: uuid.UUID,
    branch_id: uuid.UUID,
    payload: ValidateSelectionRequest,
    user: CurrentUser,
    db: DbSession,
) -> ValidateSelectionResponse:
    """BE-MSG-003: 정제·적용·브랜치 생성 실행 직전에 선택이 유효한지 확인한다."""
    _, branch = _load(db, user, chat_id, branch_id)
    valid, invalid = message_service.validate_selection(
        db, branch, payload.selected_block_ids
    )
    return ValidateSelectionResponse(
        valid_block_ids=valid, invalid_block_ids=invalid, selected_count=len(valid)
    )


@router.patch("/{block_id}", response_model=BlockResponse)
def edit_block(
    chat_id: uuid.UUID,
    branch_id: uuid.UUID,
    block_id: uuid.UUID,
    payload: EditBlockRequest,
    user: CurrentUser,
    db: DbSession,
) -> BlockResponse:
    """BE-MSG-004: 수정본을 새 버전으로 저장하고 활성화한다."""
    chat, branch = _load(db, user, chat_id, branch_id)
    block = message_service.save_edit(
        db, chat, branch, block_id, payload.edited_content
    )
    return BlockResponse.of(block)


@router.get("/{block_id}/versions", response_model=list[VersionResponse])
def list_versions(
    chat_id: uuid.UUID,
    branch_id: uuid.UUID,
    block_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
) -> list[VersionResponse]:
    """BE-MSG-005: 버전 이력 조회."""
    _, branch = _load(db, user, chat_id, branch_id)
    versions = message_service.list_versions(db, branch, block_id)
    block = message_service.get_visible_block(db, branch, block_id)
    return [VersionResponse.of(v, block.current_version_id) for v in versions]


@router.patch("/{block_id}/version", response_model=BlockResponse)
def set_active_version(
    chat_id: uuid.UUID,
    branch_id: uuid.UUID,
    block_id: uuid.UUID,
    payload: SetActiveVersionRequest,
    user: CurrentUser,
    db: DbSession,
) -> BlockResponse:
    """BE-MSG-006: 활성 버전 변경. 되돌리기도 이 경로를 쓴다."""
    chat, branch = _load(db, user, chat_id, branch_id)
    block = message_service.set_active_version(
        db, chat, branch, block_id, payload.target_version_id
    )
    return BlockResponse.of(block)
