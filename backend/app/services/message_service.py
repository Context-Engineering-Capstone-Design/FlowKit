"""메시지 블록 서비스 ."""

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
    BlockGenerationStatus,
    Chat,
    MessageBlock,
    MessageBlockVersion,
    MessageRole,
    VersionSourceType,
)
from app.schemas.message import ContextRangeIn
from app.services import branch_service

MAX_CONTENT_LENGTH = 100_000


@dataclass(frozen=True)
class ActiveTurn:
    """AI 입력으로 넘길 활성 메시지 한 줄 ."""

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
    commit: bool = True,
    search_sources: list[dict] | None = None,
    allow_empty: bool = False,
    generation_status: BlockGenerationStatus = BlockGenerationStatus.COMPLETE,
) -> MessageBlock:
    """메시지 블록과 최초 버전을 함께 만든다 .

    allow_empty는 스트리밍 답변 블록을 생성 시작과 동시에 만들 때만 쓴다
    . 아직 글자가 하나도 안 나온 상태라 본문이 비어 있다.
    """
    text = (content or "").strip()
    if not text and not allow_empty:
        raise ValidationError("내용이 비어 있습니다.")
    if len(text) > MAX_CONTENT_LENGTH:
        raise ValidationError("내용이 너무 깁니다.")

    block = MessageBlock(
        chat_id=chat.id,
        branch_id=branch.id,
        role=role,
        order_index=branch_service.next_order_index(db, branch),
        generation_status=generation_status,
    )
    db.add(block)
    db.flush()

    version = MessageBlockVersion(
        block_id=block.id,
        version_no=1,
        content=text,
        source_type=source_type,
        search_sources=search_sources,
    )
    db.add(version)
    db.flush()

    block.current_version_id = version.id
    chat.last_activity_at = datetime.now(UTC)
    if commit:
        db.commit()
        db.refresh(block)
    return block


def save_streaming_progress(
    db: Session, version_id: uuid.UUID, content: str
) -> None:
    """생성 중인 답변의 지금까지 본문을 그 자리에서 덮어쓴다 .

    새 버전을 쌓지 않는다. 아직 완성되지 않은 중간 상태라 이력에 남길 값이
    아니고, 매 저장마다 버전이 늘면 이력이 무의미해진다.
    """
    version = db.get(MessageBlockVersion, version_id)
    if version is None:
        return
    version.content = content
    db.commit()


def finalize_streaming_block(
    db: Session,
    chat: Chat,
    version_id: uuid.UUID,
    block: MessageBlock,
    content: str,
    status: BlockGenerationStatus,
    search_sources: list[dict] | None = None,
) -> MessageBlock:
    """생성이 끝났을 때(완료/중단/실패) 최종 본문과 상태를 확정한다."""
    version = db.get(MessageBlockVersion, version_id)
    if version is not None:
        version.content = content
        version.search_sources = search_sources
    block.generation_status = status
    chat.last_activity_at = datetime.now(UTC)
    db.commit()
    db.refresh(block)
    return block


def ensure_generation_complete(block: MessageBlock) -> None:
    """생성 중이거나 중단·실패한 답변은 Context·정제·브랜치 분기점으로 못 쓴다 (D밀스톤).

    문장 중간에 끊긴 글이 다음 답변의 근거가 되거나, 아직 안 끝난 답변이
    수정·분기의 기준이 되는 것을 막는다.
    """
    if block.generation_status is not BlockGenerationStatus.COMPLETE:
        raise ValidationError(
            "아직 생성 중이거나 중단된 답변은 이 작업에 쓸 수 없습니다."
        )


def get_visible_block(
    db: Session, branch: Branch, block_id: uuid.UUID
) -> MessageBlock:
    """브랜치 화면에 보이는 블록을 가져온다 .

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
    같이 바뀌므로 수정을 막는다. 사용자는 원본 브랜치에서 고치거나
    수정본으로 새 브랜치를 만들어야 한다.
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
    """선택된 블록이 지금도 유효한지 확인한다 .

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
    context_ranges: list[ContextRangeIn],
) -> MessageBlock:
    """수정본을 새 버전으로 저장하고 활성화한다 .

    기존 버전은 지우지 않는다. 되돌리기는 활성 버전 포인터를 옮기는 방식이다.
    """
    text = (edited_content or "").strip()
    if not text:
        raise ValidationError("내용이 비어 있습니다.")
    if len(text) > MAX_CONTENT_LENGTH:
        raise ValidationError("내용이 너무 깁니다.")

    block = get_editable_block(db, branch, block_id)
    block = add_version(
        db, chat, block, text, source_type=VersionSourceType.USER_EDIT, commit=False
    )
    from app.services import context_service

    ranges = [
        context_service.ContextRangeSpec(
            block_id=item.block_id,
            version_id=item.version_id,
            snippet_text=item.snippet_text,
            start_offset=item.start_offset,
            end_offset=item.end_offset,
        )
        for item in context_ranges
    ]
    items = context_service.build_range_snapshot(db, branch, ranges, chat)
    context_service.save_log(db, chat, branch, block.current_version_id, items)
    db.commit()
    db.refresh(block)
    return block


def add_version(
    db: Session,
    chat: Chat,
    block: MessageBlock,
    content: str,
    source_type: VersionSourceType,
    search_sources: list[dict] | None = None,
    commit: bool = True,
) -> MessageBlock:
    """새 버전을 추가하고 활성 버전으로 삼는다.

    정제 승인과 답변 재생성도 이 경로를 쓴다.
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
        search_sources=search_sources,
    )
    db.add(version)
    db.flush()

    block.current_version_id = version.id
    chat.last_activity_at = datetime.now(UTC)
    if commit:
        db.commit()
        db.refresh(block)
    return block


def list_versions(
    db: Session, branch: Branch, block_id: uuid.UUID
) -> list[MessageBlockVersion]:
    """버전 이력 조회 . 정제 승인 후 이전 내용을 확인할 때 쓴다."""
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
    """활성 버전을 옮긴다 . 이력은 그대로 둔다."""
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
    """AI 입력으로 넘길 활성 메시지 흐름 .

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
