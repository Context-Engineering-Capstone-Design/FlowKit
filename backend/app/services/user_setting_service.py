"""사용자 설정과 요청별 AI API 키 관리 (, 003~006, 008)."""

from __future__ import annotations

import logging
import re
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.exceptions import (
    ApiKeyInvalidFormatError,
    ApiKeyNotFoundError,
    ApiKeyNotRegisteredError,
    ProviderNotConfiguredError,
)
from app.models import ApiKeyConnectionStatus, User, UserApiKey
from app.services.api_key_crypto import decrypt_api_key, encrypt_api_key

logger = logging.getLogger(__name__)

SUPPORTED_PROVIDER = "openai"
MIN_API_KEY_LENGTH = 16
MAX_API_KEY_LENGTH = 512
_KEY_PATTERN = re.compile(r"^[A-Za-z0-9_\-.]+$")


def validate_provider(provider: str) -> str:
    normalized = provider.strip().lower()
    if normalized != SUPPORTED_PROVIDER:
        raise ProviderNotConfiguredError()
    return normalized


def get_api_key_record(
    db: Session, user: User, provider: str = SUPPORTED_PROVIDER
) -> UserApiKey | None:
    provider = validate_provider(provider)
    return db.scalar(
        select(UserApiKey).where(
            UserApiKey.user_id == user.id,
            UserApiKey.provider == provider,
        )
    )


def save_api_key(
    db: Session, user: User, provider: str, raw_api_key: str
) -> UserApiKey:
    provider = validate_provider(provider)
    api_key = (raw_api_key or "").strip()
    if (
        len(api_key) < MIN_API_KEY_LENGTH
        or len(api_key) > MAX_API_KEY_LENGTH
        or not _KEY_PATTERN.fullmatch(api_key)
    ):
        raise ApiKeyInvalidFormatError()

    record = get_api_key_record(db, user, provider)
    if record is None:
        record = UserApiKey(user_id=user.id, provider=provider)
        db.add(record)

    record.encrypted_api_key = encrypt_api_key(api_key)
    record.last4 = api_key[-4:]
    record.connection_status = ApiKeyConnectionStatus.UNCHECKED
    record.connection_message = None
    record.last_checked_at = None
    db.commit()
    db.refresh(record)
    return record


def delete_api_key(db: Session, user: User, provider: str) -> None:
    record = get_api_key_record(db, user, provider)
    if record is None:
        raise ApiKeyNotFoundError()
    db.delete(record)
    db.commit()


def require_api_key(
    db: Session, user: User, provider: str = SUPPORTED_PROVIDER
) -> str:
    record = get_api_key_record(db, user, provider)
    if record is None:
        raise ApiKeyNotRegisteredError()
    return decrypt_api_key(record.encrypted_api_key)


def check_api_key_connection(
    db: Session, user: User, provider: str = SUPPORTED_PROVIDER, checker=None
) -> UserApiKey:
    from modeling import check_connection

    record = get_api_key_record(db, user, provider)
    if record is None:
        raise ApiKeyNotRegisteredError()

    api_key = decrypt_api_key(record.encrypted_api_key)
    result = (checker or check_connection)(api_key=api_key)
    record.last_checked_at = datetime.now(UTC)
    if result.success:
        record.connection_status = ApiKeyConnectionStatus.CONNECTED
        record.connection_message = "연결에 성공했습니다."
    else:
        # 사용자에게는 안전한 요약 메시지만 보여주지만, 원인 파악을 위해
        # 원본 오류는 서버 로그에 남긴다 — 키 값 자체는 포함되지 않는다.
        logger.error("openai connection check failed: %s", result.reason)
        record.connection_status = ApiKeyConnectionStatus.FAILED
        record.connection_message = _safe_connection_message(result.reason)
    db.commit()
    db.refresh(record)
    return record


def _safe_connection_message(reason: str | None) -> str:
    normalized = " ".join((reason or "").lower().split())
    if "timeout" in normalized or "timed out" in normalized:
        return "연결 시간이 초과되었습니다. 잠시 후 다시 시도해주세요."
    if any(
        token in normalized
        for token in ("api key", "api_key", "unauthorized", "permission", "401", "403")
    ):
        return "API 키를 확인해주세요."
    if any(
        token in normalized
        for token in ("insufficient_quota", "quota", "credit", "429")
    ):
        return "OpenAI 계정에 남은 크레딧이 없거나 사용량 한도를 초과했습니다. 결제 정보를 확인해주세요."
    return "Provider에 연결하지 못했습니다. 잠시 후 다시 시도해주세요."
