from __future__ import annotations

import enum
import uuid

from sqlalchemy import Enum, ForeignKey, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class AiResponseJobType(str, enum.Enum):
    GENERATE = "generate"
    REGENERATE = "regenerate"


class AiResponseJobStatus(str, enum.Enum):
    REQUESTED = "requested"
    COMPLETED = "completed"
    FAILED = "failed"


class AiResponseJob(Base, TimestampMixin):
    __tablename__ = "ai_response_jobs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    chat_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("chats.id", ondelete="CASCADE"), index=True)
    branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branches.id", ondelete="CASCADE"), index=True)
    user_message_block_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("message_blocks.id", ondelete="CASCADE"), index=True)
    assistant_message_block_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("message_blocks.id", ondelete="SET NULL"), nullable=True, index=True)
    result_version_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("message_block_versions.id", ondelete="SET NULL"), nullable=True)
    source_job_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("ai_response_jobs.id", ondelete="SET NULL"), nullable=True, index=True)
    job_type: Mapped[AiResponseJobType] = mapped_column(Enum(AiResponseJobType, name="ai_response_job_type"))
    status: Mapped[AiResponseJobStatus] = mapped_column(Enum(AiResponseJobStatus, name="ai_response_job_status"), default=AiResponseJobStatus.REQUESTED)
    input_snapshot: Mapped[dict] = mapped_column(JSON)
    error_code: Mapped[str | None] = mapped_column(String(80), nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(300), nullable=True)
