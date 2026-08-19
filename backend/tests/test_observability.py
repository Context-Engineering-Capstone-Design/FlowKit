"""표준 오류 응답과 서버·클라이언트 오류 기록 테스트."""

from __future__ import annotations

import asyncio
import json
import uuid
from types import SimpleNamespace

import pytest
from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app.exceptions import (
    ApiKeyEncryptionError,
    app_error_handler,
    unexpected_error_handler,
)
from app.models import ClientErrorLog, ErrorLog
from app.routers import auth as auth_router
from app.routers import observability
from app.services import error_log_service
from app.services.google_auth import GoogleUser


def test_validation_error_has_matching_trace_id(client):
    response = client.post("/api/client-errors", json={})

    assert response.status_code == 422
    assert response.headers["X-Trace-Id"] == response.json()["traceId"]
    assert response.json()["errorCode"] == "VALIDATION_ERROR"


def test_app_error_has_standard_shape_and_matching_trace_id(client):
    response = client.get("/api/chats")

    assert response.status_code == 401
    assert set(response.json()) == {"errorCode", "message", "detail", "traceId"}
    assert response.json()["errorCode"] == "UNAUTHORIZED"
    assert response.headers["X-Trace-Id"] == response.json()["traceId"]


def test_unknown_route_uses_standard_error_shape(client):
    response = client.get("/api/does-not-exist")

    assert response.status_code == 404
    assert response.json()["errorCode"] == "NOT_FOUND"
    assert response.headers["X-Trace-Id"] == response.json()["traceId"]


def test_unexpected_error_is_safe_and_saved_with_same_trace_id(
    db_session, monkeypatch
):
    log_session = sessionmaker(
        bind=db_session.get_bind(), autoflush=False, expire_on_commit=False
    )
    monkeypatch.setattr(error_log_service, "SessionLocal", log_session)
    trace_id = str(uuid.uuid4())
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "scheme": "http",
            "path": "/api/test-error",
            "raw_path": b"/api/test-error",
            "query_string": b"token=must-not-be-saved",
            "headers": [],
            "client": ("127.0.0.1", 1234),
            "server": ("testserver", 80),
        }
    )
    request.state.trace_id = trace_id

    response = asyncio.run(
        unexpected_error_handler(
            request, RuntimeError("Bearer secret-token user@example.com")
        )
    )

    body = json.loads(response.body)
    item = db_session.get(ErrorLog, trace_id)
    assert response.status_code == 500
    assert body["traceId"] == trace_id
    assert body["errorCode"] == "INTERNAL_ERROR"
    assert "secret-token" not in response.body.decode()
    assert item is not None
    assert item.trace_id == body["traceId"]
    assert item.request_path == "/api/test-error"
    assert item.error_code == "INTERNAL_ERROR"
    assert item.exception_type == "RuntimeError"
    assert "secret-token" not in item.message


def test_server_app_error_is_saved_with_response_trace_id(db_session, monkeypatch):
    log_session = sessionmaker(
        bind=db_session.get_bind(), autoflush=False, expire_on_commit=False
    )
    monkeypatch.setattr(error_log_service, "SessionLocal", log_session)
    trace_id = str(uuid.uuid4())
    request = Request(
        {
            "type": "http",
            "method": "PUT",
            "scheme": "http",
            "path": "/api/settings/api-keys/google",
            "raw_path": b"/api/settings/api-keys/google",
            "query_string": b"",
            "headers": [],
            "client": ("127.0.0.1", 1234),
            "server": ("testserver", 80),
        }
    )
    request.state.trace_id = trace_id

    response = asyncio.run(app_error_handler(request, ApiKeyEncryptionError()))

    item = db_session.get(ErrorLog, trace_id)
    assert response.status_code == 500
    assert json.loads(response.body)["traceId"] == trace_id
    assert item is not None
    assert item.error_code == "API_KEY_ENCRYPTION_FAILED"
    assert item.exception_type == "ApiKeyEncryptionError"


def test_client_error_masks_secrets_and_limits_context(client, db_session):
    response = client.post(
        "/api/client-errors",
        json={
            "clientErrorType": "window_error",
            "message": "Bearer secret-token test@example.com AIza12345678901234567890",
            "pageContext": {
                "page": "/chat",
                "chatId": "chat-1",
                "token": "nope",
                "prompt": "질문 원문",
            },
        },
    )

    assert response.status_code == 201
    assert set(response.json()) == {"logId", "receivedAt"}
    item = db_session.scalar(select(ClientErrorLog))
    assert item is not None
    assert item.trace_id == response.headers["X-Trace-Id"]
    assert item.message == "[redacted] [redacted] [redacted]"
    assert item.page_context == {"page": "/chat", "chatId": "chat-1"}


@pytest.mark.parametrize(
    "payload",
    [
        {"clientErrorType": "unknown", "message": "오류"},
        {"clientErrorType": "window_error", "message": "   "},
        {"clientErrorType": "window_error", "message": "x" * 2_001},
        {"clientErrorType": "window_error", "message": "오류", "extra": "no"},
    ],
)
def test_client_error_rejects_invalid_type_length_and_fields(client, payload):
    response = client.post("/api/client-errors", json=payload)

    assert response.status_code == 422
    assert response.json()["errorCode"] == "VALIDATION_ERROR"


def test_client_error_links_authenticated_user(
    client, db_session, monkeypatch
):
    user = GoogleUser("sub-client-log", "client-log@example.com", "오류테스터", None)
    monkeypatch.setattr(auth_router, "verify_google_id_token", lambda _token: user)
    login = client.post("/api/auth/google", json={"idToken": "dummy"})
    headers = {"Authorization": f"Bearer {login.json()['accessToken']}"}

    response = client.post(
        "/api/client-errors",
        json={"clientErrorType": "react_render_error", "message": "렌더링 오류"},
        headers=headers,
    )

    assert response.status_code == 201
    item = db_session.scalar(select(ClientErrorLog))
    assert item is not None
    assert item.user_id is not None


def test_client_error_rate_limit_is_standard_and_does_not_save_excess(
    client, db_session, monkeypatch
):
    monkeypatch.setattr(
        observability,
        "get_settings",
        lambda: SimpleNamespace(
            client_error_rate_limit=2,
            client_error_rate_window_seconds=60,
            client_error_stored_message_chars=500,
        ),
    )
    observability._client_error_rate_limiter.reset()
    payload = {"clientErrorType": "window_error", "message": "오류"}

    try:
        assert client.post("/api/client-errors", json=payload).status_code == 201
        assert client.post("/api/client-errors", json=payload).status_code == 201
        limited = client.post("/api/client-errors", json=payload)
    finally:
        observability._client_error_rate_limiter.reset()

    assert limited.status_code == 429
    assert limited.json()["errorCode"] == "CLIENT_ERROR_RATE_LIMITED"
    assert limited.headers["X-Trace-Id"] == limited.json()["traceId"]
    assert len(db_session.scalars(select(ClientErrorLog)).all()) == 2
