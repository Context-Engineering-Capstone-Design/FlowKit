from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.schemas.notification import ActionMeta


class GoogleLoginRequest(BaseModel):
    id_token: str = Field(..., alias="idToken", description="Google SDK로 받은 ID 토큰")
    device_info: str | None = Field(None, alias="deviceInfo")

    model_config = ConfigDict(populate_by_name=True)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(..., alias="refreshToken")

    model_config = ConfigDict(populate_by_name=True)


class UserProfile(BaseModel):
    id: uuid.UUID = Field(..., serialization_alias="userId")
    name: str
    email: EmailStr
    profile_image: str | None = Field(None, serialization_alias="profileImage")
    memo: str | None = None
    # 등급·과금 체계가 아직 없어 모든 사용자에게 고정값을 돌려준다 (BE-AUTH-007).
    plan: str = "free"

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class TokenResponse(BaseModel):
    access_token: str = Field(..., serialization_alias="accessToken")
    refresh_token: str = Field(..., serialization_alias="refreshToken")
    expires_at: datetime = Field(..., serialization_alias="expiresAt")
    user: UserProfile
    is_new_user: bool = Field(False, serialization_alias="isNewUser")
    action_meta: ActionMeta = Field(..., serialization_alias="actionMeta")

    model_config = ConfigDict(populate_by_name=True)


class UpdateProfileRequest(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    email: EmailStr | None = None
    memo: str | None = None


class UpdateProfileResponse(UserProfile):
    action_meta: ActionMeta = Field(..., serialization_alias="actionMeta")


class LogoutResponse(BaseModel):
    logout_success: bool = Field(..., serialization_alias="logoutSuccess")
    action_meta: ActionMeta = Field(..., serialization_alias="actionMeta")

    model_config = ConfigDict(populate_by_name=True)


class AuthStatusResponse(BaseModel):
    """BE-AUTH-001: 비로그인 상태도 200 으로 표현한다."""

    is_authenticated: bool = Field(..., serialization_alias="isAuthenticated")
    user: UserProfile | None = None

    model_config = ConfigDict(populate_by_name=True)
