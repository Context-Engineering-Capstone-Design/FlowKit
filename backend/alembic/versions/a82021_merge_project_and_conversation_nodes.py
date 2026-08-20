"""merge project and conversation node migration branches

Revision ID: a82021merge
Revises: a82011project, a82020nodes
"""
from __future__ import annotations

from collections.abc import Sequence


revision: str = "a82021merge"
down_revision: str | Sequence[str] | None = ("a82011project", "a82020nodes")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """두 독립 기능 계보를 하나의 head로 합친다."""


def downgrade() -> None:
    """병합 리비전 자체는 데이터 변경이 없다."""
