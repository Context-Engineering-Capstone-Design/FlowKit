"""서비스 피드백 입력 제한·저장·성공 메타데이터 테스트."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models import ServiceFeedback
from app.routers import auth as auth_router
from app.services.google_auth import GoogleUser

USER = GoogleUser("sub-feedback", "feedback@example.com", "피드백테스터", None)


@pytest.fixture
def auth(client, monkeypatch) -> dict[str, str]:
    monkeypatch.setattr(auth_router, "verify_google_id_token", lambda _token: USER)
    response = client.post("/api/auth/google", json={"idToken": "dummy"})
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}


def test_feedback_saves_only_allowed_context_and_returns_action_meta(
    client, auth, db_session
):
    response = client.post(
        "/api/settings/feedback",
        headers=auth,
        json={
            "feedbackType": "usability",
            "content": "  더 빠르게 이동하고 싶어요.  ",
            "contextInfo": {
                "page": "workspace",
                "chatId": "chat-1",
                "branchId": "branch-1",
                "prompt": "저장하면 안 되는 질문",
                "token": "저장하면 안 되는 토큰",
            },
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["actionMeta"] == {
        "actionType": "service_feedback_submit",
        "successCode": "SERVICE_FEEDBACK_SUBMITTED",
        "message": "피드백을 제출했습니다.",
        "affectedResourceId": body["feedbackId"],
    }
    item = db_session.scalar(select(ServiceFeedback))
    assert item is not None
    assert item.content == "더 빠르게 이동하고 싶어요."
    assert item.context_info == {
        "page": "workspace",
        "chatId": "chat-1",
        "branchId": "branch-1",
    }


@pytest.mark.parametrize(
    "payload",
    [
        {"feedbackType": "invalid", "content": "의견"},
        {"feedbackType": "other", "content": "   "},
        {"feedbackType": "other", "content": "x" * 2_001},
        {"feedbackType": "other", "content": "의견", "extra": "no"},
    ],
)
def test_feedback_rejects_invalid_type_length_and_fields(client, auth, payload):
    response = client.post("/api/settings/feedback", headers=auth, json=payload)

    assert response.status_code == 422
    assert response.json()["errorCode"] == "VALIDATION_ERROR"
    assert response.headers["X-Trace-Id"] == response.json()["traceId"]


def test_feedback_requires_authentication(client):
    response = client.post(
        "/api/settings/feedback",
        json={"feedbackType": "other", "content": "의견"},
    )

    assert response.status_code == 401
    assert response.json()["errorCode"] == "UNAUTHORIZED"
