from __future__ import annotations

import enum
import uuid

from sqlalchemy import Enum, ForeignKey, Integer, JSON, Text, UniqueConstraint
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


class BlockGenerationStatus(str, enum.Enum):
    """AI 답변 블록의 생성 진행 상태 (BE-AIRESP-007~009).

    사용자 블록은 생성 개념이 없어 항상 COMPLETE다. GENERATING은 스트리밍
    중, CANCELLED는 사용자가 중단, FAILED는 생성 실패를 뜻한다.
    """

    GENERATING = "generating"
    COMPLETE = "complete"
    CANCELLED = "cancelled"
    FAILED = "failed"


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
    # 생성 중/완료/중단/실패 (BE-AIRESP-007~009). 사용자 블록은 항상 COMPLETE.
    generation_status: Mapped[BlockGenerationStatus] = mapped_column(
        Enum(
            BlockGenerationStatus,
            name="block_generation_status",
            values_callable=lambda x: [e.value for e in x],
        ),
        default=BlockGenerationStatus.COMPLETE,
        server_default=BlockGenerationStatus.COMPLETE.value,
    )
    # 이 블록에 붙은 첨부 (AI-ATTACH-001, 002). 조회 전용이며 연결은
    # input_assist_service.attach_to_message 가 만든다.
    attachment_links: Mapped[list["MessageAttachment"]] = relationship(
        foreign_keys="MessageAttachment.message_block_id",
        order_by="MessageAttachment.order_index",
        viewonly=True,
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
    # 웹 검색으로 답했을 때 참고한 자료 (AI-SEARCH-002). [{"title", "url"}] 형태이며
    # 검색을 안 썼거나 근거가 없으면 None 이다.
    search_sources: Mapped[list | None] = mapped_column(JSON, nullable=True)

    block: Mapped[MessageBlock] = relationship(
        back_populates="versions", foreign_keys=[block_id]
    )

    __table_args__ = (
        UniqueConstraint("block_id", "version_no", name="uq_version_block_no"),
    )
