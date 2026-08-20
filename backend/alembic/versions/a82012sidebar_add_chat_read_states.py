"""add sidebar chat read states

Revision ID: a82012sidebar
Revises: a82010temp
"""
from __future__ import annotations
from collections.abc import Sequence
import sqlalchemy as sa
from alembic import op
revision: str = "a82012sidebar"
down_revision: str | Sequence[str] | None = "a82010temp"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None
def upgrade() -> None:
    op.create_table("chat_read_states", sa.Column("id", sa.Uuid(), primary_key=True), sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False), sa.Column("chat_id", sa.Uuid(), sa.ForeignKey("chats.id", ondelete="CASCADE"), nullable=False), sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()), sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()), sa.UniqueConstraint("user_id", "chat_id", name="uq_chat_read_state_user_chat"))
    op.create_index("ix_chat_read_states_user_id", "chat_read_states", ["user_id"])
    op.create_index("ix_chat_read_states_chat_id", "chat_read_states", ["chat_id"])
def downgrade() -> None:
    op.drop_table("chat_read_states")
