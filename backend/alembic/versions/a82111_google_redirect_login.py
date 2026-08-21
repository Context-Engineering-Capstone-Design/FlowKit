"""add Google redirect login exchange codes

Revision ID: a82111googlelogin
Revises: a82110ctxoffsets
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a82111googlelogin"
down_revision: str | Sequence[str] | None = "a82110ctxoffsets"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "google_login_exchanges",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("code_hash", sa.String(length=128), nullable=False),
        sa.Column("is_new_user", sa.Boolean(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code_hash"),
    )
    op.create_index(
        op.f("ix_google_login_exchanges_code_hash"),
        "google_login_exchanges",
        ["code_hash"],
        unique=False,
    )
    op.create_index(
        op.f("ix_google_login_exchanges_expires_at"),
        "google_login_exchanges",
        ["expires_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_google_login_exchanges_user_id"),
        "google_login_exchanges",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_google_login_exchanges_user_id"), table_name="google_login_exchanges")
    op.drop_index(op.f("ix_google_login_exchanges_expires_at"), table_name="google_login_exchanges")
    op.drop_index(op.f("ix_google_login_exchanges_code_hash"), table_name="google_login_exchanges")
    op.drop_table("google_login_exchanges")
