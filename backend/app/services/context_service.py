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
from app.services import branch_service

MAX_CONTEXT_BLOCKS = 30


@dataclass(frozen=True)
class ContextItem:
    block_id: uuid.UUID
    version_id: uuid.UUID
    content: str
    order_index: int


def build_snapshot(
    db: Session, branch: Branch, context_block_ids: list[uuid.UUID]
) -> list[ContextItem]:
    """적용할 Context 를 서버 기준으로 확정한다 (BE-CTXAPPLY-001, 002).

    화면이 보낸 본문을 그대로 믿지 않고, 각 블록의 현재 활성 버전을 읽어 쓴다.
    승인되지 않은 정제 결과는 활성 버전이 아니므로 자연히 제외된다.
    """
    if not context_block_ids:
        return []
    if len(context_block_ids) > MAX_CONTEXT_BLOCKS:
        raise ValidationError(
            f"한 번에 적용할 수 있는 Context 블록은 {MAX_CONTEXT_BLOCKS}개까지입니다."
        )

    visible = {b.id: b for b in branch_service.resolve_blocks(db, branch)}

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
