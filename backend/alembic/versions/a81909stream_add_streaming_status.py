"""add streaming status to ai_response_jobs and message_blocks

Revision ID: a81909stream
Revises: a81908search
Create Date: 2026-08-20
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a81909stream"
down_revision: str = "a81908search"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_BLOCK_STATUS_ENUM = "block_generation_status"


def upgrade() -> None:
    op.execute("ALTER TYPE ai_response_job_status ADD VALUE IF NOT EXISTS 'generating'")
    op.execute("ALTER TYPE ai_response_job_status ADD VALUE IF NOT EXISTS 'cancelled'")

    block_status = sa.Enum(
        "generating", "complete", "cancelled", "failed", name=_BLOCK_STATUS_ENUM
    )
    block_status.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "message_blocks",
        sa.Column(
            "generation_status",
            block_status,
            nullable=False,
            server_default="complete",
        ),
    )


def downgrade() -> None:
    op.drop_column("message_blocks", "generation_status")
    sa.Enum(name=_BLOCK_STATUS_ENUM).drop(op.get_bind(), checkfirst=True)
    # Postgres 는 enum 값을 뺄 수 없다. generating/cancelled 값은 그대로 둔다.
