"""AI 실행 관측: 도구·근거 실행 기록과 화면 전달 시간 (0820_06 마일스톤 B, C).

이 모델들은 답변 본문을 저장하지 않는다. 질문·답변 원문, 첨부 본문, 검색
질의 원문도 담지 않는다 — 식별자·개수·크기·시간·상태만 남긴다.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class AiExecutionEventKind(str, enum.Enum):
    CONTEXT_READ = "context_read"
    ATTACHMENT_READ = "attachment_read"
    WEB_SEARCH = "web_search"


class AiExecutionEventStatus(str, enum.Enum):
    COMPLETED = "completed"
    # 검색 도구가 붙었다는 사실과 실제 검색은 다르다. 근거도 공급자 신호도
    # 없으면 completed로 추정하지 않고 이 값으로 남긴다(0820_06 B5).
    UNKNOWN = "unknown"


class AiExecutionEvent(Base, TimestampMixin):
    """한 AI 응답 작업에 영향을 준 입력·도구 실행 하나 (0820_06 B1~B5)."""

    __tablename__ = "ai_execution_events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("ai_response_jobs.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[AiExecutionEventKind] = mapped_column(
        Enum(AiExecutionEventKind, name="ai_execution_event_kind", values_callable=lambda x: [e.value for e in x])
    )
    status: Mapped[AiExecutionEventStatus] = mapped_column(
        Enum(AiExecutionEventStatus, name="ai_execution_event_status", values_callable=lambda x: [e.value for e in x])
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 종류별 안전한 요약만 담는다. context_read: 선택 블록 수·버전 식별자.
    # attachment_read: 파일 식별자·형식·크기. web_search: 요청 모드·근거
    # 수·공급자 실행 신호 여부.
    summary: Mapped[dict] = mapped_column(JSON)


class AiDeliveryTiming(Base, TimestampMixin):
    """작업 하나의 화면 전달 시간 (0820_06 마일스톤 C).

    브라우저가 측정해 보낸 값이며, 작업당 하나만 있다(재전송하면 덮어쓴다).
    질문·답변 본문은 담지 않는다.
    """

    __tablename__ = "ai_delivery_timings"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("ai_response_jobs.id", ondelete="CASCADE"), unique=True, index=True
    )
    clicked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    block_shown_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    stream_connected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    first_chunk_shown_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reconnect_count: Mapped[int] = mapped_column(Integer, default=0)
    final_outcome: Mapped[str] = mapped_column(String(30))
