"""블록별 정제 라우터 (2.6 블록별 정제)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter

from app.deps import CurrentUser, DbSession
from app.models import BlockRefineJob, BlockRefineResult
from app.schemas.notification import ActionMeta
from app.schemas.refine import (
    BulkRefineFailure,
    BulkRefineResponse,
    CleanupResponse,
    RefineJobMutationResponse,
    RefineJobResponse,
    RefineResultMutationOut,
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


def _result_mutation(
    result: BlockRefineResult,
    job: BlockRefineJob,
    *,
    action_type: str,
    success_code: str,
    message: str,
) -> RefineResultMutationOut:
    response = _result_out(result, job)
    return RefineResultMutationOut(
        **response.model_dump(),
        action_meta=ActionMeta(
            action_type=action_type,
            success_code=success_code,
            message=message,
            affected_resource_id=result.id,
        ),
    )


def _bulk_response(
    *,
    action_type: str,
    success_message: str,
    job: BlockRefineJob,
    processed: list[BlockRefineResult],
    failed: list[refine_service.BulkRefineFailure],
) -> BulkRefineResponse:
    total = len(processed) + len(failed)
    if failed:
        success_code = "PARTIAL_SUCCESS"
        message = f"{total}개 중 {len(processed)}개를 처리했습니다."
    else:
        success_code = "SUCCESS"
        message = success_message
    return BulkRefineResponse(
        processed=[_result_out(result, job) for result in processed],
        failed=[
            BulkRefineFailure(
                resource_id=item.resource_id,
                error_code=item.error_code,
                message=item.message,
                result_id=item.resource_id,
                reason=item.message,
            )
            for item in failed
        ],
        action_meta=ActionMeta(
            action_type=action_type,
            success_code=success_code,
            message=message,
            affected_resource_id=job.id,
        ),
    )


@router.post("", response_model=RefineJobMutationResponse, status_code=201)
def run_refine(
    chat_id: uuid.UUID,
    branch_id: uuid.UUID,
    payload: RunRefineRequest,
    user: CurrentUser,
    db: DbSession,
) -> RefineJobMutationResponse:
    """선택 블록을 각각 정제하고 결과를 대기 상태로 저장한다."""
    chat, branch = _load(db, user, chat_id, branch_id)
    job = refine_service.run_refine(
        db, user, chat, branch, payload.selected_block_ids, payload.instruction_text
    )
    response = _job_response(db, job)
    return RefineJobMutationResponse(
        **response.model_dump(),
        action_meta=ActionMeta(
            action_type="refine_run",
            success_code="REFINE_COMPLETED",
            message="선택한 메시지의 정제 결과를 만들었습니다.",
            affected_resource_id=job.id,
        ),
    )


@router.get("/{job_id}", response_model=RefineJobResponse)
def get_job(
    chat_id: uuid.UUID,
    branch_id: uuid.UUID,
    job_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
) -> RefineJobResponse:
    """, 009: 원본·정제본 비교와 상태 동기화용 조회."""
    chat, branch = _load(db, user, chat_id, branch_id)
    job = refine_service.get_job(db, chat, branch, job_id)
    return _job_response(db, job)


@router.post(
    "/{job_id}/results/{result_id}/approve",
    response_model=RefineResultMutationOut,
)
def approve(
    chat_id: uuid.UUID,
    branch_id: uuid.UUID,
    job_id: uuid.UUID,
    result_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
) -> RefineResultMutationOut:
    """승인 즉시 정제본을 새 버전으로 반영한다."""
    chat, branch = _load(db, user, chat_id, branch_id)
    job = refine_service.get_job(db, chat, branch, job_id)
    result = refine_service.get_result(db, job, result_id)
    approved = refine_service.approve(db, chat, branch, result)
    return _result_mutation(
        approved,
        job,
        action_type="refine_result_approve",
        success_code="REFINE_RESULT_APPROVED",
        message="정제 결과를 반영했습니다.",
    )


@router.post(
    "/{job_id}/results/{result_id}/reject", response_model=RefineResultMutationOut
)
def reject(
    chat_id: uuid.UUID,
    branch_id: uuid.UUID,
    job_id: uuid.UUID,
    result_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
) -> RefineResultMutationOut:
    """거절. 원본 활성 버전은 그대로 둔다."""
    chat, branch = _load(db, user, chat_id, branch_id)
    job = refine_service.get_job(db, chat, branch, job_id)
    result = refine_service.get_result(db, job, result_id)
    rejected = refine_service.reject(db, result)
    return _result_mutation(
        rejected,
        job,
        action_type="refine_result_reject",
        success_code="REFINE_RESULT_REJECTED",
        message="정제 결과를 거절했습니다.",
    )


@router.post("/{job_id}/approve-all", response_model=BulkRefineResponse)
def approve_all(
    chat_id: uuid.UUID,
    branch_id: uuid.UUID,
    job_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
) -> BulkRefineResponse:
    """대기 중인 결과 전체 승인."""
    chat, branch = _load(db, user, chat_id, branch_id)
    job = refine_service.get_job(db, chat, branch, job_id)
    approved, failed = refine_service.approve_all(db, chat, branch, job)
    return _bulk_response(
        action_type="bulk_refine_approve",
        success_message=f"{len(approved)}개 정제 결과를 반영했습니다.",
        job=job,
        processed=approved,
        failed=failed,
    )


@router.post("/{job_id}/reject-all", response_model=BulkRefineResponse)
def reject_all(
    chat_id: uuid.UUID,
    branch_id: uuid.UUID,
    job_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
) -> BulkRefineResponse:
    """대기 중인 결과 전체 거절."""
    chat, branch = _load(db, user, chat_id, branch_id)
    job = refine_service.get_job(db, chat, branch, job_id)
    rejected, failed = refine_service.reject_all(db, job)
    return _bulk_response(
        action_type="bulk_refine_reject",
        success_message=f"{len(rejected)}개 정제 결과를 거절했습니다.",
        job=job,
        processed=rejected,
        failed=failed,
    )


@router.post("/{job_id}/cleanup", response_model=CleanupResponse)
def cleanup(
    chat_id: uuid.UUID,
    branch_id: uuid.UUID,
    job_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
) -> CleanupResponse:
    """패널을 닫을 때 남은 미승인 결과를 정리한다."""
    chat, branch = _load(db, user, chat_id, branch_id)
    job = refine_service.get_job(db, chat, branch, job_id)
    cleaned_count = refine_service.cleanup_unapproved(db, job)
    return CleanupResponse(
        refine_job_id=job.id,
        cleaned_count=cleaned_count,
        action_meta=ActionMeta(
            action_type="refine_cleanup",
            success_code="REFINE_CLEANED_UP",
            message=f"{cleaned_count}개 미승인 결과를 정리했습니다.",
            affected_resource_id=job.id,
        ),
    )
