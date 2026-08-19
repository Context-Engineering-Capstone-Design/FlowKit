from __future__ import annotations

import enum
import uuid

from sqlalchemy import Enum, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class AiResponseRating(str, enum.Enum):
    LIKE = "like"
    DISLIKE = "dislike"


class AiResponseFeedback(Base, TimestampMixin):
    """사용자별 AI 답변 평가. 같은 답변에는 하나의 평가만 유지한다."""

    __tablename__ = "ai_response_feedbacks"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    message_block_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("message_blocks.id", ondelete="CASCADE"), index=True
    )
    rating: Mapped[AiResponseRating] = mapped_column(
        Enum(AiResponseRating, name="ai_response_rating")
    )

    __table_args__ = (
        UniqueConstraint("user_id", "message_block_id", name="uq_ai_feedback_user_block"),
    )
