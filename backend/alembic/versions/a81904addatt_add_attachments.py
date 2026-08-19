"""add input attachments

Revision ID: a81904addatt
Revises: 0c50d3ec01f2
Create Date: 2026-08-19
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a81904addatt"
down_revision: str | None = "0c50d3ec01f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    status = sa.Enum("temporary", "attached", "expired", name="attachment_status")
    status.create(op.get_bind(), checkfirst=True)
    op.create_table(
        "attachments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("chat_id", sa.Uuid(), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("mime_type", sa.String(length=100), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("storage_key", sa.String(length=512), nullable=False),
        sa.Column("status", status, nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["chat_id"], ["chats.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"), sa.UniqueConstraint("storage_key"),
    )
    op.create_index("ix_attachments_user_id", "attachments", ["user_id"])
    op.create_index("ix_attachments_chat_id", "attachments", ["chat_id"])
    op.create_index("ix_attachments_expires_at", "attachments", ["expires_at"])
    op.create_table(
        "message_attachments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("message_block_id", sa.Uuid(), nullable=False),
        sa.Column("attachment_id", sa.Uuid(), nullable=False),
        sa.Column("order_index", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["message_block_id"], ["message_blocks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["attachment_id"], ["attachments.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("attachment_id"),
        sa.UniqueConstraint("message_block_id", "attachment_id", name="uq_message_attachment"),
        sa.UniqueConstraint("message_block_id", "order_index", name="uq_message_attachment_order"),
    )
    op.create_index("ix_message_attachments_message_block_id", "message_attachments", ["message_block_id"])
    op.create_index("ix_message_attachments_attachment_id", "message_attachments", ["attachment_id"])


def downgrade() -> None:
    op.drop_index("ix_message_attachments_attachment_id", table_name="message_attachments")
    op.drop_index("ix_message_attachments_message_block_id", table_name="message_attachments")
    op.drop_table("message_attachments")
    op.drop_index("ix_attachments_expires_at", table_name="attachments")
    op.drop_index("ix_attachments_chat_id", table_name="attachments")
    op.drop_index("ix_attachments_user_id", table_name="attachments")
    op.drop_table("attachments")
    sa.Enum(name="attachment_status").drop(op.get_bind(), checkfirst=True)
