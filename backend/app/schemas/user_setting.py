from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.auth import UserProfile
from app.schemas.notification import ActionMeta


class ApiKeyStatus(BaseModel):
    has_api_key: bool = Field(..., serialization_alias="hasApiKey")
    provider: str
    last4: str | None = None
    connected_status: str | None = Field(None, serialization_alias="connectedStatus")
    checked_at: datetime | None = Field(None, serialization_alias="checkedAt")
    message: str | None = None

    model_config = ConfigDict(populate_by_name=True)


class UserSettingResponse(BaseModel):
    user_profile: UserProfile = Field(..., serialization_alias="userProfile")
    api_key_status: ApiKeyStatus = Field(..., serialization_alias="apiKeyStatus")

    model_config = ConfigDict(populate_by_name=True)


class ApiKeyMutationResponse(ApiKeyStatus):
    action_meta: ActionMeta = Field(..., serialization_alias="actionMeta")


class SaveApiKeyRequest(BaseModel):
    api_key: str = Field(..., alias="apiKey", max_length=512)

    model_config = ConfigDict(populate_by_name=True)


class DeleteApiKeyResponse(BaseModel):
    delete_success: bool = Field(..., serialization_alias="deleteSuccess")
    api_key_status: ApiKeyStatus = Field(..., serialization_alias="apiKeyStatus")
    action_meta: ActionMeta = Field(..., serialization_alias="actionMeta")

    model_config = ConfigDict(populate_by_name=True)
