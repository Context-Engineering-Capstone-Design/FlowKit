"""메시지 전송·답변 라우터 (2.7 Context 적용, 2.8 AI 응답 관리)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter

from app.deps import CurrentUser, DbSession
from app.schemas.conversation import (
    AppliedContextOut,
    SendMessageRequest,
    SendMessageResponse,
)
from app.schemas.message import BlockResponse
from app.services import ai_response_service, branch_service, chat_service

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
        db, chat, branch, payload.user_prompt, payload.context_block_ids
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
    )


@router.post("/blocks/{block_id}/regenerate", response_model=BlockResponse)
def regenerate(
    chat_id: uuid.UUID,
    branch_id: uuid.UUID,
    block_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
) -> BlockResponse:
    """BE-AIRESP-003: 답변을 다시 생성해 같은 블록의 새 버전으로 추가한다."""
    chat, branch = _load(db, user, chat_id, branch_id)
    block = ai_response_service.regenerate(db, chat, branch, block_id)
    return BlockResponse.of(block)
