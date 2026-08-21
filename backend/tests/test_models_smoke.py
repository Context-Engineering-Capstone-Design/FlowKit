"""모델 계층 스모크 테스트.

PostgreSQL 없이도 관계·제약이 성립하는지 확인하기 위해 SQLite 인메모리를 사용한다.
실제 마이그레이션 검증은 docker compose 기동 후 alembic upgrade로 수행한다.
"""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.models import (
    Base,
    Branch,
    BranchType,
    Chat,
    MessageBlock,
    MessageBlockVersion,
    MessageRole,
    User,
    VersionSourceType,
)


@pytest.fixture
def session():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as s:
        yield s


@pytest.fixture
def chat_with_main(session: Session) -> tuple[Chat, Branch]:
    user = User(google_user_id="g-1", email="a@b.com", name="tester")
    session.add(user)
    session.flush()

    chat = Chat(owner_id=user.id, title="파이프라이닝")
    session.add(chat)
    session.flush()

    main = Branch(chat_id=chat.id, name="Main", branch_type=BranchType.MAIN)
    session.add(main)
    session.commit()
    return chat, main


def _add_block(
    session: Session, chat: Chat, branch: Branch, role: MessageRole, order: int, text: str
) -> MessageBlock:
    block = MessageBlock(
        chat_id=chat.id, branch_id=branch.id, role=role, order_index=order
    )
    session.add(block)
    session.flush()

    version = MessageBlockVersion(
        block_id=block.id, version_no=1, content=text,
        source_type=VersionSourceType.ORIGINAL,
    )
    session.add(version)
    session.flush()

    block.current_version_id = version.id
    session.commit()
    return block


def test_block_creation_sets_active_version(session, chat_with_main):
    chat, main = chat_with_main
    block = _add_block(session, chat, main, MessageRole.USER, 0, "안녕")

    assert block.current_version is not None
    assert block.current_version.content == "안녕"
    assert len(block.versions) == 1


def test_refine_approval_adds_version_and_keeps_history(session, chat_with_main):
    """정제 승인은 새 버전을 추가하고 활성 포인터만 옮긴다 ."""
    chat, main = chat_with_main
    block = _add_block(session, chat, main, MessageRole.ASSISTANT, 0, "원본 내용")
    original_version_id = block.current_version_id

    refined = MessageBlockVersion(
        block_id=block.id, version_no=2, content="정제된 내용",
        source_type=VersionSourceType.AI_REFINE,
    )
    session.add(refined)
    session.flush()
    block.current_version_id = refined.id
    session.commit()

    session.refresh(block)
    assert block.current_version.content == "정제된 내용"
    # 원본 버전은 삭제되지 않고 이력에 남아야 한다
    assert len(block.versions) == 2
    assert original_version_id in {v.id for v in block.versions}


def test_version_rollback_restores_previous_content(session, chat_with_main):
    """이전 버전으로 되돌리기 ."""
    chat, main = chat_with_main
    block = _add_block(session, chat, main, MessageRole.ASSISTANT, 0, "원본 내용")
    original_version_id = block.current_version_id

    refined = MessageBlockVersion(
        block_id=block.id, version_no=2, content="정제된 내용",
        source_type=VersionSourceType.AI_REFINE,
    )
    session.add(refined)
    session.flush()
    block.current_version_id = refined.id
    session.commit()

    block.current_version_id = original_version_id
    session.commit()

    session.refresh(block)
    assert block.current_version.content == "원본 내용"
    assert len(block.versions) == 2


def test_child_branch_records_parent_and_branch_point(session, chat_with_main):
    """참조형 브랜치는 분기점만 기록하고 메시지를 복사하지 않는다."""
    chat, main = chat_with_main
    b1 = _add_block(session, chat, main, MessageRole.USER, 0, "질문")
    b2 = _add_block(session, chat, main, MessageRole.ASSISTANT, 1, "답변")

    child = Branch(
        chat_id=chat.id,
        name="구조적 해저드 중심",
        branch_type=BranchType.CHILD,
        parent_branch_id=main.id,
        base_message_block_id=b2.id,
    )
    session.add(child)
    session.commit()

    child_blocks = session.scalars(
        select(MessageBlock).where(MessageBlock.branch_id == child.id)
    ).all()
    assert child_blocks == []

    assert child.parent_branch_id == main.id
    assert child.base_message_block_id == b2.id
    # 부모 블록은 그대로 부모 브랜치에 남아 있다 (원본 보존, )
    parent_blocks = session.scalars(
        select(MessageBlock).where(MessageBlock.branch_id == main.id)
    ).all()
    assert {b.id for b in parent_blocks} == {b1.id, b2.id}
