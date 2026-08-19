"""AI 응답 관리 서비스 (BE-AIRESP-001~005).

답변 생성은 정제와 마찬가지로 요청 한 번 안에서 동기로 처리한다.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.exceptions import AppError, ValidationError
from app.models import (
    Branch,
    Chat,
    AiResponseFeedback,
    AiResponseRating,
    MessageBlock,
    MessageRole,
    User,
    VersionSourceType,
)
from app.services import (
    chat_service,
    context_service,
    message_service,
    user_setting_service,
)


class AiResponseFailedError(AppError):
    status_code = 502
    error_code = "AI_RESPONSE_FAILED"
    message = "답변을 생성하지 못했습니다. 잠시 후 다시 시도해주세요."


class NotAssistantBlockError(AppError):
    status_code = 400
    error_code = "NOT_ASSISTANT_BLOCK"
    message = "AI 답변 블록이 아닙니다."


@dataclass(frozen=True)
class SendResult:
    user_block: MessageBlock
    assistant_block: MessageBlock
    context_items: list[context_service.ContextItem]
    title_generated: bool


def send_message(
    db: Session,
    user: User,
    chat: Chat,
    branch: Branch,
    user_prompt: str,
    context_block_ids: list[uuid.UUID] | None = None,
    answerer=None,
    titler=None,
) -> SendResult:
    """메시지 전송부터 답변 저장까지 (BE-CTXAPPLY-001~003, BE-AIRESP-001, 002).

    적용 Context 가 있으면 AI 는 그것을 우선 기준으로 답한다(NFR-011).
    """
    prompt = (user_prompt or "").strip()
    if not prompt:
        raise ValidationError("질문을 입력해주세요.")

    # 키가 없으면 질문을 저장하기 전에 막는다(BE-USERSET-006).
    api_key = user_setting_service.require_api_key(db, user)

    context_items = context_service.build_snapshot(
        db, branch, context_block_ids or []
    )

    # 사용자 블록을 만들기 전에 흐름을 읽는다. 방금 넣은 질문이 이전 대화로
    # 섞여 들어가면 같은 내용이 두 번 전달된다.
    prior_flow = message_service.active_message_flow(db, branch)
    is_first_message = not prior_flow

    # Context 를 골랐다는 건 나머지 대화는 빼고 묻겠다는 뜻이다. 이전 흐름을 함께
    # 넣으면 최근 대화가 Context 를 눌러, 고르지 않은 주제로 답이 흘러간다.
    # 선택한 블록만 모델에 전달한다(NFR-011).
    if context_items:
        prior_flow = []

    user_block = message_service.create_block(
        db, chat, branch, MessageRole.USER, prompt
    )
    context_service.save_log(db, chat, branch, user_block.id, context_items)
    db.commit()

    try:
        answer = _generate(prompt, prior_flow, context_items, api_key, answerer)
    except Exception as exc:
        # 질문은 남겨 둔다. 지워 버리면 사용자가 다시 입력해야 한다.
        db.commit()
        raise AiResponseFailedError() from exc

    assistant_block = message_service.create_block(
        db, chat, branch, MessageRole.ASSISTANT, answer
    )

    title_generated = False
    if is_first_message and chat.title == chat_service.DEFAULT_TITLE:
        title_generated = _try_generate_title(db, chat, prompt, api_key, titler)

    return SendResult(
        user_block=user_block,
        assistant_block=assistant_block,
        context_items=context_items,
        title_generated=title_generated,
    )


def regenerate(
    db: Session,
    user: User,
    chat: Chat,
    branch: Branch,
    block_id: uuid.UUID,
    answerer=None,
) -> MessageBlock:
    """답변 재생성 (BE-AIRESP-003).

    새 블록을 만들지 않고 같은 블록에 버전을 추가한다. 사용자는 버전 이동으로
    이전 답변과 비교할 수 있다(REQ-050).
    """
    api_key = user_setting_service.require_api_key(db, user)
    block = message_service.get_editable_block(db, branch, block_id)
    if block.role is not MessageRole.ASSISTANT:
        raise NotAssistantBlockError()

    flow = message_service.active_message_flow(db, branch)
    preceding = [t for t in flow if t.order_index < block.order_index]

    # 바로 앞 질문이 이 답변의 원래 질문이다. 같은 내용의 질문이 앞에 또 있을 수
    # 있으므로 내용이 아니라 위치로 가른다.
    last_user_index = next(
        (
            i
            for i in range(len(preceding) - 1, -1, -1)
            if preceding[i].role is MessageRole.USER
        ),
        None,
    )
    if last_user_index is None:
        raise ValidationError("이 답변에 대응하는 질문을 찾을 수 없습니다.")

    prompt = preceding[last_user_index].content
    history = preceding[:last_user_index]

    try:
        answer = _generate(prompt, history, [], api_key, answerer)
    except Exception as exc:
        raise AiResponseFailedError() from exc

    return message_service.add_version(
        db, chat, block, answer, VersionSourceType.AI_REGENERATE
    )


def get_feedback(
    db: Session, user: User, branch: Branch, block_id: uuid.UUID
) -> AiResponseFeedback | None:
    """현재 사용자의 AI 답변 평가를 조회한다 (BE-AIRESP-004)."""
    _require_assistant_block(db, branch, block_id)
    return db.scalar(
        select(AiResponseFeedback).where(
            AiResponseFeedback.user_id == user.id,
            AiResponseFeedback.message_block_id == block_id,
        )
    )


def set_feedback(
    db: Session,
    user: User,
    branch: Branch,
    block_id: uuid.UUID,
    rating: AiResponseRating | None,
) -> AiResponseFeedback | None:
    """좋아요·싫어요를 저장·변경하고, null이면 기존 평가를 해제한다."""
    _require_assistant_block(db, branch, block_id)
    feedback = db.scalar(
        select(AiResponseFeedback).where(
            AiResponseFeedback.user_id == user.id,
            AiResponseFeedback.message_block_id == block_id,
        )
    )

    if rating is None:
        if feedback is not None:
            db.delete(feedback)
            db.commit()
        return None

    if feedback is None:
        feedback = AiResponseFeedback(
            user_id=user.id, message_block_id=block_id, rating=rating
        )
        db.add(feedback)
    else:
        feedback.rating = rating
    db.commit()
    db.refresh(feedback)
    return feedback


def _require_assistant_block(
    db: Session, branch: Branch, block_id: uuid.UUID
) -> MessageBlock:
    block = message_service.get_editable_block(db, branch, block_id)
    if block.role is not MessageRole.ASSISTANT:
        raise NotAssistantBlockError()
    return block


def _generate(
    prompt: str,
    flow: list[message_service.ActiveTurn],
    context_items: list[context_service.ContextItem],
    api_key: str,
    answerer=None,
) -> str:
    from modeling import generate_answer
    from modeling.types import AnswerRequest, ChatTurn

    call = answerer or generate_answer
    request = AnswerRequest(
        user_prompt=prompt,
        message_flow=[ChatTurn(role=t.role.value, content=t.content) for t in flow],
        applied_context=[item.content for item in context_items],
    )
    # 모델링은 답변 본문과 검색 근거를 함께 돌려준다. 근거 저장은 아직 없어
    # 본문만 쓴다. 테스트가 문자열을 돌려주는 가짜 함수를 넣는 경우도 받는다.
    result = call(request, api_key=api_key)
    answer = (getattr(result, "text", result) or "").strip()
    if not answer:
        raise ValueError("답변이 비어 있습니다.")
    return answer


def _try_generate_title(
    db: Session, chat: Chat, prompt: str, api_key: str, titler=None
) -> bool:
    """첫 질문으로 대화 제목을 짓는다 (BE-CHAT-004).

    제목은 부가 정보라, 실패해도 대화 자체는 정상 진행되어야 한다.
    """
    from modeling import generate_title

    call = titler or generate_title
    try:
        chat_service.update_title(db, chat, call(prompt, api_key=api_key))
        return True
    except Exception:
        return False
