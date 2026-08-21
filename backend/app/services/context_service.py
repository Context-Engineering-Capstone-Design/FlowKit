"""Context 적용 서비스 ."""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.exceptions import ValidationError
from app.models import (
    AppliedContextItem,
    AppliedContextLog,
    Branch,
    Chat,
    MessageBlock,
)
from app.services import branch_service, message_service

MAX_CONTEXT_BLOCKS = 30


@dataclass(frozen=True)
class ContextItem:
    block_id: uuid.UUID
    version_id: uuid.UUID
    content: str
    order_index: int
    start_offset: int | None = None
    end_offset: int | None = None
    ai_content: str | None = None


@dataclass(frozen=True)
class ContextRangeSpec:
    """드래그로 고른 메시지 안 부분 범위 하나 (0820_13, 0821_10)."""

    block_id: uuid.UUID
    version_id: uuid.UUID
    snippet_text: str
    start_offset: int | None = None
    end_offset: int | None = None


CONTEXT_WINDOW_CHARS = 100


def format_context_content(content: str, start_offset: int | None, end_offset: int | None) -> str:
    """오프셋이 있는 경우 앞뒤 최대 100자 맥락을 붙이고 선택 지점을 [[ ]]로 감싼다."""
    if start_offset is None or end_offset is None:
        return content
    prefix_start = max(0, start_offset - CONTEXT_WINDOW_CHARS)
    suffix_end = min(len(content), end_offset + CONTEXT_WINDOW_CHARS)
    prefix = content[prefix_start:start_offset]
    selected = content[start_offset:end_offset]
    suffix = content[end_offset:suffix_end]
    return f"{prefix}[[{selected}]]{suffix}"


def build_snapshot(
    db: Session,
    branch: Branch,
    context_block_ids: list[uuid.UUID],
    chat: Chat | None = None,
) -> list[ContextItem]:
    """적용할 Context 를 서버 기준으로 확정한다 (, 002).

    화면이 보낸 본문을 그대로 믿지 않고, 각 블록의 현재 활성 버전을 읽어 쓴다.
    승인되지 않은 정제 결과는 활성 버전이 아니므로 자연히 제외된다.

    chat 을 주면(0820_08 C1), 이 브랜치에 없는 블록이라도 같은 사이드 채팅
    트리에 속한 채팅의 블록이면 허용한다 — 사이드 채팅 답변을 메인의 다음
    질문 Context 로 그대로 넘기는 흐름이 기존 Context 파이프라인을 그대로 탄다.
    """
    if not context_block_ids:
        return []
    if len(context_block_ids) > MAX_CONTEXT_BLOCKS:
        raise ValidationError(
            f"한 번에 적용할 수 있는 Context 블록은 {MAX_CONTEXT_BLOCKS}개까지입니다."
        )

    visible = {b.id: b for b in branch_service.resolve_blocks(db, branch)}

    missing_ids = [bid for bid in context_block_ids if bid not in visible]
    if missing_ids and chat is not None:
        from app.services import chat_service

        visible.update(chat_service.family_block_map(db, chat, missing_ids))

    missing = [str(bid) for bid in context_block_ids if bid not in visible]
    if missing:
        raise ValidationError(
            "선택한 Context 블록 중 이 브랜치에 없는 것이 있습니다.",
            detail={"contextBlockIds": missing},
        )

    # 중복 선택은 같은 내용을 두 번 넣게 되므로 한 번만 남긴다
    seen: set[uuid.UUID] = set()
    blocks: list[MessageBlock] = []
    for bid in context_block_ids:
        if bid in seen:
            continue
        seen.add(bid)
        blocks.append(visible[bid])

    items = []
    for block in sorted(blocks, key=lambda b: b.order_index):
        message_service.ensure_generation_complete(block)
        version = block.current_version
        if version is None:
            raise ValidationError("본문이 없는 블록은 Context 로 쓸 수 없습니다.")
        items.append(
            ContextItem(
                block_id=block.id,
                version_id=version.id,
                content=version.content,
                order_index=block.order_index,
                ai_content=version.content,
            )
        )
    return items


def build_range_snapshot(
    db: Session,
    branch: Branch,
    ranges: list[ContextRangeSpec],
    chat: Chat | None = None,
) -> list[ContextItem]:
    """드래그로 고른 부분 범위를 Context 로 확정한다 (0820_13, 0821_10).

    블록 전체가 아니라 화면이 보낸 스니펫 위치를 기준으로 검증한다.
    오프셋이 주어진 경우 원본 본문의 해당 위치와 스니펫이 정확히 일치하는지 확인하며,
    AI에게 전달할 때는 선택 지점 앞뒤 100자의 맥락을 붙여 넘긴다.
    """
    if not ranges:
        return []

    visible = {b.id: b for b in branch_service.resolve_blocks(db, branch)}
    missing_ids = [r.block_id for r in ranges if r.block_id not in visible]
    if missing_ids and chat is not None:
        from app.services import chat_service

        visible.update(chat_service.family_block_map(db, chat, missing_ids))

    items: list[ContextItem] = []
    for r in ranges:
        block = visible.get(r.block_id)
        if block is None:
            raise ValidationError(
                "선택한 범위의 원본 블록을 찾을 수 없습니다.",
                detail={"blockId": str(r.block_id)},
            )
        version = next((v for v in block.versions if v.id == r.version_id), None)
        if version is None:
            raise ValidationError(
                "선택한 범위의 원본 버전을 찾을 수 없습니다.",
                detail={"blockId": str(r.block_id), "versionId": str(r.version_id)},
            )

        if r.start_offset is not None and r.end_offset is not None:
            if (
                r.start_offset < 0
                or r.end_offset > len(version.content)
                or r.start_offset > r.end_offset
                or version.content[r.start_offset:r.end_offset] != r.snippet_text
            ):
                raise ValidationError(
                    "선택한 범위가 원본 내용과 일치하지 않습니다.",
                    detail={"blockId": str(r.block_id)},
                )
            start_off, end_off = r.start_offset, r.end_offset
            snippet = r.snippet_text
        else:
            snippet = r.snippet_text.strip()
            if not snippet or snippet not in version.content:
                raise ValidationError(
                    "선택한 범위가 원본 내용과 일치하지 않습니다.",
                    detail={"blockId": str(r.block_id)},
                )
            idx = version.content.find(r.snippet_text)
            start_off = idx if idx != -1 else None
            end_off = idx + len(r.snippet_text) if idx != -1 else None

        ai_content = format_context_content(version.content, start_off, end_off)
        items.append(
            ContextItem(
                block_id=block.id,
                version_id=version.id,
                content=snippet,
                order_index=block.order_index,
                start_offset=start_off,
                end_offset=end_off,
                ai_content=ai_content,
            )
        )
    return items


def save_log(
    db: Session,
    chat: Chat,
    branch: Branch,
    message_block_version_id: uuid.UUID,
    items: list[ContextItem],
) -> AppliedContextLog | None:
    """어떤 Context 가 실제로 쓰였는지 남긴다 .

    전송 전 선택 상태는 화면이 들고 있고 서버에 저장하지 않는다. 전송된 뒤의
    사용 이력만 남긴다.
    """
    if not items:
        return None

    log = AppliedContextLog(
        chat_id=chat.id,
        branch_id=branch.id,
        message_block_version_id=message_block_version_id,
    )
    db.add(log)
    db.flush()

    for order, item in enumerate(items):
        db.add(
            AppliedContextItem(
                log_id=log.id,
                source_block_id=item.block_id,
                version_id=item.version_id,
                content=item.content,
                start_offset=item.start_offset,
                end_offset=item.end_offset,
                order_index=order,
            )
        )
    db.flush()
    return log


def applied_items_for_version(
    db: Session, message_block_version_id: uuid.UUID | None
) -> list[ContextItem]:
    """표시 중인 사용자 메시지 버전에 저장된 인용 태그를 돌려준다."""
    if message_block_version_id is None:
        return []
    log = db.scalars(
        select(AppliedContextLog)
        .where(AppliedContextLog.message_block_version_id == message_block_version_id)
        .options(joinedload(AppliedContextLog.items))
    ).unique().first()
    if log is None:
        return []
    return [
        ContextItem(
            block_id=item.source_block_id,
            version_id=item.version_id,
            content=item.content,
            order_index=item.order_index,
            start_offset=item.start_offset,
            end_offset=item.end_offset,
        )
        for item in log.items
    ]
