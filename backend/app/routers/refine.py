"""블록별 정제 라우터 (2.6 블록별 정제)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter

from app.deps import CurrentUser, DbSession
from app.models import BlockRefineJob, BlockRefineResult
from app.schemas.refine import (
    BulkRefineResponse,
    CleanupResponse,
    RefineJobResponse,
    RefineResultOut,
    RunRefineRequest,
)
from app.services import branch_service, chat_service, refine_service

router = APIRouter(
    prefix="/api/chats/{chat_id}/branches/{branch_id}/refine-jobs", tags=["BlockRefine"]
)


def _load(db, user, chat_id: uuid.UUID, branch_id: uuid.UUID):
    chat = chat_service.get_owned_chat(db, user, chat_id)
    branch = branch_service.get_branch_in_chat(db, chat, branch_id)
    return chat, branch


def _result_out(result: BlockRefineResult, job: BlockRefineJob) -> RefineResultOut:
    base = refine_service.base_content_map(job)
    base_content, order_index = base.get(result.block_id, ("", 0))
    return RefineResultOut(
        result_id=result.id,
        block_id=result.block_id,
        base_version_id=result.base_version_id,
        base_content=base_content,
        refined_content=result.refined_content,
        status=result.status.value,
        approved_version_id=result.approved_version_id,
        order_index=order_index,
        updated_at=result.updated_at,
    )


def _job_response(db, job: BlockRefineJob) -> RefineJobResponse:
    return RefineJobResponse(
        refine_job_id=job.id,
        status=job.status.value,
        instruction_text=job.instruction_text,
        results=[_result_out(r, job) for r in refine_service.list_results(db, job)],
    )


@router.post("", response_model=RefineJobResponse, status_code=201)
def run_refine(
    chat_id: uuid.UUID,
    branch_id: uuid.UUID,
    payload: RunRefineRequest,
    user: CurrentUser,
    db: DbSession,
) -> RefineJobResponse:
    """BE-REFINE-001~003: 선택 블록을 각각 정제하고 결과를 대기 상태로 저장한다."""
    chat, branch = _load(db, user, chat_id, branch_id)
    job = refine_service.run_refine(
        db, chat, branch, payload.selected_block_ids, payload.instruction_text
    )
    return _job_response(db, job)


@router.get("/{job_id}", response_model=RefineJobResponse)
def get_job(
    chat_id: uuid.UUID,
    branch_id: uuid.UUID,
    job_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
) -> RefineJobResponse:
    """BE-REFINE-004, 009: 원본·정제본 비교와 상태 동기화용 조회."""
    chat, branch = _load(db, user, chat_id, branch_id)
    job = refine_service.get_job(db, chat, branch, job_id)
    return _job_response(db, job)


@router.post("/{job_id}/results/{result_id}/approve", response_model=RefineResultOut)
def approve(
    chat_id: uuid.UUID,
    branch_id: uuid.UUID,
    job_id: uuid.UUID,
    result_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
) -> RefineResultOut:
    """BE-REFINE-005: 승인 즉시 정제본을 새 버전으로 반영한다."""
    chat, branch = _load(db, user, chat_id, branch_id)
    job = refine_service.get_job(db, chat, branch, job_id)
    result = refine_service.get_result(db, job, result_id)
    return _result_out(refine_service.approve(db, chat, branch, result), job)


@router.post("/{job_id}/results/{result_id}/reject", response_model=RefineResultOut)
def reject(
    chat_id: uuid.UUID,
    branch_id: uuid.UUID,
    job_id: uuid.UUID,
    result_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
) -> RefineResultOut:
    """BE-REFINE-006: 거절. 원본 활성 버전은 그대로 둔다."""
    chat, branch = _load(db, user, chat_id, branch_id)
    job = refine_service.get_job(db, chat, branch, job_id)
    result = refine_service.get_result(db, job, result_id)
    return _result_out(refine_service.reject(db, result), job)


@router.post("/{job_id}/approve-all", response_model=BulkRefineResponse)
def approve_all(
    chat_id: uuid.UUID,
    branch_id: uuid.UUID,
    job_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
) -> BulkRefineResponse:
    """BE-REFINE-007: 대기 중인 결과 전체 승인."""
    chat, branch = _load(db, user, chat_id, branch_id)
    job = refine_service.get_job(db, chat, branch, job_id)
    approved, failed = refine_service.approve_all(db, chat, branch, job)
    return BulkRefineResponse(
        processed=[_result_out(r, job) for r in approved], failed=failed
    )


@router.post("/{job_id}/reject-all", response_model=BulkRefineResponse)
def reject_all(
    chat_id: uuid.UUID,
    branch_id: uuid.UUID,
    job_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
) -> BulkRefineResponse:
    """BE-REFINE-008: 대기 중인 결과 전체 거절."""
    chat, branch = _load(db, user, chat_id, branch_id)
    job = refine_service.get_job(db, chat, branch, job_id)
    rejected, failed = refine_service.reject_all(db, job)
    return BulkRefineResponse(
        processed=[_result_out(r, job) for r in rejected], failed=failed
    )


@router.post("/{job_id}/cleanup", response_model=CleanupResponse)
def cleanup(
    chat_id: uuid.UUID,
    branch_id: uuid.UUID,
    job_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
) -> CleanupResponse:
    """BE-REFINE-010: 패널을 닫을 때 남은 미승인 결과를 정리한다."""
    chat, branch = _load(db, user, chat_id, branch_id)
    job = refine_service.get_job(db, chat, branch, job_id)
    return CleanupResponse(
        refine_job_id=job.id, cleaned_count=refine_service.cleanup_unapproved(db, job)
    )
