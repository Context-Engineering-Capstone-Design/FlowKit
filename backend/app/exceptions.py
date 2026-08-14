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


class UserNotFoundError(AppError):
    status_code = 404
    error_code = "USER_NOT_FOUND"
    message = "사용자를 찾을 수 없습니다."


class EmailAlreadyExistsError(AppError):
    status_code = 409
    error_code = "EMAIL_ALREADY_EXISTS"
    message = "이미 사용 중인 이메일입니다."


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
