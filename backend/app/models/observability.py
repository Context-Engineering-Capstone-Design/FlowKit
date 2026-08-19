from __future__ import annotations
import uuid
from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base
class ErrorLog(Base):
    __tablename__='error_logs'
    trace_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'), nullable=True, index=True)
    request_path: Mapped[str] = mapped_column(String(300)); method: Mapped[str] = mapped_column(String(10)); error_code: Mapped[str] = mapped_column(String(80)); message: Mapped[str] = mapped_column(String(300)); exception_type: Mapped[str | None] = mapped_column(String(100), nullable=True); status_code: Mapped[int] = mapped_column(Integer); created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
class ClientErrorLog(Base):
    __tablename__='client_error_logs'
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    trace_id: Mapped[str] = mapped_column(String(36), index=True); user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'), nullable=True, index=True); client_error_type: Mapped[str] = mapped_column(String(80)); message: Mapped[str] = mapped_column(Text); page_context: Mapped[dict | None] = mapped_column(JSON, nullable=True); user_agent: Mapped[str | None] = mapped_column(String(300), nullable=True); created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
