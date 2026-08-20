"""사이드 채팅 결과의 선택적 메인 반영 (0820_08 마일스톤 C).

사이드 채팅은 기본적으로 메인(또는 부모) 채팅을 바꾸지 않는다. 사용자가 명시적으로
고른 결과만 여기 있는 함수를 거쳐 반영된다 — 자동 반영은 없다(C4).
"""

from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.exceptions import MessageBlockNotFoundError, ValidationError
from app.models import Branch, Chat, MessageBlock
from app.services import chat_service, message_service

MAX_IMPORT_BLOCKS = 30


def import_blocks_as_messages(
    db: Session,
    target_chat: Chat,
    target_branch: Branch,
    block_ids: list[uuid.UUID],
) -> list[MessageBlock]:
    """사이드 채팅의 질문·답변을 target_branch 에 새 메시지로 복사한다 (0820_08 C2).

    원본을 참조만 하는 게 아니라 실제로 복사한다 — 이후 사이드 채팅이 삭제되거나
    바뀌어도 가져온 메시지는 그대로 남는다. block_ids 순서를 그대로 따른다.
    """
    if not block_ids:
        raise ValidationError("가져올 메시지를 선택해주세요.")
    if len(block_ids) > MAX_IMPORT_BLOCKS:
        raise ValidationError(f"한 번에 가져올 수 있는 메시지는 {MAX_IMPORT_BLOCKS}개까지입니다.")

    found = chat_service.family_block_map(db, target_chat, block_ids)
    missing = [str(bid) for bid in block_ids if bid not in found]
    if missing:
        raise MessageBlockNotFoundError(
            "선택한 메시지를 찾을 수 없습니다.", detail={"blockIds": missing}
        )
    for block in found.values():
        message_service.ensure_generation_complete(block)

    created: list[MessageBlock] = []
    try:
        for block_id in block_ids:
            source = found[block_id]
            version = source.current_version
            if version is None:
                raise ValidationError("본문이 없는 메시지는 가져올 수 없습니다.")
            new_block = message_service.create_block(
                db, target_chat, target_branch, source.role, version.content, commit=False,
            )
            created.append(new_block)
        db.commit()
    except Exception:
        db.rollback()
        raise

    for block in created:
        db.refresh(block)
    return created
