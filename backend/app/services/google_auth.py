"""Google ID 토큰 검증 및 사용자 정보 추출 (BE-AUTH-002, BE-AUTH-003).

FE가 Google SDK로 받은 ID 토큰을 그대로 보내면 서버가 서명·만료·audience·issuer 를 검증한다.
OAuth 리다이렉트 URL 이나 콜백 처리는 필요하지 않다.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.exceptions import InvalidGoogleIdTokenError
from app.settings import get_settings

_GOOGLE_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}


@dataclass(frozen=True)
class GoogleUser:
    google_user_id: str
    email: str
    name: str
    profile_image: str | None


def verify_google_id_token(id_token_str: str) -> GoogleUser:
    settings = get_settings()
    if not settings.google_client_id:
        raise InvalidGoogleIdTokenError(
            "서버에 GOOGLE_CLIENT_ID 가 설정되지 않았습니다.",
        )

    # 지연 import: 의존성이 없는 환경에서도 모듈 import 는 가능하게 유지
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token as google_id_token

    try:
        payload = google_id_token.verify_oauth2_token(
            id_token_str,
            google_requests.Request(),
            settings.google_client_id,
        )
    except ValueError as exc:
        # 서명 오류, 만료, audience 불일치 모두 ValueError 로 올라온다
        raise InvalidGoogleIdTokenError(detail=str(exc)) from exc

    if payload.get("iss") not in _GOOGLE_ISSUERS:
        raise InvalidGoogleIdTokenError("발급자가 올바르지 않습니다.")

    return extract_google_user(payload)


def extract_google_user(payload: dict) -> GoogleUser:
    """검증된 payload 에서 필수 claim 을 추출한다 (BE-AUTH-003)."""
    google_user_id = payload.get("sub")
    email = payload.get("email")
    if not google_user_id or not email:
        raise InvalidGoogleIdTokenError("필수 사용자 정보가 없습니다.")

    return GoogleUser(
        google_user_id=google_user_id,
        email=email,
        name=payload.get("name") or email.split("@")[0],
        profile_image=payload.get("picture"),
    )
