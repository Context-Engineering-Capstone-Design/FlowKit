from __future__ import annotations

import enum
import uuid
from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class BranchType(str, enum.Enum):
    MAIN = "MAIN"
    CHILD = "CHILD"


class ChatKind(str, enum.Enum):
    """대화 세션의 트리상 역할 (0820_08). MAIN 은 부모가 없는 최상위 대화다."""

    MAIN = "MAIN"
    SIDE = "SIDE"


class Chat(Base, TimestampMixin):
    __tablename__ = "chats"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(200), default="새 대화")
    # NULL이면 Project 밖의 대화다. 사이드 채팅은 부모의 값을 서비스에서 강제한다.
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=True, index=True
    )
    # 최근 대화 목록 정렬 전용. API 응답에는 노출하지 않는다 (BE-CHAT-003)
    #
    # 커서 페이지네이션이 이 값의 동률을 id 로 가르는데, DB 기본값(now())에 맡기면
    # SQLite 는 초 단위라 여러 건이 같은 시각이 되고 커서가 항목을 걸러내지 못한다.
    # 백엔드와 무관하게 같은 정밀도를 쓰도록 파이썬에서 채운다.
    last_activity_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
        index=True,
    )

    # 사이드 채팅 트리 (0820_08).
    kind: Mapped[ChatKind] = mapped_column(
        Enum(ChatKind, name="chat_kind"),
        default=ChatKind.MAIN,
        server_default=ChatKind.MAIN.value,
    )
    # 구조적 부모(좌측 트리 그래프 표시용). 메인이거나 부모가 삭제되면 NULL.
    parent_chat_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("chats.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # 부모 안에서 이 사이드 채팅이 갈라져 나온 지점(생성 시점 북마크).
    # chats <-> branches 는 순환 참조이므로 use_alter 로 제약 생성을 분리한다.
    parent_branch_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "branches.id",
            ondelete="SET NULL",
            use_alter=True,
            name="fk_chats_parent_branch",
        ),
        nullable=True,
    )
    parent_message_block_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "message_blocks.id",
            ondelete="SET NULL",
            use_alter=True,
            name="fk_chats_parent_message_block",
        ),
        nullable=True,
    )
    # 공통 컨텍스트로 자동 참고하는 루트 메인 채팅과 그 브랜치. 중간 사이드
    # 채팅을 거치지 않고 항상 최상위 메인을 직접 가리킨다.
    root_chat_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("chats.id", ondelete="SET NULL"), nullable=True, index=True
    )
    root_branch_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "branches.id",
            ondelete="SET NULL",
            use_alter=True,
            name="fk_chats_root_branch",
        ),
        nullable=True,
    )
    # Temporary 사이드 채팅은 활성 탭에서만 쓰고 목록·검색·재사용 대상으로 남기지 않는다.
    is_temporary: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    temporary_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )

    branches: Mapped[list[Branch]] = relationship(
        back_populates="chat",
        cascade="all, delete-orphan",
        foreign_keys="Branch.chat_id",
    )


class ChatReadState(Base, TimestampMixin):
    """사용자가 대화를 마지막으로 확인한 시각."""

    __tablename__ = "chat_read_states"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    chat_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("chats.id", ondelete="CASCADE"), index=True)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    __table_args__ = (UniqueConstraint("user_id", "chat_id", name="uq_chat_read_state_user_chat"),)


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

    chat: Mapped[Chat] = relationship(
        back_populates="branches", foreign_keys=[chat_id]
    )
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
