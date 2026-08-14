"""메시지 블록 서비스 (BE-MSG-001 ~ BE-MSG-008)."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.exceptions import (
    MessageBlockNotFoundError,
    ValidationError,
)
from app.models import (
    Branch,
    Chat,
    MessageBlock,
    MessageBlockVersion,
    MessageRole,
    VersionSourceType,
)
from app.services import branch_service

MAX_CONTENT_LENGTH = 100_000


@dataclass(frozen=True)
class ActiveTurn:
    """AI 입력으로 넘길 활성 메시지 한 줄 (BE-MSG-007)."""

    block_id: uuid.UUID
    role: MessageRole
    content: str
    version_id: uuid.UUID | None
    order_index: int


def create_block(
    db: Session,
    chat: Chat,
    branch: Branch,
    role: MessageRole,
    content: str,
    source_type: VersionSourceType = VersionSourceType.ORIGINAL,
) -> MessageBlock:
    """메시지 블록과 최초 버전을 함께 만든다 (BE-MSG-001)."""
    text = (content or "").strip()
    if not text:
        raise ValidationError("내용이 비어 있습니다.")
    if len(text) > MAX_CONTENT_LENGTH:
        raise ValidationError("내용이 너무 깁니다.")

    block = MessageBlock(
        chat_id=chat.id,
        branch_id=branch.id,
        role=role,
        order_index=branch_service.next_order_index(db, branch),
    )
    db.add(block)
    db.flush()

    version = MessageBlockVersion(
        block_id=block.id, version_no=1, content=text, source_type=source_type
    )
    db.add(version)
    db.flush()

    block.current_version_id = version.id
    chat.last_activity_at = datetime.now(UTC)
    db.commit()
    db.refresh(block)
    return block


def get_visible_block(
    db: Session, branch: Branch, block_id: uuid.UUID
) -> MessageBlock:
    """브랜치 화면에 보이는 블록을 가져온다 (BE-MSG-008).

    참조형 브랜치라 화면에 보이는 블록이 조상 브랜치 소유일 수 있다. 읽기·선택
    검증은 '보이는지'만 따진다.
    """
    for block in branch_service.resolve_blocks(db, branch):
        if block.id == block_id:
            return block
    raise MessageBlockNotFoundError()


def get_editable_block(
    db: Session, branch: Branch, block_id: uuid.UUID
) -> MessageBlock:
    """이 브랜치가 직접 소유한 블록만 돌려준다.

    상속받은 블록은 조상 브랜치의 것이다. 그 활성 버전을 바꾸면 원본 대화까지
    같이 바뀌므로 수정을 막는다(NFR-007). 사용자는 원본 브랜치에서 고치거나
    수정본으로 새 브랜치를 만들어야 한다(REQ-019).
    """
    block = get_visible_block(db, branch, block_id)
    if block.branch_id != branch.id:
        raise ValidationError(
            "다른 브랜치에서 이어받은 메시지는 이 브랜치에서 수정할 수 없습니다. "
            "원본 브랜치에서 수정하거나 수정본으로 새 브랜치를 만들어주세요."
        )
    return block


def validate_selection(
    db: Session, branch: Branch, block_ids: list[uuid.UUID]
) -> tuple[list[uuid.UUID], list[uuid.UUID]]:
    """선택된 블록이 지금도 유효한지 확인한다 (BE-MSG-003).

    선택 상태 자체는 화면이 들고 있으므로, 실행 요청 시점에만 확인한다.
    """
    visible = {b.id for b in branch_service.resolve_blocks(db, branch)}
    valid = [bid for bid in block_ids if bid in visible]
    invalid = [bid for bid in block_ids if bid not in visible]
    return valid, invalid


def save_edit(
    db: Session,
    chat: Chat,
    branch: Branch,
    block_id: uuid.UUID,
    edited_content: str,
) -> MessageBlock:
    """수정본을 새 버전으로 저장하고 활성화한다 (BE-MSG-004).

    기존 버전은 지우지 않는다. 되돌리기는 활성 버전 포인터를 옮기는 방식이다.
    """
    text = (edited_content or "").strip()
    if not text:
        raise ValidationError("내용이 비어 있습니다.")
    if len(text) > MAX_CONTENT_LENGTH:
        raise ValidationError("내용이 너무 깁니다.")

    block = get_editable_block(db, branch, block_id)
    return add_version(
        db, chat, block, text, source_type=VersionSourceType.USER_EDIT
    )


def add_version(
    db: Session,
    chat: Chat,
    block: MessageBlock,
    content: str,
    source_type: VersionSourceType,
) -> MessageBlock:
    """새 버전을 추가하고 활성 버전으로 삼는다.

    정제 승인(BE-REFINE-005)과 답변 재생성(BE-AIRESP-003)도 이 경로를 쓴다.
    """
    last_no = db.scalar(
        select(MessageBlockVersion.version_no)
        .where(MessageBlockVersion.block_id == block.id)
        .order_by(MessageBlockVersion.version_no.desc())
        .limit(1)
    )
    version = MessageBlockVersion(
        block_id=block.id,
        version_no=(last_no or 0) + 1,
        content=content,
        source_type=source_type,
    )
    db.add(version)
    db.flush()

    block.current_version_id = version.id
    chat.last_activity_at = datetime.now(UTC)
    db.commit()
    db.refresh(block)
    return block


def list_versions(
    db: Session, branch: Branch, block_id: uuid.UUID
) -> list[MessageBlockVersion]:
    """버전 이력 조회 (BE-MSG-005). 정제 승인 후 이전 내용을 확인할 때 쓴다."""
    block = get_visible_block(db, branch, block_id)
    return list(
        db.scalars(
            select(MessageBlockVersion)
            .where(MessageBlockVersion.block_id == block.id)
            .order_by(MessageBlockVersion.version_no)
        ).all()
    )


def set_active_version(
    db: Session,
    chat: Chat,
    branch: Branch,
    block_id: uuid.UUID,
    target_version_id: uuid.UUID,
) -> MessageBlock:
    """활성 버전을 옮긴다 (BE-MSG-006). 이력은 그대로 둔다."""
    block = get_editable_block(db, branch, block_id)

    version = db.get(MessageBlockVersion, target_version_id)
    if version is None or version.block_id != block.id:
        raise MessageBlockNotFoundError("해당 버전을 찾을 수 없습니다.")

    block.current_version_id = version.id
    chat.last_activity_at = datetime.now(UTC)
    db.commit()
    db.refresh(block)
    return block


def active_message_flow(db: Session, branch: Branch) -> list[ActiveTurn]:
    """AI 입력으로 넘길 활성 메시지 흐름 (BE-MSG-007).

    화면이 들고 있는 값이 아니라 서버의 현재 활성 버전을 기준으로 구성한다.
    """
    turns = []
    for block in branch_service.resolve_blocks(db, branch):
        version = block.current_version
        if version is None:
            continue
        turns.append(
            ActiveTurn(
                block_id=block.id,
                role=block.role,
                content=version.content,
                version_id=version.id,
                order_index=block.order_index,
            )
        )
    return turns
