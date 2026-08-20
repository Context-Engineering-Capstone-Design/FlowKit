"""기존 Child Branch를 통합 대화 노드로 옮기는 일회성 전환기."""

from __future__ import annotations

import uuid

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import (
    AiResponseJob,
    AppliedContextLog,
    BlockRefineJob,
    Branch,
    BranchType,
    Chat,
    ChatKind,
    MessageBlock,
)
from app.services import branch_service, chat_service


def migrate_legacy_child_branches(db: Session) -> int:
    """Child Branch를 한 번만 Chat 노드로 전환하고, 옛 branchId를 보관한다.

    Branch 행 자체를 새 노드의 Main 흐름으로 옮겨 기존 AI·정제·Context의 branch_id
    참조를 유지한다. 상속받았던 블록은 새 노드에 복사하여 이후 원본과 분리한다.
    """
    children = list(
        db.scalars(
            select(Branch)
            .where(Branch.branch_type == BranchType.CHILD)
            .order_by(Branch.created_at)
        )
    )
    converted: dict[uuid.UUID, Chat] = {}
    for branch in children:
        if db.scalar(select(Chat.id).where(Chat.legacy_branch_id == branch.id)):
            continue
        source_chat = branch.chat
        parent_branch = db.get(Branch, branch.parent_branch_id) if branch.parent_branch_id else None
        parent_chat = converted.get(parent_branch.id) if parent_branch else None
        if parent_chat is None:
            parent_chat = parent_branch.chat if parent_branch else source_chat

        visible = branch_service.resolve_blocks(db, branch)
        own_orders = {
            item.order_index
            for item in visible
            if item.branch_id == branch.id
        }
        inherited = [item for item in visible if item.branch_id != branch.id and item.order_index not in own_orders]
        anchor_id = branch.base_message_block_id
        node = Chat(
            owner_id=source_chat.owner_id,
            title=branch.name,
            project_id=source_chat.project_id,
            kind=ChatKind.SIDE,
            parent_chat_id=parent_chat.id,
            parent_branch_id=parent_branch.id if parent_branch else None,
            parent_message_block_id=anchor_id,
            root_chat_id=source_chat.root_chat_id or source_chat.id,
            root_branch_id=source_chat.root_branch_id or (parent_branch.id if parent_branch else None),
            forked_from_chat_id=parent_chat.id,
            forked_from_message_block_id=anchor_id,
            legacy_branch_id=branch.id,
        )
        db.add(node)
        db.flush()

        # 자기 소유 행은 새 노드에 옮기고, 조상에서 보이던 흐름만 복사한다.
        db.execute(update(MessageBlock).where(MessageBlock.branch_id == branch.id).values(chat_id=node.id))
        db.execute(update(AiResponseJob).where(AiResponseJob.branch_id == branch.id).values(chat_id=node.id))
        db.execute(update(BlockRefineJob).where(BlockRefineJob.branch_id == branch.id).values(chat_id=node.id))
        db.execute(update(AppliedContextLog).where(AppliedContextLog.branch_id == branch.id).values(chat_id=node.id))
        branch.chat_id = node.id
        branch.branch_type = BranchType.MAIN
        branch.parent_branch_id = None
        branch.base_message_block_id = None
        db.flush()
        chat_service._copy_snapshot_blocks(db, inherited, branch, node.id, None)
        converted[branch.id] = node
    return len(converted)
