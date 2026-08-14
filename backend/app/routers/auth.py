"""인증 라우터 (2.1 인증 및 계정)."""

from __future__ import annotations

from fastapi import APIRouter

from app.deps import CurrentUser, DbSession, OptionalUser
from app.schemas.auth import (
    AuthStatusResponse,
    GoogleLoginRequest,
    RefreshRequest,
    TokenResponse,
    UpdateProfileRequest,
    UserProfile,
)
from app.services import auth_service
from app.services.google_auth import verify_google_id_token

router = APIRouter(prefix="/api/auth", tags=["Auth"])


@router.get("/status", response_model=AuthStatusResponse)
def auth_status(user: OptionalUser) -> AuthStatusResponse:
    """BE-AUTH-001: 서비스 진입 시 로그인 상태 확인. 비로그인도 200."""
    if user is None:
        return AuthStatusResponse(is_authenticated=False, user=None)
    return AuthStatusResponse(
        is_authenticated=True, user=UserProfile.model_validate(user)
    )


@router.post("/google", response_model=TokenResponse)
def google_login(payload: GoogleLoginRequest, db: DbSession) -> TokenResponse:
    """BE-AUTH-002~005: ID 토큰 검증 → 사용자 조회/생성 → 서비스 토큰 발급."""
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
    )


@router.post("/refresh", response_model=TokenResponse)
def refresh(payload: RefreshRequest, db: DbSession) -> TokenResponse:
    """BE-AUTH-006: refreshToken 회전. 기존 토큰은 즉시 폐기된다."""
    access_token, refresh_token, expires_at, user = auth_service.rotate_tokens(
        db, payload.refresh_token
    )
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_at=expires_at,
        user=UserProfile.model_validate(user),
    )


@router.get("/me", response_model=UserProfile)
def me(user: CurrentUser) -> UserProfile:
    """BE-AUTH-007: 현재 로그인 사용자 조회."""
    return UserProfile.model_validate(user)


@router.patch("/me", response_model=UserProfile)
def update_me(
    payload: UpdateProfileRequest, user: CurrentUser, db: DbSession
) -> UserProfile:
    """BE-AUTH-008: 계정 기본 정보 수정."""
    updated = auth_service.update_profile(
        db, user, name=payload.name, email=payload.email, memo=payload.memo
    )
    return UserProfile.model_validate(updated)


@router.post("/logout")
def logout(user: CurrentUser, db: DbSession) -> dict[str, bool]:
    """BE-AUTH-009: 현재 사용자의 refreshToken 전체 무효화."""
    auth_service.logout(db, user.id)
    return {"logoutSuccess": True}
