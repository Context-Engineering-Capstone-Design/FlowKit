"""AI 실행 관측 조회·기록 스키마 (0820_06). 개발·운영 조회 전용이며, 질문·답변
원문은 어떤 필드에도 담지 않는다."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ExecutionEventOut(BaseModel):
    kind: str
    status: str
    started_at: datetime = Field(..., serialization_alias="startedAt")
    completed_at: datetime | None = Field(None, serialization_alias="completedAt")
    summary: dict

    model_config = ConfigDict(populate_by_name=True)


class UsageSummaryOut(BaseModel):
    measured: bool
    input_tokens: int | None = Field(None, serialization_alias="inputTokens")
    output_tokens: int | None = Field(None, serialization_alias="outputTokens")
    total_tokens: int | None = Field(None, serialization_alias="totalTokens")
    model: str | None = None
    provider: str | None = None
    cost_amount: float | None = Field(None, serialization_alias="costAmount")
    cost_currency: str | None = Field(None, serialization_alias="costCurrency")
    pricing_version: str | None = Field(None, serialization_alias="pricingVersion")
    pricing_effective_at: str | None = Field(None, serialization_alias="pricingEffectiveAt")

    model_config = ConfigDict(populate_by_name=True)


class DeliveryTimingOut(BaseModel):
    clicked_at: datetime | None = Field(None, serialization_alias="clickedAt")
    block_shown_at: datetime | None = Field(None, serialization_alias="blockShownAt")
    stream_connected_at: datetime | None = Field(None, serialization_alias="streamConnectedAt")
    first_chunk_shown_at: datetime | None = Field(None, serialization_alias="firstChunkShownAt")
    done_at: datetime | None = Field(None, serialization_alias="doneAt")
    reconnect_count: int = Field(..., serialization_alias="reconnectCount")
    final_outcome: str = Field(..., serialization_alias="finalOutcome")

    model_config = ConfigDict(populate_by_name=True)


class ExecutionSummaryOut(BaseModel):
    """0820_06 B6, C4, C5: 개발·운영 조회 전용. 작업 소유자만 접근한다."""

    job_id: uuid.UUID = Field(..., serialization_alias="jobId")
    job_type: str = Field(..., serialization_alias="jobType")
    status: str
    error_code: str | None = Field(None, serialization_alias="errorCode")
    created_at: datetime = Field(..., serialization_alias="createdAt")
    generation_started_at: datetime | None = Field(None, serialization_alias="generationStartedAt")
    first_chunk_at: datetime | None = Field(None, serialization_alias="firstChunkAt")
    finished_at: datetime | None = Field(None, serialization_alias="finishedAt")
    usage: UsageSummaryOut
    events: list[ExecutionEventOut]
    delivery: DeliveryTimingOut | None = None

    model_config = ConfigDict(populate_by_name=True)


class DeliveryTimingRequest(BaseModel):
    """0820_06 마일스톤 C: 브라우저가 측정한 화면 전달 시간. 질문·답변 본문은 받지 않는다."""

    clicked_at: datetime | None = Field(None, alias="clickedAt")
    block_shown_at: datetime | None = Field(None, alias="blockShownAt")
    stream_connected_at: datetime | None = Field(None, alias="streamConnectedAt")
    first_chunk_shown_at: datetime | None = Field(None, alias="firstChunkShownAt")
    done_at: datetime | None = Field(None, alias="doneAt")
    reconnect_count: int = Field(0, alias="reconnectCount", ge=0)
    final_outcome: Literal["completed", "cancelled", "failed", "connection_failed"] = Field(
        ..., alias="finalOutcome"
    )

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class DeliveryTimingResponse(BaseModel):
    recorded: bool

    model_config = ConfigDict(populate_by_name=True)
