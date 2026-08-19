"""add observability and service feedback tables

Revision ID: a81907observability
Revises: a81905aijob, f5e6a91f7c20
Create Date: 2026-08-19
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a81907observability"
down_revision: tuple[str, str] = ("a81905aijob", "f5e6a91f7c20")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    feedback_type = postgresql.ENUM(
        "error",
        "usability",
        "context",
        "branch",
        "other",
        name="feedback_type",
        create_type=False,
    )
    feedback_type.create(op.get_bind(), checkfirst=True)
    op.create_table(
        "error_logs",
        sa.Column("trace_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("request_path", sa.String(length=300), nullable=False),
        sa.Column("method", sa.String(length=10), nullable=False),
        sa.Column("error_code", sa.String(length=80), nullable=False),
        sa.Column("message", sa.String(length=300), nullable=False),
        sa.Column("exception_type", sa.String(length=100), nullable=True),
        sa.Column("status_code", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("trace_id"),
    )
    op.create_index("ix_error_logs_user_id", "error_logs", ["user_id"])
    op.create_table(
        "client_error_logs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("trace_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("client_error_type", sa.String(length=80), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("page_context", sa.JSON(), nullable=True),
        sa.Column("user_agent", sa.String(length=300), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_client_error_logs_trace_id", "client_error_logs", ["trace_id"])
    op.create_index("ix_client_error_logs_user_id", "client_error_logs", ["user_id"])
    op.create_table(
        "service_feedbacks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("feedback_type", feedback_type, nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("context_info", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_service_feedbacks_user_id", "service_feedbacks", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_service_feedbacks_user_id", table_name="service_feedbacks")
    op.drop_table("service_feedbacks")
    op.drop_index("ix_client_error_logs_user_id", table_name="client_error_logs")
    op.drop_index("ix_client_error_logs_trace_id", table_name="client_error_logs")
    op.drop_table("client_error_logs")
    op.drop_index("ix_error_logs_user_id", table_name="error_logs")
    op.drop_table("error_logs")
    sa.Enum(name="feedback_type").drop(op.get_bind(), checkfirst=True)
