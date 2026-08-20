"""메시지 전송·답변 라우터 (2.7 Context 적용, 2.8 AI 응답 관리)."""

from __future__ import annotations

import queue
import uuid

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.deps import CurrentUser, DbSession
from app.models import AiResponseJobStatus, MessageBlock
from app.schemas.conversation import (
    AppliedContextOut,
    FeedbackMutationResponse,
    FeedbackRequest,
    FeedbackResponse,
    SendMessageRequest,
    SendMessageResponse,
)
from app.schemas.message import BlockMutationResponse, BlockResponse
from app.schemas.notification import ActionMeta
from app.schemas.input_assist import AttachmentOut, SearchSourceOut
from app.schemas.ai_response import RegenerateResponse
from app.services import ai_response_service, branch_service, chat_service, context_service, streaming_service

router = APIRouter(
    prefix="/api/chats/{chat_id}/branches/{branch_id}", tags=["Conversation"]
)


def _load(db, user, chat_id: uuid.UUID, branch_id: uuid.UUID):
    chat = chat_service.get_owned_chat(db, user, chat_id)
    branch = branch_service.get_branch_in_chat(db, chat, branch_id)
    return chat, branch


@router.post("/messages", response_model=SendMessageResponse, status_code=201)
def send_message(
    chat_id: uuid.UUID,
    branch_id: uuid.UUID,
    payload: SendMessageRequest,
    user: CurrentUser,
    db: DbSession,
) -> SendMessageResponse:
    """BE-CTXAPPLY-001~003, BE-AIRESP-001, 002: 질문 저장 → 답변 생성 → 저장.

    contextBlockIds 를 주면 AI 는 그 내용을 우선 기준으로 답한다.
    """
    chat, branch = _load(db, user, chat_id, branch_id)
    result = ai_response_service.send_message(
        db, user, chat, branch, payload.user_prompt, payload.context_block_ids,
        payload.selected_model_id, payload.web_search_mode, payload.attachment_ids,
        payload.reasoning_effort, payload.library_resource_ids,
        context_ranges=[
            context_service.ContextRangeSpec(
                block_id=r.block_id, version_id=r.version_id, snippet_text=r.snippet_text
            )
            for r in payload.context_ranges
        ],
    )
    return SendMessageResponse(
        user_block=BlockResponse.of(result.user_block),
        assistant_block=BlockResponse.of(result.assistant_block),
        applied_context=[
            AppliedContextOut(
                block_id=i.block_id, version_id=i.version_id, order_index=i.order_index
            )
            for i in result.context_items
        ],
        chat_title=chat.title,
        title_generated=result.title_generated,
        selected_model=result.selected_model,
        web_search_mode=result.web_search_mode,
        reasoning_effort=result.reasoning_effort,
        attachments=[_attachment_out(item) for item in result.attachments],
        search_sources=[SearchSourceOut(title=item.title, url=item.url) for item in result.search_sources],
        ai_response_job_id=result.job.id,
        job_status=result.job.status.value,
        action_meta=ActionMeta(
            action_type="message_send",
            success_code="MESSAGE_SENT",
            message="메시지를 보내고 답변을 생성했습니다.",
            affected_resource_id=result.assistant_block.id,
        ),
    )


def _attachment_out(item) -> AttachmentOut:
    return AttachmentOut(
        attachment_id=item.id, file_name=item.file_name, mime_type=item.mime_type,
        file_size=item.file_size, status=item.status.value, expires_at=item.expires_at,
    )


@router.post("/blocks/{block_id}/regenerate", response_model=RegenerateResponse)
def regenerate(
    chat_id: uuid.UUID,
    branch_id: uuid.UUID,
    block_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
) -> RegenerateResponse:
    """BE-AIRESP-003: 답변을 다시 생성해 같은 블록의 새 버전으로 추가한다."""
    chat, branch = _load(db, user, chat_id, branch_id)
    result = ai_response_service.regenerate(db, user, chat, branch, block_id)
    return RegenerateResponse(
        **BlockResponse.of(result.block).model_dump(),
        ai_response_job_id=result.job.id,
        job_status=result.job.status.value,
        action_meta=ActionMeta(
            action_type="ai_response_regenerate",
            success_code="AI_RESPONSE_REGENERATED",
            message="답변을 다시 생성했습니다.",
            affected_resource_id=result.block.id,
        ),
    )


@router.post("/ai-response-jobs/{job_id}/retry", response_model=SendMessageResponse, status_code=201)
def retry_ai_response_job(chat_id: uuid.UUID, branch_id: uuid.UUID, job_id: uuid.UUID, user: CurrentUser, db: DbSession) -> SendMessageResponse:
    chat, branch = _load(db, user, chat_id, branch_id)
    result = ai_response_service.retry_failed_job(db, user, chat, branch, job_id)
    return SendMessageResponse(
        user_block=BlockResponse.of(result.user_block), assistant_block=BlockResponse.of(result.assistant_block),
        applied_context=[AppliedContextOut(block_id=i.block_id, version_id=i.version_id, order_index=i.order_index) for i in result.context_items],
        chat_title=chat.title, title_generated=result.title_generated, selected_model=result.selected_model,
        web_search_mode=result.web_search_mode, attachments=[_attachment_out(i) for i in result.attachments],
        reasoning_effort=result.reasoning_effort,
        search_sources=[SearchSourceOut(title=i.title, url=i.url) for i in result.search_sources],
        ai_response_job_id=result.job.id, job_status=result.job.status.value,
        action_meta=ActionMeta(
            action_type="ai_response_retry",
            success_code="AI_RESPONSE_RETRY_SUCCEEDED",
            message="답변 생성을 다시 완료했습니다.",
            affected_resource_id=result.assistant_block.id,
        ),
    )


@router.get("/ai-response-jobs/{job_id}/stream")
def stream_ai_response(
    chat_id: uuid.UUID,
    branch_id: uuid.UUID,
    job_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
) -> StreamingResponse:
    """BE-AIRESP-007, 009: 생성 조각을 실시간으로 흘려보내고, 도중 붙어도 이어서 본다.

    이 프로세스가 그 작업을 모르면(이미 끝났거나 서버가 재시작됐으면) DB의
    최종 상태 한 번만 보내고 닫는다(B6).
    """
    chat, branch = _load(db, user, chat_id, branch_id)
    job = ai_response_service.get_owned_job(db, user, chat, branch, job_id)

    def events():
        snap = streaming_service.subscribe(job_id)
        if snap is None:
            block = db.get(MessageBlock, job.assistant_message_block_id)
            version = block.current_version if block else None
            content = version.content if version else ""
            sources = (version.search_sources if version else None) or []
            status = (
                job.status.value
                if job.status is not AiResponseJobStatus.GENERATING
                else "failed"
            )
            error = (
                {"errorCode": job.error_code, "message": job.error_message}
                if job.error_code
                else None
            )
            yield streaming_service.format_sse(
                "status",
                {"status": status, "content": content, "sources": sources, "error": error},
            )
            return

        if snap.buffer:
            yield streaming_service.format_sse("text", {"delta": snap.buffer})
        if snap.sources:
            yield streaming_service.format_sse("sources", {"sources": snap.sources})
        while True:
            try:
                item = snap.queue.get(timeout=20)
            except queue.Empty:
                yield ": ping\n\n"
                continue
            if item is None:
                break
            event, data = item
            yield streaming_service.format_sse(event, data)

    return StreamingResponse(events(), media_type="text/event-stream")


@router.post("/ai-response-jobs/{job_id}/cancel", response_model=BlockMutationResponse)
def cancel_ai_response_job(
    chat_id: uuid.UUID,
    branch_id: uuid.UUID,
    job_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
) -> BlockMutationResponse:
    """BE-AIRESP-008: 생성 중인 답변을 중단한다. 그때까지의 본문은 남긴다."""
    chat, branch = _load(db, user, chat_id, branch_id)
    block = ai_response_service.cancel_job(db, user, chat, branch, job_id)
    return BlockMutationResponse(
        **BlockResponse.of(block).model_dump(),
        action_meta=ActionMeta(
            action_type="ai_response_cancel",
            success_code="AI_RESPONSE_CANCELLED",
            message="답변 생성을 중단했습니다.",
            affected_resource_id=block.id,
        ),
    )


@router.get("/blocks/{block_id}/feedback", response_model=FeedbackResponse)
def get_feedback(
    chat_id: uuid.UUID,
    branch_id: uuid.UUID,
    block_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
) -> FeedbackResponse:
    """BE-AIRESP-004: 현재 사용자의 해당 AI 답변 평가를 조회한다."""
    _, branch = _load(db, user, chat_id, branch_id)
    feedback = ai_response_service.get_feedback(db, user, branch, block_id)
    return _feedback_response(block_id, feedback)


@router.put("/blocks/{block_id}/feedback", response_model=FeedbackMutationResponse)
def set_feedback(
    chat_id: uuid.UUID,
    branch_id: uuid.UUID,
    block_id: uuid.UUID,
    payload: FeedbackRequest,
    user: CurrentUser,
    db: DbSession,
) -> FeedbackMutationResponse:
    """BE-AIRESP-004: like/dislike 저장·변경 또는 null로 해제한다."""
    _, branch = _load(db, user, chat_id, branch_id)
    rating = (
        None
        if payload.rating is None
        else ai_response_service.AiResponseRating(payload.rating)
    )
    feedback = ai_response_service.set_feedback(db, user, branch, block_id, rating)
    response = _feedback_response(block_id, feedback)
    return FeedbackMutationResponse(
        **response.model_dump(),
        action_meta=ActionMeta(
            action_type="ai_response_feedback_update",
            success_code="AI_RESPONSE_FEEDBACK_UPDATED",
            message="답변 평가를 반영했습니다.",
            affected_resource_id=block_id,
        ),
    )


def _feedback_response(
    block_id: uuid.UUID, feedback
) -> FeedbackResponse:
    return FeedbackResponse(
        ai_message_block_id=block_id,
        rating=feedback.rating.value if feedback else None,
        updated_at=feedback.updated_at if feedback else None,
    )
