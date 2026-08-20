"""공통 의존성."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.db import get_db
from app.exceptions import UnauthorizedError, UserNotFoundError
from app.models import AuthSession, User

DbSession = Annotated[Session, Depends(get_db)]

# auto_error=False: 인증 실패도 표준 오류 형식(AppError)으로 통일하기 위해 직접 처리한다
_bearer = HTTPBearer(auto_error=False)
BearerCreds = Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)]


def _session_is_valid(db: Session, session_id) -> bool:
    """세션이 존재하고, 로그아웃 등으로 폐기되지 않았으며, 만료 전인지 확인한다 (BE-AUTH-001, 009)."""
    session = db.get(AuthSession, session_id)
    if session is None or session.revoked_at is not None:
        return False
    expires_at = session.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    return expires_at >= datetime.now(UTC)


def get_current_user(request: Request, creds: BearerCreds, db: DbSession) -> User:
    if creds is None:
        raise UnauthorizedError()

    user_id, session_id = decode_access_token(creds.credentials)
    if not _session_is_valid(db, session_id):
        raise UnauthorizedError("로그아웃되었거나 만료된 세션입니다.")
    user = db.get(User, user_id)
    if user is None:
        raise UserNotFoundError()
    request.state.user_id = user.id
    return user


def get_current_user_optional(request: Request, db: DbSession) -> User | None:
    """BE-AUTH-001: 토큰이 없거나 유효하지 않아도 오류 대신 None 을 돌려준다."""
    header = request.headers.get("Authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    try:
        user_id, session_id = decode_access_token(token)
    except Exception:
        return None
    if not _session_is_valid(db, session_id):
        return None
    user = db.get(User, user_id)
    if user is not None:
        request.state.user_id = user.id
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
OptionalUser = Annotated[User | None, Depends(get_current_user_optional)]
