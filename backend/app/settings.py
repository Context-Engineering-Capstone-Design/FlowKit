from __future__ import annotations

from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    database_url: str = "postgresql+psycopg://flowkit:flowkit@localhost:5432/flowkit"
    redis_url: str = "redis://localhost:6379/0"

    # Google 로그인 (BE-AUTH-002): FE가 획득한 ID 토큰의 audience 검증에 사용
    google_client_id: str = ""

    # HMAC-SHA256 권장 최소 길이(32바이트)를 충족하는 개발용 기본값. 배포 시 반드시 교체한다.
    jwt_secret: str = "dev-only-insecure-secret-change-me-before-deploy"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 14

    # 사용자 API 키 암호화용 Fernet 키. API 키 기능을 쓸 때 반드시 설정한다.
    api_key_encryption_key: str = ""

    cors_origins: list[str] = ["http://localhost:5173"]

    @field_validator("jwt_secret")
    @classmethod
    def _reject_weak_secret(cls, v: str) -> str:
        if len(v) < 32:
            raise ValueError(
                "JWT_SECRET 은 32자 이상이어야 합니다. "
                "`python -c \"import secrets; print(secrets.token_urlsafe(48))\"` 로 생성하세요."
            )
        return v


@lru_cache
def get_settings() -> Settings:
    return Settings()
