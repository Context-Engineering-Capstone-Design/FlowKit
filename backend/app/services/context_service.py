"""Context 적용 서비스 (BE-CTXAPPLY-001 ~ BE-CTXAPPLY-004)."""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy.orm import Session

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


@dataclass(frozen=True)
class ContextRangeSpec:
    """드래그로 고른 메시지 안 부분 범위 하나 (0820_13)."""

    block_id: uuid.UUID
    version_id: uuid.UUID
    snippet_text: str


def build_snapshot(
    db: Session,
    branch: Branch,
    context_block_ids: list[uuid.UUID],
    chat: Chat | None = None,
) -> list[ContextItem]:
    """적용할 Context 를 서버 기준으로 확정한다 (BE-CTXAPPLY-001, 002).

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
            )
        )
    return items


def build_range_snapshot(
    db: Session,
    branch: Branch,
    ranges: list[ContextRangeSpec],
    chat: Chat | None = None,
) -> list[ContextItem]:
    """드래그로 고른 부분 범위를 Context 로 확정한다 (0820_13).

    블록 전체가 아니라 화면이 보낸 스니펫만 AI 입력에 들어간다. 화면이 보낸
    텍스트를 그대로 믿지 않고, 실제로 그 버전의 본문 안에 있는 부분인지
    확인해 다른 내용을 스니펫으로 위장해 보내는 것을 막는다. 개수·글자 수
    제한은 두지 않는다(0820_13 계획).
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
        snippet = r.snippet_text.strip()
        if not snippet or snippet not in version.content:
            raise ValidationError(
                "선택한 범위가 원본 내용과 일치하지 않습니다.",
                detail={"blockId": str(r.block_id)},
            )
        items.append(
            ContextItem(
                block_id=block.id,
                version_id=version.id,
                content=snippet,
                order_index=block.order_index,
            )
        )
    return items


def save_log(
    db: Session,
    chat: Chat,
    branch: Branch,
    user_message_block_id: uuid.UUID,
    items: list[ContextItem],
) -> AppliedContextLog | None:
    """어떤 Context 가 실제로 쓰였는지 남긴다 (BE-CTXAPPLY-003).

    전송 전 선택 상태는 화면이 들고 있고 서버에 저장하지 않는다. 전송된 뒤의
    사용 이력만 남긴다.
    """
    if not items:
        return None

    log = AppliedContextLog(
        chat_id=chat.id,
        branch_id=branch.id,
        user_message_block_id=user_message_block_id,
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
                order_index=order,
            )
        )
    db.flush()
    return log
