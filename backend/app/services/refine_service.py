"""블록별 정제 서비스 ."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.exceptions import AppError, ValidationError
from app.models import (
    BlockRefineJob,
    BlockRefineResult,
    BlockRefineTarget,
    Branch,
    Chat,
    MessageBlock,
    RefineJobStatus,
    RefineResultStatus,
    VersionSourceType,
    User,
)
from app.services import branch_service, message_service, user_setting_service

MAX_INSTRUCTION_LENGTH = 2_000
MAX_BLOCKS_PER_JOB = 20


@dataclass(frozen=True)
class BulkRefineFailure:
    resource_id: uuid.UUID
    error_code: str
    message: str


class RefineJobNotFoundError(AppError):
    status_code = 404
    error_code = "REFINE_JOB_NOT_FOUND"
    message = "정제 작업을 찾을 수 없습니다."


class RefineResultNotFoundError(AppError):
    status_code = 404
    error_code = "REFINE_RESULT_NOT_FOUND"
    message = "정제 결과를 찾을 수 없습니다."


class RefineResultNotPendingError(AppError):
    status_code = 409
    error_code = "REFINE_RESULT_NOT_PENDING"
    message = "이미 승인하거나 거절한 정제 결과입니다."


class AiRefineFailedError(AppError):
    status_code = 502
    error_code = "AI_REFINE_FAILED"
    message = "정제 결과를 생성하지 못했습니다. 잠시 후 다시 시도해주세요."


def normalize_instruction(instruction: str) -> str:
    """자연어 편집 지시 검증 . 저장하지 않고 실행 시점에만 쓴다."""
    text = (instruction or "").strip()
    if not text:
        raise ValidationError("편집 지시를 입력해주세요.")
    if len(text) > MAX_INSTRUCTION_LENGTH:
        raise ValidationError(
            f"편집 지시는 {MAX_INSTRUCTION_LENGTH}자를 넘을 수 없습니다."
        )
    return text


def run_refine(
    db: Session,
    user: User,
    chat: Chat,
    branch: Branch,
    block_ids: list[uuid.UUID],
    instruction: str,
    refiner=None,
) -> BlockRefineJob:
    """정제 실행 (, 002, 003).

    선택 블록의 현재 활성 버전을 기준으로 고정한 뒤 AI에 넘긴다. 정제가 도는 동안
    사용자가 원본을 수정하더라도, 승인 시점에 비교·반영되는 기준은 흔들리지 않는다.
    """
    instruction = normalize_instruction(instruction)
    api_key = user_setting_service.require_api_key(db, user)

    if not block_ids:
        raise ValidationError("정제할 블록을 선택해주세요.")
    if len(block_ids) > MAX_BLOCKS_PER_JOB:
        raise ValidationError(
            f"한 번에 정제할 수 있는 블록은 {MAX_BLOCKS_PER_JOB}개까지입니다."
        )

    valid_ids, invalid_ids = message_service.validate_selection(db, branch, block_ids)
    if invalid_ids:
        raise ValidationError(
            "선택한 블록 중 이 브랜치에 없는 것이 있습니다.",
            detail={"invalidBlockIds": [str(i) for i in invalid_ids]},
        )

    blocks = {b.id: b for b in branch_service.resolve_blocks(db, branch)}

    # 조상 브랜치에서 이어받은 블록을 정제·승인하면 원본 대화가 조용히 바뀌므로 막는다
    inherited_ids = [bid for bid in valid_ids if blocks[bid].branch_id != branch.id]
    if inherited_ids:
        raise ValidationError(
            "다른 브랜치에서 이어받은 메시지는 이 브랜치에서 정제할 수 없습니다.",
            detail={"inheritedBlockIds": [str(i) for i in inherited_ids]},
        )

    ordered = sorted((blocks[bid] for bid in valid_ids), key=lambda b: b.order_index)
    for block in ordered:
        message_service.ensure_generation_complete(block)

    job = BlockRefineJob(
        chat_id=chat.id, branch_id=branch.id, instruction_text=instruction
    )
    db.add(job)
    db.flush()

    targets = []
    for block in ordered:
        version = block.current_version
        if version is None:
            raise ValidationError("본문이 없는 블록은 정제할 수 없습니다.")
        target = BlockRefineTarget(
            job_id=job.id,
            block_id=block.id,
            base_version_id=version.id,
            base_content=version.content,
            role=block.role,
            order_index=block.order_index,
        )
        db.add(target)
        targets.append(target)
    db.flush()

    try:
        refined = _call_refiner(targets, instruction, api_key, refiner)
    except Exception as exc:
        job.status = RefineJobStatus.FAILED
        db.commit()
        raise AiRefineFailedError() from exc

    for target in targets:
        db.add(
            BlockRefineResult(
                job_id=job.id,
                block_id=target.block_id,
                base_version_id=target.base_version_id,
                refined_content=refined[target.block_id],
                status=RefineResultStatus.PENDING,
            )
        )

    job.status = RefineJobStatus.COMPLETED
    chat.last_activity_at = datetime.now(UTC)
    db.commit()
    db.refresh(job)
    return job


def _call_refiner(
    targets: list[BlockRefineTarget],
    instruction: str,
    api_key: str,
    refiner=None,
) -> dict[uuid.UUID, str]:
    """AI 모델링 파트에 정제를 요청한다 .

    돌아온 결과가 요청한 블록과 정확히 일대일로 맞는지 확인한다. 어긋난 채로
    저장하면 사용자가 승인한 것과 다른 내용이 원본에 반영된다.
    """
    from modeling import refine_blocks
    from modeling.types import RefineTarget

    call = refiner or refine_blocks
    results = call(
        [
            RefineTarget(
                block_id=str(t.block_id), role=t.role.value, content=t.base_content
            )
            for t in targets
        ],
        instruction,
        api_key=api_key,
    )

    mapped = {uuid.UUID(r.block_id): r.refined_content.strip() for r in results}
    requested = {t.block_id for t in targets}
    if set(mapped) != requested or any(not v for v in mapped.values()):
        raise ValueError("정제 결과가 요청한 블록과 일치하지 않습니다.")
    return mapped


def get_job(db: Session, chat: Chat, branch: Branch, job_id: uuid.UUID) -> BlockRefineJob:
    """정제 작업 접근 권한 검증 ."""
    job = db.get(BlockRefineJob, job_id)
    if job is None or job.chat_id != chat.id or job.branch_id != branch.id:
        raise RefineJobNotFoundError()
    return job


def list_results(db: Session, job: BlockRefineJob) -> list[BlockRefineResult]:
    """정제 결과 목록 (, 009). 원본 순서대로 돌려준다."""
    targets = {t.block_id: t for t in job.targets}
    results = list(job.results)
    return sorted(
        results,
        key=lambda r: targets[r.block_id].order_index if r.block_id in targets else 0,
    )


def base_content_map(job: BlockRefineJob) -> dict[uuid.UUID, tuple[str, int]]:
    """블록별 (정제 기준 본문, 순번). 원본/정제본 비교에 쓴다."""
    return {t.block_id: (t.base_content, t.order_index) for t in job.targets}


def approve(
    db: Session, chat: Chat, branch: Branch, result: BlockRefineResult
) -> BlockRefineResult:
    """정제 결과 승인 .

    정제본을 새 버전으로 저장하고 활성화한다. 이전 내용은 이력에 남으므로
    되돌리기는 버전 이동으로 처리한다.
    """
    if result.status is not RefineResultStatus.PENDING:
        raise RefineResultNotPendingError()

    block = db.get(MessageBlock, result.block_id)
    if block is None:
        raise RefineResultNotFoundError("대상 메시지 블록이 없습니다.")

    message_service.add_version(
        db, chat, block, result.refined_content, VersionSourceType.AI_REFINE
    )

    result.status = RefineResultStatus.APPROVED
    result.approved_version_id = block.current_version_id
    db.commit()
    db.refresh(result)
    return result


def reject(db: Session, result: BlockRefineResult) -> BlockRefineResult:
    """정제 결과 거절 . 원본 활성 버전은 건드리지 않는다."""
    if result.status is not RefineResultStatus.PENDING:
        raise RefineResultNotPendingError()

    result.status = RefineResultStatus.REJECTED
    db.commit()
    db.refresh(result)
    return result


def get_result(
    db: Session, job: BlockRefineJob, result_id: uuid.UUID
) -> BlockRefineResult:
    result = db.get(BlockRefineResult, result_id)
    if result is None or result.job_id != job.id:
        raise RefineResultNotFoundError()
    return result


def approve_all(
    db: Session, chat: Chat, branch: Branch, job: BlockRefineJob
) -> tuple[list[BlockRefineResult], list[BulkRefineFailure]]:
    """대기 중인 결과를 한 번에 승인한다 .

    하나가 실패해도 나머지는 반영한다. 실패 항목은 따로 알려 FE가 표시할 수 있게 한다.
    """
    approved, failed = [], []
    for result in list_results(db, job):
        if result.status is not RefineResultStatus.PENDING:
            continue
        try:
            approved.append(approve(db, chat, branch, result))
        except AppError as exc:
            db.rollback()
            failed.append(
                BulkRefineFailure(result.id, exc.error_code, exc.message)
            )
        except Exception:
            db.rollback()
            failed.append(
                BulkRefineFailure(
                    result.id,
                    "REFINE_ITEM_FAILED",
                    "항목을 승인하지 못했습니다.",
                )
            )
    return approved, failed


def reject_all(
    db: Session, job: BlockRefineJob
) -> tuple[list[BlockRefineResult], list[BulkRefineFailure]]:
    """대기 중인 결과를 한 번에 거절한다 ."""
    rejected, failed = [], []
    for result in list_results(db, job):
        if result.status is not RefineResultStatus.PENDING:
            continue
        try:
            rejected.append(reject(db, result))
        except AppError as exc:
            db.rollback()
            failed.append(
                BulkRefineFailure(result.id, exc.error_code, exc.message)
            )
        except Exception:
            db.rollback()
            failed.append(
                BulkRefineFailure(
                    result.id,
                    "REFINE_ITEM_FAILED",
                    "항목을 거절하지 못했습니다.",
                )
            )
    return rejected, failed


def cleanup_unapproved(db: Session, job: BlockRefineJob) -> int:
    """미승인 결과 정리 .

    대기 중인 결과를 거절로 확정한다. 정제 미리보기를 닫으면 화면에서 사라지므로,
    남겨두면 나중에 되살아난 것처럼 보인다. 이미 승인된 결과는 건드리지 않는다.
    """
    cleaned = 0
    for result in job.results:
        if result.status is RefineResultStatus.PENDING:
            result.status = RefineResultStatus.REJECTED
            cleaned += 1
    if cleaned:
        db.commit()
    return cleaned
