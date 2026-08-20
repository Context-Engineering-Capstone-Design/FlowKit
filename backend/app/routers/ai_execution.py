"""AI 실행 관측 조회·기록 라우터 (0820_06).

일반 대화 흐름(conversation.py)이나 서비스 오류 수집(observability.py)과
목적을 섞지 않는다(C5). 개발·운영 조회 전용이며, 작업 소유자만 자신의
실행 요약을 볼 수 있다(C4).
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter

from app.deps import CurrentUser, DbSession
from app.schemas.ai_execution import (
    DeliveryTimingOut,
    DeliveryTimingRequest,
    DeliveryTimingResponse,
    ExecutionEventOut,
    ExecutionSummaryOut,
)
from app.services import ai_execution_service, ai_response_service, branch_service, chat_service

router = APIRouter(
    prefix="/api/chats/{chat_id}/branches/{branch_id}/ai-response-jobs/{job_id}",
    tags=["AiExecution"],
)


def _load(db, user, chat_id: uuid.UUID, branch_id: uuid.UUID):
    chat = chat_service.get_owned_chat(db, user, chat_id)
    branch = branch_service.get_branch_in_chat(db, chat, branch_id)
    return chat, branch


@router.get("/execution", response_model=ExecutionSummaryOut)
def get_execution_summary(
    chat_id: uuid.UUID, branch_id: uuid.UUID, job_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> ExecutionSummaryOut:
    """0820_06 B6, C4: 서버 실행 시간·도구 실행 기록·화면 전달 시간을 한 번에 본다."""
    chat, branch = _load(db, user, chat_id, branch_id)
    job = ai_response_service.get_owned_job(db, user, chat, branch, job_id)
    summary = ai_execution_service.get_execution_summary(db, job)

    delivery = summary["delivery"]
    return ExecutionSummaryOut(
        job_id=job.id,
        job_type=job.job_type.value,
        status=job.status.value,
        error_code=job.error_code,
        created_at=job.created_at,
        generation_started_at=job.generation_started_at,
        first_chunk_at=job.first_chunk_at,
        finished_at=job.finished_at,
        usage=job.usage_summary or {"measured": False},
        events=[
            ExecutionEventOut(
                kind=e.kind.value,
                status=e.status.value,
                started_at=e.started_at,
                completed_at=e.completed_at,
                summary=e.summary,
            )
            for e in summary["events"]
        ],
        delivery=(
            DeliveryTimingOut(
                clicked_at=delivery.clicked_at,
                block_shown_at=delivery.block_shown_at,
                stream_connected_at=delivery.stream_connected_at,
                first_chunk_shown_at=delivery.first_chunk_shown_at,
                done_at=delivery.done_at,
                reconnect_count=delivery.reconnect_count,
                final_outcome=delivery.final_outcome,
            )
            if delivery is not None
            else None
        ),
    )


@router.post("/delivery-timing", response_model=DeliveryTimingResponse)
def record_delivery_timing(
    chat_id: uuid.UUID,
    branch_id: uuid.UUID,
    job_id: uuid.UUID,
    payload: DeliveryTimingRequest,
    user: CurrentUser,
    db: DbSession,
) -> DeliveryTimingResponse:
    """0820_06 마일스톤 C: 화면이 측정한 전달 시간을 남긴다."""
    chat, branch = _load(db, user, chat_id, branch_id)
    job = ai_response_service.get_owned_job(db, user, chat, branch, job_id)
    ai_execution_service.record_delivery_timing(
        db,
        job,
        {
            "clicked_at": payload.clicked_at,
            "block_shown_at": payload.block_shown_at,
            "stream_connected_at": payload.stream_connected_at,
            "first_chunk_shown_at": payload.first_chunk_shown_at,
            "done_at": payload.done_at,
            "reconnect_count": payload.reconnect_count,
            "final_outcome": payload.final_outcome,
        },
    )
    return DeliveryTimingResponse(recorded=True)
