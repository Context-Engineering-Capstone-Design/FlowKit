"""브랜치 서비스 .

참조형 브랜치: 분기 시점까지의 메시지를 복사하지 않는다. 조상 브랜치를 분기점까지
거슬러 올라가며 이어붙여 화면에 보여줄 전체 흐름을 만든다.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.exceptions import (
    BranchNotFoundError,
    MessageBlockNotFoundError,
    ValidationError,
)
from app.models import (
    Branch,
    BranchSourceContext,
    BranchSourceContextItem,
    BranchType,
    Chat,
    MessageBlock,
    User,
)

MAX_BRANCH_NAME_LENGTH = 100
PREVIEW_LENGTH = 80


@dataclass(frozen=True)
class CreateBranchResult:
    branch: Branch
    source_context_id: uuid.UUID

# 데이터가 잘못돼 부모 관계가 순환하더라도 무한 재귀로 서버가 죽지 않게 한다
_MAX_ANCESTOR_DEPTH = 100


def get_branch_in_chat(db: Session, chat: Chat, branch_id: uuid.UUID) -> Branch:
    """브랜치 접근 권한 공통 검증 .

    채팅 소유권은 호출 전에 chat_service.get_owned_chat 으로 확인한다.
    """
    branch = db.get(Branch, branch_id)
    if branch is None or branch.chat_id != chat.id:
        raise BranchNotFoundError()
    return branch


def get_branch_with_legacy_compatibility(db: Session, chat: Chat, branch_id: uuid.UUID) -> Branch:
    """한 릴리스 동안 이전 chat/branch URL을 이동된 노드의 Main 흐름으로 해석한다."""
    branch = db.get(Branch, branch_id)
    if branch is not None and branch.chat_id == chat.id:
        return branch
    node = db.scalar(select(Chat).where(Chat.legacy_branch_id == branch_id, Chat.owner_id == chat.owner_id))
    if node is None:
        raise BranchNotFoundError()
    return get_main_branch(db, node)


def get_main_branch(db: Session, chat: Chat) -> Branch:
    branch = db.scalar(
        select(Branch).where(
            Branch.chat_id == chat.id, Branch.branch_type == BranchType.MAIN
        )
    )
    if branch is None:
        raise BranchNotFoundError("Main 브랜치가 없습니다.")
    return branch


def list_branches(db: Session, chat: Chat) -> list[Branch]:
    """Main 을 맨 앞에 두고 나머지는 생성순 ."""
    branches = db.scalars(
        select(Branch).where(Branch.chat_id == chat.id).order_by(Branch.created_at)
    ).all()
    return sorted(branches, key=lambda b: (b.branch_type != BranchType.MAIN,))


def resolve_blocks(db: Session, branch: Branch) -> list[MessageBlock]:
    """브랜치 화면에 보여줄 메시지 블록 전체 흐름을 만든다.

    자기 브랜치 블록 앞에, 부모 브랜치의 흐름 중 분기점까지를 이어붙인다.
    """
    inherited: list[MessageBlock] = []

    if branch.parent_branch_id and branch.base_message_block_id:
        chain: list[Branch] = []
        cursor: Branch | None = branch
        depth = 0
        while cursor and cursor.parent_branch_id and depth < _MAX_ANCESTOR_DEPTH:
            parent = db.get(Branch, cursor.parent_branch_id)
            if parent is None:
                break
            chain.append(cursor)
            cursor = parent
            depth += 1

        # 가장 오래된 조상부터 내려오며 각 분기점으로 잘라 나간다
        flow: list[MessageBlock] = []
        if cursor is not None:
            flow = _own_blocks(db, cursor)
        for child in reversed(chain):
            cutoff_block = (
                db.get(MessageBlock, child.base_message_block_id)
                if child.base_message_block_id
                else None
            )
            cutoff = cutoff_block.order_index if cutoff_block else -1
            flow = [b for b in flow if b.order_index <= cutoff]
            if child.id != branch.id:
                flow = flow + _own_blocks(db, child)
        inherited = flow

    own = _own_blocks(db, branch)
    # 수정본 기반 분기는 같은 순번의 자체 블록으로 상속 블록을 대체한다.
    own_orders = {block.order_index for block in own}
    return [block for block in inherited if block.order_index not in own_orders] + own


def next_order_index(db: Session, branch: Branch) -> int:
    """새 메시지 블록이 가져야 할 순번.

    상속받은 블록과 번호가 겹치면 화면 순서가 뒤엉키므로 전체 흐름 기준으로 계산한다.
    """
    blocks = resolve_blocks(db, branch)
    return blocks[-1].order_index + 1 if blocks else 0


def create_branch(
    db: Session,
    user: User,
    chat: Chat,
    branch_name: str,
    base_branch_id: uuid.UUID,
    base_message_block_id: uuid.UUID,
    context_block_ids: list[uuid.UUID],
    edited_base_content: str | None = None,
) -> CreateBranchResult:
    """선택 Context 기반 브랜치 생성 (, 004, 005)."""
    name = (branch_name or "").strip()
    if not name:
        number = 1
        while db.scalar(select(Branch.id).where(Branch.chat_id == chat.id, Branch.name == f"브랜치 {number}")):
            number += 1
        name = f"브랜치 {number}"
    if len(name) > MAX_BRANCH_NAME_LENGTH:
        raise ValidationError(
            f"브랜치 이름은 {MAX_BRANCH_NAME_LENGTH}자를 넘을 수 없습니다."
        )

    duplicate = db.scalar(
        select(Branch).where(Branch.chat_id == chat.id, Branch.name == name)
    )
    if duplicate is not None:
        raise ValidationError("같은 이름의 브랜치가 이미 있습니다.")

    base_branch = get_branch_in_chat(db, chat, base_branch_id)

    # 분기점과 Context 블록은 모두 기준 브랜치 화면에 실제로 보이는 블록이어야 한다
    visible = {b.id: b for b in resolve_blocks(db, base_branch)}
    if base_message_block_id not in visible:
        raise MessageBlockNotFoundError("분기 지점 메시지를 찾을 수 없습니다.")
    from app.services import message_service

    message_service.ensure_generation_complete(visible[base_message_block_id])

    edited = (edited_base_content or "").strip()
    if len(edited) > 100_000:
        raise ValidationError("수정한 내용이 너무 깁니다.")

    missing = [str(cid) for cid in context_block_ids if cid not in visible]
    if missing:
        raise MessageBlockNotFoundError(
            "선택한 Context 블록을 찾을 수 없습니다.", detail={"blockIds": missing}
        )

    try:
        branch = Branch(
            chat_id=chat.id,
            name=name,
            branch_type=BranchType.CHILD,
            parent_branch_id=base_branch.id,
            base_message_block_id=base_message_block_id,
        )
        db.add(branch)
        db.flush()

        if edited:
            from app.models import MessageBlockVersion, VersionSourceType

            base = visible[base_message_block_id]
            copy = MessageBlock(
                chat_id=chat.id,
                branch_id=branch.id,
                role=base.role,
                order_index=base.order_index,
            )
            db.add(copy)
            db.flush()
            version = MessageBlockVersion(
                block_id=copy.id,
                version_no=1,
                content=edited,
                source_type=VersionSourceType.USER_EDIT,
            )
            db.add(version)
            db.flush()
            copy.current_version_id = version.id

        source_context = BranchSourceContext(
            branch_id=branch.id, source_branch_id=base_branch.id
        )
        db.add(source_context)
        db.flush()

        for order, block_id in enumerate(context_block_ids):
            db.add(
                BranchSourceContextItem(
                    source_context_id=source_context.id,
                    source_message_block_id=block_id,
                    order_index=order,
                )
            )

        chat.last_activity_at = datetime.now(UTC)
        db.commit()
        db.refresh(branch)
        return CreateBranchResult(branch=branch, source_context_id=source_context.id)
    except Exception:
        db.rollback()
        raise


def build_source_context_info(db: Session, branch: Branch) -> list[dict]:
    """브랜치 상단에 표시할 출발 Context 정보 .

    Context pill 을 누르면 원본 위치로 이동해야 하므로, 원본 블록이 그 브랜치
    흐름에서 몇 번째인지(scrollTargetIndex)를 함께 계산한다.
    """
    source_context = db.scalar(
        select(BranchSourceContext).where(BranchSourceContext.branch_id == branch.id)
    )
    if source_context is None:
        return []

    source_branch = (
        db.get(Branch, source_context.source_branch_id)
        if source_context.source_branch_id
        else None
    )
    position = {}
    if source_branch is not None:
        position = {
            b.id: idx for idx, b in enumerate(resolve_blocks(db, source_branch))
        }

    items = []
    for item in sorted(source_context.items, key=lambda i: i.order_index):
        block = db.get(MessageBlock, item.source_message_block_id)
        if block is None:
            continue
        items.append(
            {
                "context_block_id": str(item.id),
                "preview_text": _preview(block),
                "role": block.role.value,
                "source_message_block_id": str(block.id),
                "source_branch_id": (
                    str(source_context.source_branch_id)
                    if source_context.source_branch_id
                    else None
                ),
                "scroll_target_index": position.get(block.id),
            }
        )
    return items


def _own_blocks(db: Session, branch: Branch) -> list[MessageBlock]:
    return list(
        db.scalars(
            select(MessageBlock)
            .where(MessageBlock.branch_id == branch.id)
            .order_by(MessageBlock.order_index)
        ).all()
    )


def _preview(block: MessageBlock) -> str:
    version = block.current_version
    if version is None:
        return ""
    text = version.content.strip()
    return text[:PREVIEW_LENGTH] + ("…" if len(text) > PREVIEW_LENGTH else "")
