"""토큰 발급·검증 유틸 .

accessToken 은 JWT, refreshToken 은 불투명 난수 문자열이다. refreshToken 원문은 저장하지
않고 SHA-256 해시만 DB에 남긴다.
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta

import jwt

from app.exceptions import TokenExpiredError, UnauthorizedError
from app.settings import get_settings


def create_access_token(user_id: uuid.UUID, session_id: uuid.UUID) -> tuple[str, datetime]:
    settings = get_settings()
    expires_at = datetime.now(UTC) + timedelta(
        minutes=settings.access_token_expire_minutes
    )
    payload = {
        "sub": str(user_id),
        "sid": str(session_id),
        "exp": expires_at,
        "iat": datetime.now(UTC),
        "type": "access",
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return token, expires_at


def decode_access_token(token: str) -> tuple[uuid.UUID, uuid.UUID]:
    """(userId, sessionId) 를 반환한다. 세션 유효성은 호출부가 AuthSession으로 확인한다(, 009)."""
    settings = get_settings()
    try:
        payload = jwt.decode(
            token, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
        )
    except jwt.ExpiredSignatureError as exc:
        raise TokenExpiredError() from exc
    except jwt.PyJWTError as exc:
        raise UnauthorizedError("유효하지 않은 토큰입니다.") from exc

    if payload.get("type") != "access":
        raise UnauthorizedError("유효하지 않은 토큰입니다.")

    try:
        return uuid.UUID(payload["sub"]), uuid.UUID(payload["sid"])
    except (KeyError, ValueError) as exc:
        raise UnauthorizedError("유효하지 않은 토큰입니다.") from exc


def generate_refresh_token() -> tuple[str, str]:
    """(원문, 해시) 를 반환한다. 원문은 응답으로만 나가고 저장하지 않는다."""
    raw = secrets.token_urlsafe(48)
    return raw, hash_refresh_token(raw)


def hash_refresh_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def refresh_token_expires_at() -> datetime:
    return datetime.now(UTC) + timedelta(days=get_settings().refresh_token_expire_days)
