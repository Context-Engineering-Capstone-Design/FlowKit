"""add AI response feedback

Revision ID: 0c50d3ec01f2
Revises: b5e3559115d8
Create Date: 2026-08-18
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0c50d3ec01f2"
down_revision: str | None = "b5e3559115d8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    rating = sa.Enum("like", "dislike", name="ai_response_rating")
    rating.create(op.get_bind(), checkfirst=True)
    op.create_table(
        "ai_response_feedbacks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("message_block_id", sa.Uuid(), nullable=False),
        sa.Column("rating", rating, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["message_block_id"], ["message_blocks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "message_block_id", name="uq_ai_feedback_user_block"),
    )
    op.create_index("ix_ai_response_feedbacks_user_id", "ai_response_feedbacks", ["user_id"])
    op.create_index("ix_ai_response_feedbacks_message_block_id", "ai_response_feedbacks", ["message_block_id"])


def downgrade() -> None:
    op.drop_index("ix_ai_response_feedbacks_message_block_id", table_name="ai_response_feedbacks")
    op.drop_index("ix_ai_response_feedbacks_user_id", table_name="ai_response_feedbacks")
    op.drop_table("ai_response_feedbacks")
    sa.Enum(name="ai_response_rating").drop(op.get_bind(), checkfirst=True)
