"""인증 라우터 (2.1 인증 및 계정)."""

from __future__ import annotations

from ipaddress import ip_address
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Form, Request
from fastapi.responses import RedirectResponse

from app.deps import CurrentUser, DbSession, OptionalUser
from app.exceptions import DevLoginUnavailableError
from app.schemas.auth import (
    AuthStatusResponse,
    GoogleLoginExchangeRequest,
    GoogleLoginRequest,
    LogoutResponse,
    RefreshRequest,
    TokenResponse,
    UpdateProfileRequest,
    UpdateProfileResponse,
    UserProfile,
)
from app.schemas.notification import ActionMeta
from app.services import auth_service
from app.services.google_auth import GoogleUser, verify_google_id_token
from app.settings import get_settings

router = APIRouter(prefix="/api/auth", tags=["Auth"])

_LOCAL_DEV_USER = GoogleUser(
    google_user_id="flowkit-local-developer",
    email="developer@flowkit.example.com",
    name="로컬 개발자",
    profile_image=None,
)


@router.get("/status", response_model=AuthStatusResponse)
def auth_status(user: OptionalUser) -> AuthStatusResponse:
    """서비스 진입 시 로그인 상태 확인. 비로그인도 200."""
    if user is None:
        return AuthStatusResponse(is_authenticated=False, user=None)
    return AuthStatusResponse(
        is_authenticated=True, user=UserProfile.model_validate(user)
    )


@router.post("/google", response_model=TokenResponse)
def google_login(payload: GoogleLoginRequest, db: DbSession) -> TokenResponse:
    """ID 토큰 검증 → 사용자 조회/생성 → 서비스 토큰 발급."""
    google_user = verify_google_id_token(payload.id_token)
    user, is_new_user = auth_service.find_or_create_user(db, google_user)
    access_token, refresh_token, expires_at = auth_service.issue_tokens(
        db, user, device_info=payload.device_info
    )
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_at=expires_at,
        user=UserProfile.model_validate(user),
        is_new_user=is_new_user,
        action_meta=ActionMeta(
            action_type="auth_login",
            success_code="AUTH_LOGIN_SUCCEEDED",
            message="로그인했습니다.",
            affected_resource_id=user.id,
        ),
    )


@router.post("/google/redirect", response_class=RedirectResponse)
def google_redirect_login(
    credential: Annotated[str, Form()], db: DbSession
) -> RedirectResponse:
    """Google가 POST한 ID 토큰을 현재 탭 복귀용 일회성 코드로 바꾼다."""
    google_user = verify_google_id_token(credential)
    user, is_new_user = auth_service.find_or_create_user(db, google_user)
    code = auth_service.create_google_login_exchange(db, user, is_new_user)
    frontend_base_url = get_settings().frontend_base_url.rstrip("/")
    return RedirectResponse(
        url=f"{frontend_base_url}/?googleLoginCode={quote(code)}",
        status_code=303,
    )


@router.post("/google/exchange", response_model=TokenResponse)
def exchange_google_login(
    payload: GoogleLoginExchangeRequest, db: DbSession
) -> TokenResponse:
    """프론트엔드가 복귀 URL의 코드를 한 번만 서비스 토큰으로 교환한다."""
    user, is_new_user = auth_service.redeem_google_login_exchange(db, payload.code)
    access_token, refresh_token, expires_at = auth_service.issue_tokens(
        db, user, device_info="google-redirect"
    )
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_at=expires_at,
        user=UserProfile.model_validate(user),
        is_new_user=is_new_user,
        action_meta=ActionMeta(
            action_type="auth_login",
            success_code="AUTH_LOGIN_SUCCEEDED",
            message="로그인했습니다.",
            affected_resource_id=user.id,
        ),
    )


@router.post("/dev", response_model=TokenResponse)
def dev_login(request: Request, db: DbSession) -> TokenResponse:
    """Cursor 내장 브라우저 등 로컬 개발 환경에서만 서비스 토큰을 발급한다."""
    if not get_settings().dev_login_enabled or not _is_loopback_request(request):
        raise DevLoginUnavailableError()

    user, is_new_user = auth_service.find_or_create_user(db, _LOCAL_DEV_USER)
    access_token, refresh_token, expires_at = auth_service.issue_tokens(
        db, user, device_info="local-dev-login"
    )
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_at=expires_at,
        user=UserProfile.model_validate(user),
        is_new_user=is_new_user,
        action_meta=ActionMeta(
            action_type="auth_login",
            success_code="AUTH_LOGIN_SUCCEEDED",
            message="로그인했습니다.",
            affected_resource_id=user.id,
        ),
    )


@router.post("/refresh", response_model=TokenResponse)
def refresh(payload: RefreshRequest, db: DbSession) -> TokenResponse:
    """refreshToken 회전. 기존 토큰은 즉시 폐기된다."""
    access_token, refresh_token, expires_at, user = auth_service.rotate_tokens(
        db, payload.refresh_token
    )
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_at=expires_at,
        user=UserProfile.model_validate(user),
        action_meta=ActionMeta(
            action_type="auth_session_refresh",
            success_code="AUTH_SESSION_REFRESHED",
            message="로그인 세션을 갱신했습니다.",
            affected_resource_id=user.id,
        ),
    )


@router.get("/me", response_model=UserProfile)
def me(user: CurrentUser) -> UserProfile:
    """현재 로그인 사용자 조회."""
    return UserProfile.model_validate(user)


@router.patch("/me", response_model=UpdateProfileResponse)
def update_me(
    payload: UpdateProfileRequest, user: CurrentUser, db: DbSession
) -> UpdateProfileResponse:
    """계정 기본 정보 수정."""
    updated = auth_service.update_profile(
        db,
        user,
        name=payload.name,
        email=payload.email,
        memo=payload.memo,
        memo_present="memo" in payload.model_fields_set,
    )
    profile = UserProfile.model_validate(updated)
    return UpdateProfileResponse(
        **profile.model_dump(),
        action_meta=ActionMeta(
            action_type="profile_update",
            success_code="PROFILE_UPDATED",
            message="프로필을 수정했습니다.",
            affected_resource_id=updated.id,
        ),
    )


@router.post("/logout", response_model=LogoutResponse)
def logout(user: CurrentUser, db: DbSession) -> LogoutResponse:
    """현재 사용자의 refreshToken 전체 무효화."""
    auth_service.logout(db, user.id)
    return LogoutResponse(
        logout_success=True,
        action_meta=ActionMeta(
            action_type="auth_logout",
            success_code="AUTH_LOGOUT_SUCCEEDED",
            message="로그아웃했습니다.",
            affected_resource_id=user.id,
        ),
    )


def _is_loopback_request(request: Request) -> bool:
    if request.client is None:
        return False
    try:
        return ip_address(request.client.host).is_loopback
    except ValueError:
        return request.client.host == "localhost"
