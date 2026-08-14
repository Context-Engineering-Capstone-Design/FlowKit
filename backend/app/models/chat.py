from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class BranchType(str, enum.Enum):
    MAIN = "MAIN"
    CHILD = "CHILD"


class Chat(Base, TimestampMixin):
    __tablename__ = "chats"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(200), default="새 대화")
    # 최근 대화 목록 정렬 전용. API 응답에는 노출하지 않는다 (BE-CHAT-003)
    last_activity_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )

    branches: Mapped[list[Branch]] = relationship(
        back_populates="chat", cascade="all, delete-orphan"
    )


class Branch(Base, TimestampMixin):
    """참조형 브랜치.

    분기 시점까지의 메시지를 복사하지 않는다. parent_branch_id와 base_message_block_id를
    따라 올라가며 조상 브랜치의 블록을 분기점까지만 이어붙여 전체 흐름을 구성한다.
    """

    __tablename__ = "branches"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    chat_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("chats.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(100))
    branch_type: Mapped[BranchType] = mapped_column(
        Enum(BranchType, name="branch_type"), default=BranchType.CHILD
    )
    parent_branch_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("branches.id", ondelete="CASCADE"), nullable=True, index=True
    )
    # 부모 브랜치에서 이 블록까지(포함)를 상속한다. MAIN이면 NULL.
    # message_blocks.branch_id와 순환 참조이므로 제약 생성을 분리한다.
    base_message_block_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "message_blocks.id",
            ondelete="SET NULL",
            use_alter=True,
            name="fk_branches_base_message_block",
        ),
        nullable=True,
    )

    chat: Mapped[Chat] = relationship(back_populates="branches")
    source_context: Mapped[BranchSourceContext | None] = relationship(
        back_populates="branch",
        cascade="all, delete-orphan",
        uselist=False,
        foreign_keys="BranchSourceContext.branch_id",
    )


class BranchSourceContext(Base, TimestampMixin):
    """브랜치가 어떤 Context에서 출발했는지에 대한 참조 (BE-BRANCH-005).

    AI 요약본을 저장하는 것이 아니라 원본 블록을 가리키기만 한다.
    """

    __tablename__ = "branch_source_contexts"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    branch_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="CASCADE"), unique=True, index=True
    )
    source_branch_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("branches.id", ondelete="SET NULL"), nullable=True
    )

    branch: Mapped[Branch] = relationship(
        back_populates="source_context", foreign_keys=[branch_id]
    )
    items: Mapped[list[BranchSourceContextItem]] = relationship(
        back_populates="source_context", cascade="all, delete-orphan"
    )


class BranchSourceContextItem(Base):
    __tablename__ = "branch_source_context_items"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    source_context_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("branch_source_contexts.id", ondelete="CASCADE"), index=True
    )
    source_message_block_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("message_blocks.id", ondelete="CASCADE")
    )
    order_index: Mapped[int] = mapped_column(Integer)

    source_context: Mapped[BranchSourceContext] = relationship(back_populates="items")
