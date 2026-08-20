"""add side chat tree: chat kind, parent/root chat and branch references

Revision ID: a81911side
Revises: a81910exec
Create Date: 2026-08-20
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a81911side"
down_revision: str = "a81910exec"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CHAT_KIND_ENUM = "chat_kind"


def upgrade() -> None:
    chat_kind = sa.Enum("MAIN", "SIDE", name=_CHAT_KIND_ENUM)
    chat_kind.create(op.get_bind(), checkfirst=True)
    chat_kind.create_type = False

    op.add_column(
        "chats",
        sa.Column("kind", chat_kind, nullable=False, server_default="MAIN"),
    )
    op.add_column("chats", sa.Column("parent_chat_id", sa.Uuid(), nullable=True))
    op.add_column("chats", sa.Column("parent_branch_id", sa.Uuid(), nullable=True))
    op.add_column(
        "chats", sa.Column("parent_message_block_id", sa.Uuid(), nullable=True)
    )
    op.add_column("chats", sa.Column("root_chat_id", sa.Uuid(), nullable=True))
    op.add_column("chats", sa.Column("root_branch_id", sa.Uuid(), nullable=True))

    op.create_index("ix_chats_parent_chat_id", "chats", ["parent_chat_id"])
    op.create_index("ix_chats_root_chat_id", "chats", ["root_chat_id"])

    op.create_foreign_key(
        "fk_chats_parent_chat", "chats", "chats",
        ["parent_chat_id"], ["id"], ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_chats_parent_branch", "chats", "branches",
        ["parent_branch_id"], ["id"], ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_chats_parent_message_block", "chats", "message_blocks",
        ["parent_message_block_id"], ["id"], ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_chats_root_chat", "chats", "chats",
        ["root_chat_id"], ["id"], ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_chats_root_branch", "chats", "branches",
        ["root_branch_id"], ["id"], ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_chats_root_branch", "chats", type_="foreignkey")
    op.drop_constraint("fk_chats_root_chat", "chats", type_="foreignkey")
    op.drop_constraint("fk_chats_parent_message_block", "chats", type_="foreignkey")
    op.drop_constraint("fk_chats_parent_branch", "chats", type_="foreignkey")
    op.drop_constraint("fk_chats_parent_chat", "chats", type_="foreignkey")
    op.drop_index("ix_chats_root_chat_id", table_name="chats")
    op.drop_index("ix_chats_parent_chat_id", table_name="chats")
    op.drop_column("chats", "root_branch_id")
    op.drop_column("chats", "root_chat_id")
    op.drop_column("chats", "parent_message_block_id")
    op.drop_column("chats", "parent_branch_id")
    op.drop_column("chats", "parent_chat_id")
    op.drop_column("chats", "kind")

    sa.Enum(name=_CHAT_KIND_ENUM).drop(op.get_bind(), checkfirst=True)
