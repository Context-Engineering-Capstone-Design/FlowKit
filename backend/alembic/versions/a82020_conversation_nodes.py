"""add unified conversation node fields and migrate child branches

Revision ID: a82020nodes
Revises: a82012sidebar
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a82020nodes"
down_revision: str | Sequence[str] | None = "a82012sidebar"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("chats", sa.Column("forked_from_chat_id", sa.Uuid(), nullable=True))
    op.add_column("chats", sa.Column("forked_from_message_block_id", sa.Uuid(), nullable=True))
    op.add_column("chats", sa.Column("legacy_branch_id", sa.Uuid(), nullable=True))
    op.create_index("ix_chats_forked_from_chat_id", "chats", ["forked_from_chat_id"])
    op.create_index("ix_chats_legacy_branch_id", "chats", ["legacy_branch_id"], unique=True)
    op.create_foreign_key("fk_chats_forked_from_chat", "chats", "chats", ["forked_from_chat_id"], ["id"], ondelete="SET NULL")
    op.create_foreign_key("fk_chats_forked_from_message_block", "chats", "message_blocks", ["forked_from_message_block_id"], ["id"], ondelete="SET NULL")
    op.create_foreign_key("fk_chats_legacy_branch", "chats", "branches", ["legacy_branch_id"], ["id"], ondelete="SET NULL")

    # 운영 전환은 Alembic 트랜잭션 안에서 한 번만 실행된다. 데이터가 없으면 0건이다.
    from sqlalchemy.orm import Session
    from app.services.conversation_node_migration import migrate_legacy_child_branches

    session = Session(bind=op.get_bind())
    migrate_legacy_child_branches(session)
    session.flush()


def downgrade() -> None:
    # 실제 운영 데이터의 역전환은 백업 복원으로만 허용한다.
    op.drop_constraint("fk_chats_legacy_branch", "chats", type_="foreignkey")
    op.drop_constraint("fk_chats_forked_from_message_block", "chats", type_="foreignkey")
    op.drop_constraint("fk_chats_forked_from_chat", "chats", type_="foreignkey")
    op.drop_index("ix_chats_legacy_branch_id", table_name="chats")
    op.drop_index("ix_chats_forked_from_chat_id", table_name="chats")
    op.drop_column("chats", "legacy_branch_id")
    op.drop_column("chats", "forked_from_message_block_id")
    op.drop_column("chats", "forked_from_chat_id")
