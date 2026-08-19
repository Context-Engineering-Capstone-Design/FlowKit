"""표준 오류 응답 (BE-AUTH-010, BE-NOTIFY-001).

FE가 일관되게 처리할 수 있도록 모든 오류를 errorCode/message/detail/traceId 형태로 반환한다.
내부 stack trace 는 노출하지 않고 traceId 만 제공한다.
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse


class AppError(Exception):
    status_code = 500
    error_code = "INTERNAL_ERROR"
    message = "서버 오류가 발생했습니다."

    def __init__(self, message: str | None = None, detail: Any = None) -> None:
        super().__init__(message or self.message)
        if message:
            self.message = message
        self.detail = detail


class UnauthorizedError(AppError):
    status_code = 401
    error_code = "UNAUTHORIZED"
    message = "인증이 필요합니다."


class TokenExpiredError(AppError):
    status_code = 401
    error_code = "TOKEN_EXPIRED"
    message = "토큰이 만료되었습니다."


class SessionNotFoundError(AppError):
    status_code = 401
    error_code = "SESSION_NOT_FOUND"
    message = "세션을 찾을 수 없습니다."


class InvalidGoogleIdTokenError(AppError):
    status_code = 401
    error_code = "INVALID_GOOGLE_ID_TOKEN"
    message = "유효하지 않은 Google 로그인 정보입니다."


class TokenReuseDetectedError(AppError):
    """이미 회전된 refreshToken 이 다시 제출된 경우 (토큰 탈취 의심, BE-AUTH-006)."""

    status_code = 401
    error_code = "TOKEN_REUSE_DETECTED"
    message = "이미 사용된 토큰입니다. 보안을 위해 모든 세션을 종료했습니다."


class ValidationError(AppError):
    status_code = 400
    error_code = "VALIDATION_ERROR"
    message = "입력값이 올바르지 않습니다."


class ChatNotFoundError(AppError):
    status_code = 404
    error_code = "CHAT_NOT_FOUND"
    message = "채팅을 찾을 수 없습니다."


class ChatAccessDeniedError(AppError):
    status_code = 403
    error_code = "CHAT_ACCESS_DENIED"
    message = "해당 채팅에 접근할 권한이 없습니다."


class BranchNotFoundError(AppError):
    status_code = 404
    error_code = "BRANCH_NOT_FOUND"
    message = "브랜치를 찾을 수 없습니다."


class MessageBlockNotFoundError(AppError):
    status_code = 404
    error_code = "MESSAGE_BLOCK_NOT_FOUND"
    message = "메시지 블록을 찾을 수 없습니다."


class UserNotFoundError(AppError):
    status_code = 404
    error_code = "USER_NOT_FOUND"
    message = "사용자를 찾을 수 없습니다."


class EmailAlreadyExistsError(AppError):
    status_code = 409
    error_code = "EMAIL_ALREADY_EXISTS"
    message = "이미 사용 중인 이메일입니다."


class ApiKeyNotRegisteredError(AppError):
    status_code = 400
    error_code = "API_KEY_NOT_REGISTERED"
    message = "API 키가 등록되지 않았습니다. API 키를 등록해주세요."


class ApiKeyNotFoundError(AppError):
    status_code = 404
    error_code = "API_KEY_NOT_FOUND"
    message = "등록된 API 키를 찾을 수 없습니다."


class ApiKeyInvalidFormatError(AppError):
    status_code = 400
    error_code = "API_KEY_INVALID_FORMAT"
    message = "API 키 형식이 올바르지 않습니다."


class ApiKeyEncryptionError(AppError):
    status_code = 500
    error_code = "API_KEY_ENCRYPTION_FAILED"
    message = "API 키를 안전하게 저장하지 못했습니다."


class ApiKeyDecryptionError(AppError):
    status_code = 500
    error_code = "API_KEY_DECRYPTION_FAILED"
    message = "저장된 API 키를 읽지 못했습니다. 다시 등록해주세요."


class ProviderNotConfiguredError(AppError):
    status_code = 400
    error_code = "PROVIDER_NOT_CONFIGURED"
    message = "지원하지 않는 AI Provider입니다."


class ModelNotSupportedError(AppError):
    status_code = 400
    error_code = "MODEL_NOT_SUPPORTED"
    message = "지원하지 않는 모델입니다."


class WebSearchNotSupportedError(AppError):
    status_code = 400
    error_code = "WEB_SEARCH_NOT_SUPPORTED"
    message = "선택한 모델은 웹 검색을 지원하지 않습니다."


class AttachmentNotFoundError(AppError):
    status_code = 404
    error_code = "ATTACHMENT_NOT_FOUND"
    message = "첨부 파일을 찾을 수 없습니다."


class AttachmentInvalidTypeError(AppError):
    status_code = 400
    error_code = "ATTACHMENT_INVALID_TYPE"
    message = "지원하지 않는 파일 형식입니다."


class AttachmentTooLargeError(AppError):
    status_code = 400
    error_code = "ATTACHMENT_TOO_LARGE"
    message = "파일 크기가 제한을 초과했습니다."


class AttachmentLimitExceededError(AppError):
    status_code = 400
    error_code = "ATTACHMENT_LIMIT_EXCEEDED"
    message = "메시지당 첨부 파일 수 제한을 초과했습니다."


class AttachmentAlreadyUsedError(AppError):
    status_code = 409
    error_code = "ATTACHMENT_ALREADY_USED"
    message = "이미 전송에 사용한 첨부 파일은 삭제할 수 없습니다."


class AttachmentAccessDeniedError(AppError):
    status_code = 403
    error_code = "ATTACHMENT_ACCESS_DENIED"
    message = "해당 첨부 파일에 접근할 권한이 없습니다."


class AttachmentReadError(AppError):
    status_code = 400
    error_code = "ATTACHMENT_READ_FAILED"
    message = "첨부 파일을 읽지 못했습니다."


async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "errorCode": exc.error_code,
            "message": exc.message,
            "detail": exc.detail,
            "traceId": str(uuid.uuid4()),
        },
    )
