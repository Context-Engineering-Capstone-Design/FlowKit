"""add search_sources to message_block_versions

Revision ID: a81908search
Revises: a81907observability
Create Date: 2026-08-20
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a81908search"
down_revision: str = "a81907observability"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "message_block_versions",
        sa.Column("search_sources", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("message_block_versions", "search_sources")
