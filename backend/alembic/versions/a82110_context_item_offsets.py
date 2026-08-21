"""add start_offset and end_offset to applied_context_items

Revision ID: a82110ctxoffsets
Revises: a82109ctxversion
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a82110ctxoffsets"
down_revision: str | Sequence[str] | None = "a82109ctxversion"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("applied_context_items", sa.Column("start_offset", sa.Integer(), nullable=True))
    op.add_column("applied_context_items", sa.Column("end_offset", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("applied_context_items", "end_offset")
    op.drop_column("applied_context_items", "start_offset")
