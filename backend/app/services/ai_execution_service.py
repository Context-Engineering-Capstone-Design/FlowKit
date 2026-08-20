"""AI 실행 관측: 도구·근거 실행 기록, 사용량 요약, 화면 전달 시간 (0820_06).

이 서비스는 답변 본문을 다루지 않는다. 질문·답변 원문, 첨부 본문, 검색
질의 원문은 어떤 함수도 받지 않고 저장하지 않는다.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AiResponseJob, Attachment
from app.models.ai_execution import (
    AiDeliveryTiming,
    AiExecutionEvent,
    AiExecutionEventKind,
    AiExecutionEventStatus,
)
from modeling.types import TokenUsage

# 공급자 가격표 (0820_06 D4). 확인된 실제 단가가 없어 비워 둔다 — 모델이 이
# 표에 없으면 usage_summary는 토큰 수까지만 남기고 비용은 '미측정'으로
# 남긴다. 실제 단가를 확인하면 이 표를 채우고 PRICING_VERSION을 올린다.
PRICING_VERSION = "unset-2026-08-20"
PRICING_EFFECTIVE_AT = datetime(2026, 8, 20, tzinfo=UTC)
_PRICE_PER_MILLION_TOKENS_USD: dict[str, dict[str, float]] = {}


def build_usage_summary(model_id: str, provider: str, usage: TokenUsage | None) -> dict:
    """작업에 저장할 사용량·비용 요약을 만든다 (0820_06 D4).

    신뢰할 수 있는 토큰 사용량이 없으면 아무것도 추정하지 않는다. 단가표에
    없는 모델은 토큰 수는 남기되 비용은 '미측정'으로 둔다.
    """
    if usage is None:
        return {"measured": False}

    price = _PRICE_PER_MILLION_TOKENS_USD.get(model_id)
    cost_amount = cost_currency = None
    if price is not None:
        cost_amount = round(
            usage.input_tokens * price["input"] / 1_000_000
            + usage.output_tokens * price["output"] / 1_000_000,
            6,
        )
        cost_currency = "USD"

    return {
        "measured": True,
        "input_tokens": usage.input_tokens,
        "output_tokens": usage.output_tokens,
        "total_tokens": usage.total_tokens,
        "model": model_id,
        "provider": provider,
        "cost_amount": cost_amount,
        "cost_currency": cost_currency,
        "pricing_version": PRICING_VERSION if price is not None else None,
        "pricing_effective_at": PRICING_EFFECTIVE_AT.isoformat() if price is not None else None,
    }


def record_input_events(db: Session, job: AiResponseJob, snapshot: dict) -> None:
    """Context·첨부 입력 실행 기록을 남긴다 (0820_06 B2, B3).

    이 시점에 job이 이미 만들어졌다는 것은 Context 조회와 첨부 검증이
    성공했다는 뜻이다 — 그러므로 두 이벤트는 항상 completed다. 아무것도
    쓰이지 않았으면 이벤트를 만들지 않는다.
    """
    now = datetime.now(UTC)
    applied_context = snapshot.get("appliedContext") or []
    if applied_context:
        db.add(
            AiExecutionEvent(
                job_id=job.id,
                kind=AiExecutionEventKind.CONTEXT_READ,
                status=AiExecutionEventStatus.COMPLETED,
                started_at=now,
                completed_at=now,
                summary={
                    "block_count": len(applied_context),
                    "version_ids": [item["versionId"] for item in applied_context],
                },
            )
        )

    attachment_ids = snapshot.get("attachmentIds") or []
    if attachment_ids:
        ids = [uuid.UUID(x) for x in attachment_ids]
        rows = db.scalars(select(Attachment).where(Attachment.id.in_(ids)))
        items = [
            {"attachment_id": str(a.id), "file_type": a.mime_type, "file_size": a.file_size}
            for a in rows
        ]
        db.add(
            AiExecutionEvent(
                job_id=job.id,
                kind=AiExecutionEventKind.ATTACHMENT_READ,
                status=AiExecutionEventStatus.COMPLETED,
                started_at=now,
                completed_at=now,
                summary={"count": len(attachment_ids), "items": items},
            )
        )


def record_search_event(
    db: Session,
    job: AiResponseJob,
    mode: str,
    started_at: datetime,
    sources_count: int,
    provider_invoked: bool,
) -> None:
    """웹 검색 실행 기록을 남긴다 (0820_06 B4, B5).

    mode가 off면 검색 도구 자체를 붙이지 않으므로 기록하지 않는다. 근거도
    공급자 신호도 없으면 completed로 추정하지 않고 unknown으로 남긴다.
    """
    if mode == "off":
        return
    completed = sources_count > 0 or provider_invoked
    db.add(
        AiExecutionEvent(
            job_id=job.id,
            kind=AiExecutionEventKind.WEB_SEARCH,
            status=AiExecutionEventStatus.COMPLETED if completed else AiExecutionEventStatus.UNKNOWN,
            started_at=started_at,
            completed_at=datetime.now(UTC),
            summary={
                "mode": mode,
                "source_count": sources_count,
                "provider_signal": provider_invoked,
            },
        )
    )


def get_execution_summary(db: Session, job: AiResponseJob) -> dict:
    """조회 API가 돌려줄 실행 요약을 만든다 (0820_06 B6, C4, C5)."""
    events = list(
        db.scalars(
            select(AiExecutionEvent)
            .where(AiExecutionEvent.job_id == job.id)
            .order_by(AiExecutionEvent.started_at)
        )
    )
    delivery = db.scalar(select(AiDeliveryTiming).where(AiDeliveryTiming.job_id == job.id))
    return {"job": job, "events": events, "delivery": delivery}


def build_comparison_report(db: Session, jobs: list[AiResponseJob]) -> list[dict]:
    """추론 단계·모델·검색 모드별 결과를 비교하는 내부용 요약을 만든다 (0820_06 D3).

    개발·운영 용도로만 쓴다. 질문·답변 원문은 어떤 값에도 담지 않는다 —
    스냅샷에서 선택값만 꺼내고, 지연 시간은 이미 기록된 시각의 차이로 계산한다.
    """
    rows: list[dict] = []
    for job in jobs:
        snapshot = job.input_snapshot or {}
        events = list(db.scalars(select(AiExecutionEvent).where(AiExecutionEvent.job_id == job.id)))
        first_chunk_latency = (
            (job.first_chunk_at - job.generation_started_at).total_seconds()
            if job.generation_started_at and job.first_chunk_at
            else None
        )
        total_latency = (
            (job.finished_at - job.generation_started_at).total_seconds()
            if job.generation_started_at and job.finished_at
            else None
        )
        rows.append(
            {
                "job_id": str(job.id),
                "model": snapshot.get("selectedModelId"),
                "reasoning_effort": snapshot.get("reasoningEffort"),
                "web_search_mode": snapshot.get("webSearchMode"),
                "status": job.status.value,
                "first_chunk_latency_seconds": first_chunk_latency,
                "total_latency_seconds": total_latency,
                "event_kinds": sorted({e.kind.value for e in events}),
                "usage_measured": bool((job.usage_summary or {}).get("measured", False)),
            }
        )
    return rows


def record_delivery_timing(db: Session, job: AiResponseJob, payload: dict) -> AiDeliveryTiming:
    """화면 전달 시간 측정값을 기록한다 (0820_06 마일스톤 C).

    작업당 하나만 유지한다 — 재전송하면 있는 값을 덮어쓴다.
    """
    row = db.scalar(select(AiDeliveryTiming).where(AiDeliveryTiming.job_id == job.id))
    if row is None:
        row = AiDeliveryTiming(job_id=job.id)
        db.add(row)
    row.clicked_at = payload.get("clicked_at")
    row.block_shown_at = payload.get("block_shown_at")
    row.stream_connected_at = payload.get("stream_connected_at")
    row.first_chunk_shown_at = payload.get("first_chunk_shown_at")
    row.done_at = payload.get("done_at")
    row.reconnect_count = payload.get("reconnect_count", 0)
    row.final_outcome = payload["final_outcome"]
    db.commit()
    db.refresh(row)
    return row
