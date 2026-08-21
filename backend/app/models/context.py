from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class AppliedContextLog(Base, TimestampMixin):
    """전송 시점에 확정된 Context 사용 이력 .

    전송 전 Context pill 선택 상태는 FE 로컬 상태이며 서버에 저장하지 않는다.
    """

    __tablename__ = "applied_context_logs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    chat_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("chats.id", ondelete="CASCADE"), index=True
    )
    branch_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="CASCADE"), index=True
    )
    message_block_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("message_block_versions.id", ondelete="CASCADE"), index=True, unique=True
    )

    items: Mapped[list[AppliedContextItem]] = relationship(
        back_populates="log", cascade="all, delete-orphan", order_by="AppliedContextItem.order_index"
    )


class AppliedContextItem(Base):
    __tablename__ = "applied_context_items"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    log_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("applied_context_logs.id", ondelete="CASCADE"), index=True
    )
    source_block_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("message_blocks.id", ondelete="CASCADE")
    )
    # 어떤 버전이 실제 입력으로 쓰였는지 고정한다.
    version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("message_block_versions.id", ondelete="CASCADE")
    )
    content: Mapped[str] = mapped_column(Text)
    start_offset: Mapped[int | None] = mapped_column(Integer, nullable=True)
    end_offset: Mapped[int | None] = mapped_column(Integer, nullable=True)
    order_index: Mapped[int] = mapped_column(Integer)

    log: Mapped[AppliedContextLog] = relationship(back_populates="items")
