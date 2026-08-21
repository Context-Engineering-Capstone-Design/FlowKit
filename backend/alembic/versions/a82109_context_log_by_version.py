"""store applied Context logs by message version

Revision ID: a82109ctxversion
Revises: a82021merge
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a82109ctxversion"
down_revision: str | Sequence[str] | None = "a82021merge"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("applied_context_logs", sa.Column("message_block_version_id", sa.Uuid(), nullable=True))
    op.execute("""
        UPDATE applied_context_logs AS logs
        SET message_block_version_id = blocks.current_version_id
        FROM message_blocks AS blocks
        WHERE logs.user_message_block_id = blocks.id
    """)
    op.alter_column("applied_context_logs", "message_block_version_id", nullable=False)
    op.create_foreign_key("fk_applied_context_logs_message_block_version", "applied_context_logs", "message_block_versions", ["message_block_version_id"], ["id"], ondelete="CASCADE")
    op.create_index("ix_applied_context_logs_message_block_version_id", "applied_context_logs", ["message_block_version_id"], unique=True)
    op.drop_index("ix_applied_context_logs_user_message_block_id", table_name="applied_context_logs")
    op.drop_constraint("applied_context_logs_user_message_block_id_fkey", "applied_context_logs", type_="foreignkey")
    op.drop_column("applied_context_logs", "user_message_block_id")


def downgrade() -> None:
    op.add_column("applied_context_logs", sa.Column("user_message_block_id", sa.Uuid(), nullable=True))
    op.execute("""
        UPDATE applied_context_logs AS logs
        SET user_message_block_id = versions.block_id
        FROM message_block_versions AS versions
        WHERE logs.message_block_version_id = versions.id
    """)
    op.alter_column("applied_context_logs", "user_message_block_id", nullable=False)
    op.create_foreign_key("applied_context_logs_user_message_block_id_fkey", "applied_context_logs", "message_blocks", ["user_message_block_id"], ["id"], ondelete="CASCADE")
    op.create_index("ix_applied_context_logs_user_message_block_id", "applied_context_logs", ["user_message_block_id"])
    op.drop_index("ix_applied_context_logs_message_block_version_id", table_name="applied_context_logs")
    op.drop_constraint("fk_applied_context_logs_message_block_version", "applied_context_logs", type_="foreignkey")
    op.drop_column("applied_context_logs", "message_block_version_id")
