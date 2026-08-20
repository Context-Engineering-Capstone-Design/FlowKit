from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class AiResponseJobType(str, enum.Enum):
    GENERATE = "generate"
    REGENERATE = "regenerate"


class AiResponseJobStatus(str, enum.Enum):
    REQUESTED = "requested"
    GENERATING = "generating"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


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
    job_type: Mapped[AiResponseJobType] = mapped_column(
        Enum(AiResponseJobType, name="ai_response_job_type", values_callable=lambda x: [e.value for e in x])
    )
    status: Mapped[AiResponseJobStatus] = mapped_column(
        Enum(AiResponseJobStatus, name="ai_response_job_status", values_callable=lambda x: [e.value for e in x]),
        default=AiResponseJobStatus.REQUESTED,
    )
    input_snapshot: Mapped[dict] = mapped_column(JSON)
    error_code: Mapped[str | None] = mapped_column(String(80), nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(300), nullable=True)

    # 실행 시간 기록 (0820_06 마일스톤 A). created_at은 작업이 요청된 시각이고,
    # generation_started_at은 백그라운드 생성이 실제로 시작된 시각이다. 서버가
    # 재시작돼 정리된 작업은 generation_started_at·first_chunk_at 없이
    # finished_at·error_code만 남는다(A3).
    generation_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    first_chunk_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 공급자 토큰 사용량과 비용 요약 (0820_06 D4). 신뢰할 수 있는 사용량이
    # 없으면 {"measured": False}만 남긴다 — 질문·답변 원문은 담지 않는다.
    usage_summary: Mapped[dict | None] = mapped_column(JSON, nullable=True)
