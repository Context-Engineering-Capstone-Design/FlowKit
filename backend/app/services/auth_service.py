"""인증 서비스 ."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import (
    create_access_token,
    generate_refresh_token,
    hash_refresh_token,
    refresh_token_expires_at,
)
from app.exceptions import (
    EmailAlreadyExistsError,
    SessionNotFoundError,
    TokenExpiredError,
    TokenReuseDetectedError,
    UserNotFoundError,
)
from app.models import AuthSession, User
from app.services.google_auth import GoogleUser


def find_or_create_user(db: Session, google_user: GoogleUser) -> tuple[User, bool]:
    """googleUserId 우선, 없으면 email 로 조회한다 ."""
    user = db.scalar(
        select(User).where(User.google_user_id == google_user.google_user_id)
    )
    if user is not None:
        return user, False

    # 다른 경로로 먼저 만들어진 계정이 있으면 Google 계정을 연결한다
    user = db.scalar(select(User).where(User.email == google_user.email))
    if user is not None:
        user.google_user_id = google_user.google_user_id
        db.commit()
        return user, False

    user = User(
        google_user_id=google_user.google_user_id,
        email=google_user.email,
        name=google_user.name,
        profile_image=google_user.profile_image,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user, True


def issue_tokens(
    db: Session, user: User, device_info: str | None = None
) -> tuple[str, str, datetime]:
    """accessToken/refreshToken 을 발급하고 세션을 저장한다 .

    accessToken에 세션 id(sid)를 담아, 로그아웃으로 세션이 폐기되면 만료 전에도
    즉시 무효화되게 한다(, 009).
    """
    raw_refresh, refresh_hash = generate_refresh_token()
    session = AuthSession(
        user_id=user.id,
        refresh_token_hash=refresh_hash,
        expires_at=refresh_token_expires_at(),
        device_info=device_info,
    )
    db.add(session)
    db.flush()

    access_token, expires_at = create_access_token(user.id, session.id)
    db.commit()
    return access_token, raw_refresh, expires_at


def rotate_tokens(
    db: Session, raw_refresh_token: str
) -> tuple[str, str, datetime, User]:
    """refreshToken 회전 .

    기존 토큰은 즉시 폐기한다. 이미 폐기된 토큰이 다시 들어오면 탈취로 간주하고
    해당 사용자의 모든 세션을 종료한다.
    """
    token_hash = hash_refresh_token(raw_refresh_token)
    session = db.scalar(
        select(AuthSession).where(AuthSession.refresh_token_hash == token_hash)
    )
    if session is None:
        raise SessionNotFoundError()

    if session.revoked_at is not None:
        _revoke_all_sessions(db, session.user_id)
        raise TokenReuseDetectedError()

    if _as_utc(session.expires_at) < datetime.now(UTC):
        raise TokenExpiredError("refreshToken 이 만료되었습니다.")

    user = db.get(User, session.user_id)
    if user is None:
        raise UserNotFoundError()

    session.revoked_at = datetime.now(UTC)
    db.flush()

    access_token, refresh_token, expires_at = issue_tokens(
        db, user, device_info=session.device_info
    )
    return access_token, refresh_token, expires_at, user


def logout(db: Session, user_id: uuid.UUID) -> None:
    """현재 사용자의 모든 refreshToken 을 무효화한다 ."""
    _revoke_all_sessions(db, user_id)


def update_profile(
    db: Session,
    user: User,
    name: str | None = None,
    email: str | None = None,
    memo: str | None = None,
    memo_present: bool = False,
) -> User:
    """계정 기본 정보 수정 ."""
    if email is not None and email != user.email:
        existing = db.scalar(select(User).where(User.email == email))
        if existing is not None and existing.id != user.id:
            raise EmailAlreadyExistsError()
        user.email = email
    if name is not None:
        user.name = name
    if memo_present:
        user.memo = memo

    db.commit()
    db.refresh(user)
    return user


def _revoke_all_sessions(db: Session, user_id: uuid.UUID) -> None:
    now = datetime.now(UTC)
    sessions = db.scalars(
        select(AuthSession).where(
            AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None)
        )
    ).all()
    for s in sessions:
        s.revoked_at = now
    db.commit()


def _as_utc(value: datetime) -> datetime:
    """SQLite 는 tz 정보를 잃으므로 naive datetime 을 UTC 로 간주한다."""
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)
