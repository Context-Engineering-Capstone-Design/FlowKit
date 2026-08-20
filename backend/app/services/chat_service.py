"""채팅 서비스 (BE-CHAT-001 ~ BE-CHAT-009)."""

from __future__ import annotations

import base64
import uuid
from datetime import UTC, datetime

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.exceptions import (
    ChatAccessDeniedError,
    ChatNotFoundError,
    MessageBlockNotFoundError,
    ValidationError,
)
from app.models import (
    AiResponseFeedback,
    AiResponseJob,
    AppliedContextItem,
    AppliedContextLog,
    BlockRefineJob,
    BlockRefineResult,
    BlockRefineTarget,
    Branch,
    BranchSourceContext,
    BranchSourceContextItem,
    BranchType,
    Chat,
    ChatKind,
    MessageBlock,
    MessageBlockVersion,
    User,
)

DEFAULT_TITLE = "새 대화"
DEFAULT_SIDE_TITLE = "새 사이드 채팅"
MAX_TITLE_LENGTH = 200
DEFAULT_LIMIT = 20
MAX_LIMIT = 100

# 제목에 들어가면 목록 표시가 깨지는 제어 문자 (BE-CHAT-004)
_FORBIDDEN_TITLE_CHARS = {"\n", "\r", "\t", "\x00"}


def create_chat_with_main_branch(db: Session, user: User) -> tuple[Chat, Branch]:
    """새 채팅과 Main 브랜치를 한 트랜잭션으로 생성한다 (BE-CHAT-001, 002)."""
    chat = Chat(owner_id=user.id, title=DEFAULT_TITLE)
    db.add(chat)
    db.flush()

    main_branch = Branch(
        chat_id=chat.id, name="Main", branch_type=BranchType.MAIN
    )
    db.add(main_branch)
    db.commit()
    db.refresh(chat)
    db.refresh(main_branch)
    return chat, main_branch


def create_side_chat(
    db: Session,
    user: User,
    parent_chat: Chat,
    parent_branch: Branch,
    anchor_message_block_id: uuid.UUID | None,
    title: str | None,
) -> tuple[Chat, Branch]:
    """부모 대화 흐름의 한 지점에서 사이드 채팅을 만든다 (0820_08 A1, A3).

    anchor_message_block_id 를 주지 않으면 부모의 최신 메시지를 생성 시점으로
    기록한다. 자식은 루트 메인 채팅의 공통 컨텍스트만 자동 참고하므로, 부모가
    이미 사이드 채팅이면 그 root_chat_id/root_branch_id 를 그대로 물려받는다.
    """
    from app.services import branch_service

    visible = branch_service.resolve_blocks(db, parent_branch)
    if anchor_message_block_id is not None:
        anchor = next((b for b in visible if b.id == anchor_message_block_id), None)
        if anchor is None:
            raise MessageBlockNotFoundError("사이드 채팅을 만들 지점을 찾을 수 없습니다.")
    else:
        anchor = visible[-1] if visible else None

    if parent_chat.kind is ChatKind.SIDE:
        root_chat_id = parent_chat.root_chat_id
        root_branch_id = parent_chat.root_branch_id
    else:
        root_chat_id = parent_chat.id
        root_branch_id = parent_branch.id

    name = (title or "").strip()
    if len(name) > MAX_TITLE_LENGTH:
        raise ValidationError(f"제목은 {MAX_TITLE_LENGTH}자를 넘을 수 없습니다.")

    chat = Chat(
        owner_id=user.id,
        title=name or DEFAULT_SIDE_TITLE,
        kind=ChatKind.SIDE,
        parent_chat_id=parent_chat.id,
        parent_branch_id=parent_branch.id,
        parent_message_block_id=anchor.id if anchor else None,
        root_chat_id=root_chat_id,
        root_branch_id=root_branch_id,
    )
    db.add(chat)
    db.flush()

    main_branch = Branch(chat_id=chat.id, name="Main", branch_type=BranchType.MAIN)
    db.add(main_branch)
    db.commit()
    db.refresh(chat)
    db.refresh(main_branch)
    return chat, main_branch


def list_side_chat_children(db: Session, chat: Chat) -> list[Chat]:
    """chat 바로 아래의 자식 사이드 채팅 (0820_08 A2)."""
    return list(
        db.scalars(
            select(Chat)
            .where(Chat.parent_chat_id == chat.id)
            .order_by(Chat.created_at)
        ).all()
    )


def list_side_chat_siblings(db: Session, chat: Chat) -> list[Chat]:
    """chat 과 같은 부모를 공유하는 다른 사이드 채팅 (0820_08 A2)."""
    if chat.parent_chat_id is None:
        return []
    return list(
        db.scalars(
            select(Chat)
            .where(Chat.parent_chat_id == chat.parent_chat_id, Chat.id != chat.id)
            .order_by(Chat.created_at)
        ).all()
    )


def list_side_chat_tree(db: Session, root_chat: Chat) -> list[Chat]:
    """root_chat 아래 모든 사이드 채팅을 트리 그래프용으로 평탄화한다 (0820_08 A2, B3).

    각 항목의 parent_chat_id 를 따라가면 화면에서 트리를 그릴 수 있다.
    """
    return list(
        db.scalars(
            select(Chat)
            .where(Chat.root_chat_id == root_chat.id)
            .order_by(Chat.created_at)
        ).all()
    )


def list_chat_family(db: Session, chat: Chat) -> list[Chat]:
    """chat과 같은 사이드 채팅 트리에 속한 모든 채팅(루트 메인 + 모든 사이드) (0820_08 C1, C2).

    선택적 메인 반영(Context 추가, 메시지 가져오기)이 이 트리 전체를 소스로
    허용할 때, 어디까지가 "같은 계열"인지 판단하는 기준이다.
    """
    if chat.kind is ChatKind.MAIN:
        root = chat
    elif chat.root_chat_id is not None:
        root = db.get(Chat, chat.root_chat_id)
        if root is None:
            return [chat]
    else:
        return [chat]
    return [root] + list_side_chat_tree(db, root)


def family_block_map(
    db: Session, chat: Chat, block_ids: list[uuid.UUID]
) -> dict[uuid.UUID, MessageBlock]:
    """block_ids 중 chat과 같은 사이드 채팅 트리에 속한 채팅 소유 블록만 골라 돌려준다.

    사이드 채팅 탐색 결과를 부모 쪽 Context·메시지로 가져올 때, 원본 채팅의
    현재 브랜치에 없는 블록이라도 같은 트리 안이면 소스로 허용한다.
    """
    if not block_ids:
        return {}
    family_ids = {c.id for c in list_chat_family(db, chat)}
    found: dict[uuid.UUID, MessageBlock] = {}
    for block_id in block_ids:
        block = db.get(MessageBlock, block_id)
        if block is not None and block.chat_id in family_ids:
            found[block_id] = block
    return found


def get_owned_chat(db: Session, user: User, chat_id: uuid.UUID) -> Chat:
    """채팅 접근 권한 공통 검증 (BE-CHAT-008).

    존재하지 않는 경우와 남의 것인 경우를 구분해서 알린다.
    """
    chat = db.get(Chat, chat_id)
    if chat is None:
        raise ChatNotFoundError()
    if chat.owner_id != user.id:
        raise ChatAccessDeniedError()
    return chat


def list_chats(
    db: Session,
    user: User,
    cursor: str | None = None,
    limit: int = DEFAULT_LIMIT,
    keyword: str | None = None,
) -> tuple[list[Chat], str | None]:
    """최근 대화 목록·검색 (BE-CHAT-003, 006).

    lastActivityAt 내림차순. 같은 시각이 여러 건일 수 있으므로 id 를 함께 비교해
    커서가 항목을 건너뛰거나 중복 반환하지 않게 한다.
    """
    limit = max(1, min(limit, MAX_LIMIT))

    # 사이드 채팅은 좌측 트리 패널에서 따로 관리하므로 최근 대화 목록엔 안 낀다 (0820_08).
    stmt = select(Chat).where(Chat.owner_id == user.id, Chat.kind == ChatKind.MAIN)

    if keyword:
        keyword = keyword.strip()
        if not keyword:
            raise ValidationError("검색어를 입력해주세요.")
        stmt = stmt.where(Chat.title.ilike(f"%{keyword}%"))

    if cursor:
        cursor_time, cursor_id = _decode_cursor(cursor)
        stmt = stmt.where(
            (Chat.last_activity_at < cursor_time)
            | ((Chat.last_activity_at == cursor_time) & (Chat.id < cursor_id))
        )

    stmt = stmt.order_by(Chat.last_activity_at.desc(), Chat.id.desc()).limit(limit + 1)
    rows = list(db.scalars(stmt).all())

    has_more = len(rows) > limit
    chats = rows[:limit]
    next_cursor = (
        _encode_cursor(chats[-1].last_activity_at, chats[-1].id)
        if has_more and chats
        else None
    )
    return chats, next_cursor


def update_title(db: Session, chat: Chat, generated_title: str) -> Chat:
    """AI가 생성한 제목을 검증 후 저장한다 (BE-CHAT-004).

    제목 생성 자체는 AI 모델링 파트 책임이고, 여기서는 저장 가능한 값인지만 본다.
    """
    title = (generated_title or "").strip()
    if not title:
        raise ValidationError("제목이 비어 있습니다.")
    if len(title) > MAX_TITLE_LENGTH:
        raise ValidationError(f"제목은 {MAX_TITLE_LENGTH}자를 넘을 수 없습니다.")
    if any(ch in title for ch in _FORBIDDEN_TITLE_CHARS):
        raise ValidationError("제목에 줄바꿈이나 제어 문자를 넣을 수 없습니다.")

    chat.title = title
    db.commit()
    db.refresh(chat)
    return chat


def touch_activity(db: Session, chat: Chat) -> None:
    """정렬용 활동 시각 갱신 (BE-CHAT-007). UI에는 노출하지 않는다."""
    chat.last_activity_at = datetime.now(UTC)
    db.commit()


def delete_chat(db: Session, chat: Chat) -> None:
    """채팅과 하위 브랜치·메시지·첨부를 실제로 삭제한다 (BE-CHAT-009)."""
    from app.services import input_assist_service

    chat_id = chat.id
    input_assist_service.delete_attachments_for_chat(db, chat)

    # 이 채팅을 부모/루트로 참조하는 다른 사이드 채팅의 연결을 끊는다 (0820_08).
    # 사이드 채팅은 독립된 대화라 부모가 지워져도 내용은 그대로 남긴다.
    db.execute(
        update(Chat)
        .where(Chat.parent_chat_id == chat_id)
        .values(parent_chat_id=None, parent_branch_id=None, parent_message_block_id=None)
    )
    db.execute(
        update(Chat)
        .where(Chat.root_chat_id == chat_id)
        .values(root_chat_id=None, root_branch_id=None)
    )

    branch_ids = list(db.scalars(select(Branch.id).where(Branch.chat_id == chat_id)))
    block_ids = list(db.scalars(select(MessageBlock.id).where(MessageBlock.chat_id == chat_id)))

    if branch_ids:
        source_ctx_ids = list(
            db.scalars(
                select(BranchSourceContext.id).where(
                    BranchSourceContext.branch_id.in_(branch_ids)
                )
            )
        )
        if source_ctx_ids:
            db.execute(
                delete(BranchSourceContextItem).where(
                    BranchSourceContextItem.source_context_id.in_(source_ctx_ids)
                )
            )
            db.execute(
                delete(BranchSourceContext).where(
                    BranchSourceContext.id.in_(source_ctx_ids)
                )
            )

    if block_ids:
        db.execute(
            delete(AiResponseFeedback).where(
                AiResponseFeedback.message_block_id.in_(block_ids)
            )
        )

    db.execute(delete(AiResponseJob).where(AiResponseJob.chat_id == chat_id))

    job_ids = list(
        db.scalars(select(BlockRefineJob.id).where(BlockRefineJob.chat_id == chat_id))
    )
    if job_ids:
        db.execute(delete(BlockRefineResult).where(BlockRefineResult.job_id.in_(job_ids)))
        db.execute(delete(BlockRefineTarget).where(BlockRefineTarget.job_id.in_(job_ids)))
        db.execute(delete(BlockRefineJob).where(BlockRefineJob.id.in_(job_ids)))

    log_ids = list(
        db.scalars(select(AppliedContextLog.id).where(AppliedContextLog.chat_id == chat_id))
    )
    if log_ids:
        db.execute(delete(AppliedContextItem).where(AppliedContextItem.log_id.in_(log_ids)))
        db.execute(delete(AppliedContextLog).where(AppliedContextLog.id.in_(log_ids)))

    db.execute(
        update(Branch)
        .where(Branch.chat_id == chat_id)
        .values(parent_branch_id=None, base_message_block_id=None)
    )
    if block_ids:
        db.execute(
            update(MessageBlock)
            .where(MessageBlock.id.in_(block_ids))
            .values(current_version_id=None)
        )
        db.execute(
            delete(MessageBlockVersion).where(MessageBlockVersion.block_id.in_(block_ids))
        )
        db.execute(delete(MessageBlock).where(MessageBlock.id.in_(block_ids)))

    db.execute(delete(Branch).where(Branch.chat_id == chat_id))
    db.expunge(chat)
    db.execute(delete(Chat).where(Chat.id == chat_id))
    db.commit()


def _encode_cursor(activity_at: datetime, chat_id: uuid.UUID) -> str:
    raw = f"{activity_at.isoformat()}|{chat_id}"
    return base64.urlsafe_b64encode(raw.encode()).decode()


def _decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode()).decode()
        time_part, id_part = raw.rsplit("|", 1)
        return datetime.fromisoformat(time_part), uuid.UUID(id_part)
    except (ValueError, UnicodeDecodeError) as exc:
        raise ValidationError("잘못된 커서 값입니다.") from exc
