from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import ServiceFeedback, User
from app.schemas.service_feedback import FeedbackRequest


def submit(
    db: Session, user: User, payload: FeedbackRequest
) -> ServiceFeedback:
    """허용된 화면 식별 정보만 보존해 서비스 피드백을 저장한다."""

    context_info = None
    if payload.context_info is not None:
        context_info = payload.context_info.model_dump(
            mode="json", by_alias=True, exclude_none=True
        ) or None

    item = ServiceFeedback(
        user_id=user.id,
        feedback_type=payload.feedback_type,
        content=payload.content,
        context_info=context_info,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item
