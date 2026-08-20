"""add ai execution observability: job timing/usage columns, execution events, delivery timings

Revision ID: a81910exec
Revises: a81909stream
Create Date: 2026-08-20
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a81910exec"
down_revision: str = "a81909stream"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_EVENT_KIND_ENUM = "ai_execution_event_kind"
_EVENT_STATUS_ENUM = "ai_execution_event_status"


def upgrade() -> None:
    op.add_column("ai_response_jobs", sa.Column("generation_started_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("ai_response_jobs", sa.Column("first_chunk_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("ai_response_jobs", sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("ai_response_jobs", sa.Column("usage_summary", sa.JSON(), nullable=True))

    # 타입은 여기서 직접 만들고, 컬럼에 쓰는 타입 객체는 create_type=False 로 따로
    # 만든다. 컬럼에 물리면 SQLAlchemy가 방언별 타입 객체로 다시 바꿔 쓰는데, 그
    # 복제본에 나중에 create_type=False 를 지정해도 반영되지 않아 create_table 이
    # 같은 CREATE TYPE 을 또 실행해 DuplicateObject 오류가 난다.
    sa.Enum("context_read", "attachment_read", "web_search", name=_EVENT_KIND_ENUM).create(op.get_bind(), checkfirst=True)
    sa.Enum("completed", "unknown", name=_EVENT_STATUS_ENUM).create(op.get_bind(), checkfirst=True)
    event_kind = postgresql.ENUM("context_read", "attachment_read", "web_search", name=_EVENT_KIND_ENUM, create_type=False)
    event_status = postgresql.ENUM("completed", "unknown", name=_EVENT_STATUS_ENUM, create_type=False)

    op.create_table(
        "ai_execution_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("job_id", sa.Uuid(), nullable=False),
        sa.Column("kind", event_kind, nullable=False),
        sa.Column("status", event_status, nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("summary", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["job_id"], ["ai_response_jobs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ai_execution_events_job_id", "ai_execution_events", ["job_id"])

    op.create_table(
        "ai_delivery_timings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("job_id", sa.Uuid(), nullable=False),
        sa.Column("clicked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("block_shown_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("stream_connected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("first_chunk_shown_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("done_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reconnect_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("final_outcome", sa.String(length=30), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["job_id"], ["ai_response_jobs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("job_id", name="uq_ai_delivery_timings_job_id"),
    )
    op.create_index("ix_ai_delivery_timings_job_id", "ai_delivery_timings", ["job_id"])


def downgrade() -> None:
    op.drop_index("ix_ai_delivery_timings_job_id", table_name="ai_delivery_timings")
    op.drop_table("ai_delivery_timings")
    op.drop_index("ix_ai_execution_events_job_id", table_name="ai_execution_events")
    op.drop_table("ai_execution_events")
    sa.Enum(name=_EVENT_STATUS_ENUM).drop(op.get_bind(), checkfirst=True)
    sa.Enum(name=_EVENT_KIND_ENUM).drop(op.get_bind(), checkfirst=True)

    op.drop_column("ai_response_jobs", "usage_summary")
    op.drop_column("ai_response_jobs", "finished_at")
    op.drop_column("ai_response_jobs", "first_chunk_at")
    op.drop_column("ai_response_jobs", "generation_started_at")
