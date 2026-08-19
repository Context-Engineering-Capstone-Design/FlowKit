from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class ApiKeyConnectionStatus(str, enum.Enum):
    UNCHECKED = "unchecked"
    CONNECTED = "connected"
    FAILED = "failed"


class UserApiKey(Base, TimestampMixin):
    __tablename__ = "user_api_keys"
    __table_args__ = (
        UniqueConstraint("user_id", "provider", name="uq_user_api_key_provider"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    provider: Mapped[str] = mapped_column(String(32))
    encrypted_api_key: Mapped[str] = mapped_column(Text)
    last4: Mapped[str] = mapped_column(String(4))
    connection_status: Mapped[ApiKeyConnectionStatus] = mapped_column(
        Enum(ApiKeyConnectionStatus, name="api_key_connection_status"),
        default=ApiKeyConnectionStatus.UNCHECKED,
    )
    connection_message: Mapped[str | None] = mapped_column(
        String(200), nullable=True
    )
    last_checked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
