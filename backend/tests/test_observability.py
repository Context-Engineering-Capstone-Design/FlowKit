"""오류 식별자·클라이언트 오류 기록 API 테스트."""

from __future__ import annotations

from sqlalchemy import select

from app.models import ClientErrorLog


def test_validation_error_has_matching_trace_id(client):
    response = client.post("/api/client-errors", json={})

    assert response.status_code == 422
    assert response.headers["X-Trace-Id"] == response.json()["traceId"]
    assert response.json()["errorCode"] == "VALIDATION_ERROR"


def test_client_error_masks_secrets_and_limits_context(client, db_session):
    response = client.post(
        "/api/client-errors",
        json={
            "clientErrorType": "window_error",
            "message": "Bearer secret-token test@example.com AIza12345678901234567890",
            "pageContext": {"page": "/chat", "chatId": "chat-1", "token": "nope"},
        },
    )

    assert response.status_code == 201
    item = db_session.scalar(select(ClientErrorLog))
    assert item is not None
    assert item.trace_id == response.headers["X-Trace-Id"]
    assert item.message == "[redacted] [redacted] [redacted]"
    assert item.page_context == {"page": "/chat", "chatId": "chat-1"}
