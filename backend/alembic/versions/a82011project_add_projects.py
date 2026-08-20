"""add projects, project memories and project library resources

Revision ID: a82011project
Revises: a81911side
Create Date: 2026-08-20
"""
from __future__ import annotations
from collections.abc import Sequence
import sqlalchemy as sa
from alembic import op

revision: str = "a82011project"
down_revision: str | None = "a81911side"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table("projects", sa.Column("id", sa.Uuid(), primary_key=True), sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False), sa.Column("name", sa.String(100), nullable=False), sa.Column("instructions", sa.Text(), nullable=False, server_default=""), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()), sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.create_index("ix_projects_owner_id", "projects", ["owner_id"])
    op.add_column("chats", sa.Column("project_id", sa.Uuid(), nullable=True))
    op.create_index("ix_chats_project_id", "chats", ["project_id"])
    op.create_foreign_key("fk_chats_project", "chats", "projects", ["project_id"], ["id"], ondelete="CASCADE")
    for table, columns in (("project_memories", [sa.Column("id", sa.Uuid(), primary_key=True), sa.Column("project_id", sa.Uuid(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False), sa.Column("content", sa.Text(), nullable=False), sa.Column("order_index", sa.Integer(), nullable=False, server_default="0")]), ("project_library_resources", [sa.Column("id", sa.Uuid(), primary_key=True), sa.Column("project_id", sa.Uuid(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False), sa.Column("title", sa.String(200), nullable=False), sa.Column("content", sa.Text(), nullable=False), sa.Column("source_url", sa.String(2048), nullable=True), sa.Column("order_index", sa.Integer(), nullable=False, server_default="0")])):
        op.create_table(table, *columns, sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()), sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
        op.create_index(f"ix_{table}_project_id", table, ["project_id"])
    op.create_table("project_library_selections", sa.Column("id", sa.Uuid(), primary_key=True), sa.Column("project_id", sa.Uuid(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False), sa.Column("resource_id", sa.Uuid(), sa.ForeignKey("project_library_resources.id", ondelete="CASCADE"), nullable=False), sa.Column("message_block_id", sa.Uuid(), sa.ForeignKey("message_blocks.id", ondelete="CASCADE"), nullable=False), sa.Column("content", sa.Text(), nullable=False), sa.Column("order_index", sa.Integer(), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()), sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()), sa.UniqueConstraint("message_block_id", "resource_id", name="uq_project_library_selection"))
    for col in ("project_id", "resource_id", "message_block_id"): op.create_index(f"ix_project_library_selections_{col}", "project_library_selections", [col])


def downgrade() -> None:
    op.drop_table("project_library_selections")
    op.drop_table("project_library_resources")
    op.drop_table("project_memories")
    op.drop_constraint("fk_chats_project", "chats", type_="foreignkey")
    op.drop_index("ix_chats_project_id", table_name="chats")
    op.drop_column("chats", "project_id")
    op.drop_table("projects")
