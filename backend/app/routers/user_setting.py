from __future__ import annotations

from fastapi import APIRouter

from app.deps import CurrentUser, DbSession
from app.schemas.auth import UserProfile
from app.schemas.notification import ActionMeta
from app.schemas.service_feedback import FeedbackRequest, FeedbackResponse
from app.schemas.user_setting import (
    ApiKeyStatus,
    DeleteApiKeyResponse,
    SaveApiKeyRequest,
    UserSettingResponse,
)
from app.services import service_feedback_service, user_setting_service

router = APIRouter(prefix="/api/settings", tags=["UserSetting"])


def _api_key_status(record, provider: str = "google") -> ApiKeyStatus:
    if record is None:
        return ApiKeyStatus(
            has_api_key=False,
            provider=provider,
            last4=None,
            connected_status=None,
            checked_at=None,
            message=None,
        )
    return ApiKeyStatus(
        has_api_key=True,
        provider=record.provider,
        last4=record.last4,
        connected_status=record.connection_status.value,
        checked_at=record.last_checked_at,
        message=record.connection_message,
    )


@router.get("", response_model=UserSettingResponse)
def get_settings(user: CurrentUser, db: DbSession) -> UserSettingResponse:
    """BE-USERSET-001: 현재 사용자 정보와 API 키 등록 상태를 조회한다."""
    record = user_setting_service.get_api_key_record(db, user)
    return UserSettingResponse(
        user_profile=UserProfile.model_validate(user),
        api_key_status=_api_key_status(record),
    )


@router.put("/api-keys/{provider}", response_model=ApiKeyStatus)
def save_api_key(
    provider: str,
    payload: SaveApiKeyRequest,
    user: CurrentUser,
    db: DbSession,
) -> ApiKeyStatus:
    """BE-USERSET-003: 사용자 키를 암호화해 저장하거나 갱신한다."""
    record = user_setting_service.save_api_key(db, user, provider, payload.api_key)
    return _api_key_status(record)


@router.delete("/api-keys/{provider}", response_model=DeleteApiKeyResponse)
def delete_api_key(
    provider: str, user: CurrentUser, db: DbSession
) -> DeleteApiKeyResponse:
    """BE-USERSET-004: 현재 사용자의 Provider 키를 삭제한다."""
    provider = user_setting_service.validate_provider(provider)
    user_setting_service.delete_api_key(db, user, provider)
    return DeleteApiKeyResponse(
        delete_success=True, api_key_status=_api_key_status(None, provider)
    )


@router.post("/api-keys/{provider}/check", response_model=ApiKeyStatus)
def check_api_key(
    provider: str, user: CurrentUser, db: DbSession
) -> ApiKeyStatus:
    """BE-USERSET-005: 저장된 키로 Provider 연결을 확인한다."""
    record = user_setting_service.check_api_key_connection(db, user, provider)
    return _api_key_status(record)


@router.post("/feedback", response_model=FeedbackResponse, status_code=201)
def submit_feedback(
    payload: FeedbackRequest, user: CurrentUser, db: DbSession
) -> FeedbackResponse:
    item = service_feedback_service.submit(db, user, payload)
    return FeedbackResponse(
        feedback_id=item.id,
        submitted_at=item.created_at,
        action_meta=ActionMeta(
            action_type="service_feedback_submit",
            success_code="SERVICE_FEEDBACK_SUBMITTED",
            message="피드백을 제출했습니다.",
            affected_resource_id=item.id,
        ),
    )
