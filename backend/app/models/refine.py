from __future__ import annotations

import enum
import uuid

from sqlalchemy import Enum, ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin
from app.models.message import MessageRole


class RefineJobStatus(str, enum.Enum):
    REQUESTED = "requested"
    COMPLETED = "completed"
    FAILED = "failed"


class RefineResultStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class BlockRefineJob(Base, TimestampMixin):
    __tablename__ = "block_refine_jobs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    chat_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("chats.id", ondelete="CASCADE"), index=True
    )
    branch_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="CASCADE"), index=True
    )
    instruction_text: Mapped[str] = mapped_column(Text)
    status: Mapped[RefineJobStatus] = mapped_column(
        Enum(RefineJobStatus, name="refine_job_status"), default=RefineJobStatus.REQUESTED
    )

    targets: Mapped[list[BlockRefineTarget]] = relationship(
        back_populates="job", cascade="all, delete-orphan"
    )
    results: Mapped[list[BlockRefineResult]] = relationship(
        back_populates="job", cascade="all, delete-orphan"
    )


class BlockRefineTarget(Base, TimestampMixin):
    """정제 실행 시점의 활성 버전을 고정한 스냅샷 (BE-REFINE-001).

    이후 원본이 바뀌어도 정제 기준은 흔들리지 않는다.
    """

    __tablename__ = "block_refine_targets"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("block_refine_jobs.id", ondelete="CASCADE"), index=True
    )
    block_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("message_blocks.id", ondelete="CASCADE")
    )
    base_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("message_block_versions.id", ondelete="CASCADE")
    )
    base_content: Mapped[str] = mapped_column(Text)
    role: Mapped[MessageRole] = mapped_column(Enum(MessageRole, name="message_role"))
    order_index: Mapped[int] = mapped_column(Integer)

    job: Mapped[BlockRefineJob] = relationship(back_populates="targets")


class BlockRefineResult(Base, TimestampMixin):
    __tablename__ = "block_refine_results"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("block_refine_jobs.id", ondelete="CASCADE"), index=True
    )
    block_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("message_blocks.id", ondelete="CASCADE"), index=True
    )
    base_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("message_block_versions.id", ondelete="CASCADE")
    )
    refined_content: Mapped[str] = mapped_column(Text)
    status: Mapped[RefineResultStatus] = mapped_column(
        Enum(RefineResultStatus, name="refine_result_status"),
        default=RefineResultStatus.PENDING,
    )
    # 승인 시 생성된 새 버전. 거절/대기 상태에서는 NULL (BE-REFINE-009)
    approved_version_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("message_block_versions.id", ondelete="SET NULL"), nullable=True
    )

    job: Mapped[BlockRefineJob] = relationship(back_populates="results")
