from __future__ import annotations
import enum, uuid
from sqlalchemy import Enum, ForeignKey, JSON, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, TimestampMixin
class FeedbackType(str, enum.Enum):
    ERROR="error"; USABILITY="usability"; CONTEXT="context"; BRANCH="branch"; OTHER="other"
class ServiceFeedback(Base, TimestampMixin):
    __tablename__="service_feedbacks"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    feedback_type: Mapped[FeedbackType] = mapped_column(
        Enum(FeedbackType, name="feedback_type", values_callable=lambda x: [e.value for e in x])
    )
    content: Mapped[str] = mapped_column(Text)
    context_info: Mapped[dict | None] = mapped_column(JSON, nullable=True)
