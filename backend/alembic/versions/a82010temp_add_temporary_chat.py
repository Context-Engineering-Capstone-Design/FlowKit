"""add temporary side chat lifecycle fields

Revision ID: a82010temp
Revises: a81911side
Create Date: 2026-08-20
"""
from __future__ import annotations

from collections.abc import Sequence
import sqlalchemy as sa
from alembic import op

revision: str = "a82010temp"
down_revision: str = "a81911side"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

def upgrade() -> None:
    op.add_column("chats", sa.Column("is_temporary", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("chats", sa.Column("temporary_expires_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_chats_temporary_expires_at", "chats", ["temporary_expires_at"])

def downgrade() -> None:
    op.drop_index("ix_chats_temporary_expires_at", table_name="chats")
    op.drop_column("chats", "temporary_expires_at")
    op.drop_column("chats", "is_temporary")
