"""add AI response jobs

Revision ID: a81905aijob
Revises: a81904addatt
Create Date: 2026-08-19
"""
from __future__ import annotations
from collections.abc import Sequence
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a81905aijob"
down_revision: str | None = "a81904addatt"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

def upgrade() -> None:
    kind = postgresql.ENUM(
        "generate", "regenerate", name="ai_response_job_type", create_type=False
    )
    status = postgresql.ENUM(
        "requested",
        "completed",
        "failed",
        name="ai_response_job_status",
        create_type=False,
    )
    kind.create(op.get_bind(), checkfirst=True); status.create(op.get_bind(), checkfirst=True)
    op.create_table("ai_response_jobs",
        sa.Column("id", sa.Uuid(), nullable=False), sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("chat_id", sa.Uuid(), nullable=False), sa.Column("branch_id", sa.Uuid(), nullable=False),
        sa.Column("user_message_block_id", sa.Uuid(), nullable=False), sa.Column("assistant_message_block_id", sa.Uuid(), nullable=True),
        sa.Column("result_version_id", sa.Uuid(), nullable=True), sa.Column("source_job_id", sa.Uuid(), nullable=True),
        sa.Column("job_type", kind, nullable=False), sa.Column("status", status, nullable=False), sa.Column("input_snapshot", sa.JSON(), nullable=False),
        sa.Column("error_code", sa.String(length=80), nullable=True), sa.Column("error_message", sa.String(length=300), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False), sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"), sa.ForeignKeyConstraint(["chat_id"], ["chats.id"], ondelete="CASCADE"), sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_message_block_id"], ["message_blocks.id"], ondelete="CASCADE"), sa.ForeignKeyConstraint(["assistant_message_block_id"], ["message_blocks.id"], ondelete="SET NULL"), sa.ForeignKeyConstraint(["result_version_id"], ["message_block_versions.id"], ondelete="SET NULL"), sa.ForeignKeyConstraint(["source_job_id"], ["ai_response_jobs.id"], ondelete="SET NULL"), sa.PrimaryKeyConstraint("id"))
    for col in ("user_id", "chat_id", "branch_id", "user_message_block_id", "assistant_message_block_id", "source_job_id"): op.create_index(f"ix_ai_response_jobs_{col}", "ai_response_jobs", [col])
def downgrade() -> None:
    for col in ("source_job_id", "assistant_message_block_id", "user_message_block_id", "branch_id", "chat_id", "user_id"): op.drop_index(f"ix_ai_response_jobs_{col}", table_name="ai_response_jobs")
    op.drop_table("ai_response_jobs"); sa.Enum(name="ai_response_job_status").drop(op.get_bind(), checkfirst=True); sa.Enum(name="ai_response_job_type").drop(op.get_bind(), checkfirst=True)
