"""사용자 API 키 암호화·복호화.

키 원문은 호출 시점에만 다루고 DB·응답·로그에는 남기지 않는다.
"""

from __future__ import annotations

from cryptography.fernet import Fernet, InvalidToken

from app.exceptions import ApiKeyDecryptionError, ApiKeyEncryptionError
from app.settings import get_settings


def _fernet() -> Fernet:
    key = get_settings().api_key_encryption_key.strip()
    if not key:
        raise ApiKeyEncryptionError(
            "API 키 암호화 설정이 없습니다. 서버 관리자에게 문의해주세요."
        )
    try:
        return Fernet(key.encode("ascii"))
    except (ValueError, UnicodeEncodeError) as exc:
        raise ApiKeyEncryptionError(
            "API 키 암호화 설정이 올바르지 않습니다."
        ) from exc


def encrypt_api_key(api_key: str) -> str:
    try:
        return _fernet().encrypt(api_key.encode("utf-8")).decode("ascii")
    except ApiKeyEncryptionError:
        raise
    except Exception as exc:
        raise ApiKeyEncryptionError() from exc


def decrypt_api_key(encrypted_api_key: str) -> str:
    try:
        return _fernet().decrypt(encrypted_api_key.encode("ascii")).decode("utf-8")
    except ApiKeyEncryptionError as exc:
        raise ApiKeyDecryptionError(exc.message) from exc
    except (InvalidToken, ValueError, UnicodeError) as exc:
        raise ApiKeyDecryptionError() from exc
