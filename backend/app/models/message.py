from __future__ import annotations

import enum
import uuid

from sqlalchemy import Enum, ForeignKey, Integer, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class MessageRole(str, enum.Enum):
    USER = "user"
    ASSISTANT = "assistant"


class VersionSourceType(str, enum.Enum):
    ORIGINAL = "original"
    USER_EDIT = "user_edit"
    AI_REFINE = "ai_refine"
    AI_REGENERATE = "ai_regenerate"


class MessageBlock(Base, TimestampMixin):
    __tablename__ = "message_blocks"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    chat_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("chats.id", ondelete="CASCADE"), index=True
    )
    branch_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[MessageRole] = mapped_column(Enum(MessageRole, name="message_role"))
    order_index: Mapped[int] = mapped_column(Integer)
    # 활성 버전. 버전 이력은 삭제하지 않고 이 포인터만 옮긴다 (REQ-021, REQ-041)
    current_version_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "message_block_versions.id", ondelete="SET NULL", use_alter=True,
            name="fk_message_blocks_current_version",
        ),
        nullable=True,
    )

    versions: Mapped[list[MessageBlockVersion]] = relationship(
        back_populates="block",
        cascade="all, delete-orphan",
        foreign_keys="MessageBlockVersion.block_id",
        order_by="MessageBlockVersion.version_no",
    )
    current_version: Mapped[MessageBlockVersion | None] = relationship(
        foreign_keys=[current_version_id], post_update=True
    )

    __table_args__ = (
        UniqueConstraint("branch_id", "order_index", name="uq_block_branch_order"),
    )


class MessageBlockVersion(Base, TimestampMixin):
    __tablename__ = "message_block_versions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    block_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("message_blocks.id", ondelete="CASCADE"), index=True
    )
    version_no: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text)
    source_type: Mapped[VersionSourceType] = mapped_column(
        Enum(VersionSourceType, name="version_source_type"),
        default=VersionSourceType.ORIGINAL,
    )

    block: Mapped[MessageBlock] = relationship(
        back_populates="versions", foreign_keys=[block_id]
    )

    __table_args__ = (
        UniqueConstraint("block_id", "version_no", name="uq_version_block_no"),
    )
