"""공통 의존성."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.db import get_db
from app.exceptions import UnauthorizedError, UserNotFoundError
from app.models import User

DbSession = Annotated[Session, Depends(get_db)]

# auto_error=False: 인증 실패도 표준 오류 형식(AppError)으로 통일하기 위해 직접 처리한다
_bearer = HTTPBearer(auto_error=False)
BearerCreds = Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)]


def get_current_user(creds: BearerCreds, db: DbSession) -> User:
    if creds is None:
        raise UnauthorizedError()

    user_id = decode_access_token(creds.credentials)
    user = db.get(User, user_id)
    if user is None:
        raise UserNotFoundError()
    return user


def get_current_user_optional(request: Request, db: DbSession) -> User | None:
    """BE-AUTH-001: 토큰이 없거나 유효하지 않아도 오류 대신 None 을 돌려준다."""
    header = request.headers.get("Authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    try:
        user_id = decode_access_token(token)
    except Exception:
        return None
    return db.get(User, user_id)


CurrentUser = Annotated[User, Depends(get_current_user)]
OptionalUser = Annotated[User | None, Depends(get_current_user_optional)]
