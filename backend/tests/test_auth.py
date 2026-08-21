"""인증 플로우 테스트 (2.1 인증 및 계정).

실제 Google 서명 검증은 외부 의존이므로 verify_google_id_token 을 스텁으로 대체하고,
서비스가 책임지는 사용자 생성·토큰 발급·회전·폐기 로직을 검증한다.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import get_db
from app.main import app
from app.models import AuthSession, GoogleLoginExchange, User
from app.routers import auth as auth_router
from app.services import google_auth
from app.services.google_auth import GoogleUser, extract_google_user

GOOGLE_USER = GoogleUser(
    google_user_id="google-sub-1",
    email="tester@example.com",
    name="테스터",
    profile_image="https://example.com/p.png",
)


@pytest.fixture
def stub_google(monkeypatch):
    def _stub(user: GoogleUser = GOOGLE_USER):
        monkeypatch.setattr(
            auth_router, "verify_google_id_token", lambda _token: user
        )
    return _stub


def login(client, stub_google) -> dict:
    stub_google()
    res = client.post("/api/auth/google", json={"idToken": "dummy"})
    assert res.status_code == 200, res.text
    return res.json()


def google_redirect_login(client, stub_google, monkeypatch) -> str:
    stub_google()
    monkeypatch.setattr(
        auth_router,
        "get_settings",
        lambda: type("Settings", (), {"frontend_base_url": "https://flowkit.example.com"})(),
    )
    res = client.post(
        "/api/auth/google/redirect",
        data={"credential": "dummy"},
        follow_redirects=False,
    )
    assert res.status_code == 303, res.text
    location = res.headers["location"]
    assert location.startswith("https://flowkit.example.com/?googleLoginCode=")
    return parse_qs(urlparse(location).query)["googleLoginCode"][0]


# ── payload 추출 ──────────────────────────────────────────────


def test_google_token_verification_allows_five_second_clock_skew(monkeypatch):
    monkeypatch.setattr(
        google_auth,
        "get_settings",
        lambda: type("Settings", (), {"google_client_id": "client-id"})(),
    )

    from google.oauth2 import id_token as google_id_token

    captured: dict[str, int] = {}

    def fake_verify(_token, _request, _audience, *, clock_skew_in_seconds):
        captured["clock_skew_in_seconds"] = clock_skew_in_seconds
        return {
            "iss": "accounts.google.com",
            "sub": "google-sub-1",
            "email": "tester@example.com",
        }

    monkeypatch.setattr(google_id_token, "verify_oauth2_token", fake_verify)

    user = google_auth.verify_google_id_token("id-token")

    assert captured["clock_skew_in_seconds"] == 5
    assert user.google_user_id == "google-sub-1"


def test_extract_google_user_requires_email():
    from app.exceptions import InvalidGoogleIdTokenError

    with pytest.raises(InvalidGoogleIdTokenError):
        extract_google_user({"sub": "abc"})


def test_extract_google_user_falls_back_to_email_prefix():
    user = extract_google_user({"sub": "abc", "email": "hong@example.com"})
    assert user.name == "hong"


# ── , 005: 로그인 ────────────────────────────────────────────────


def test_google_login_creates_user_and_issues_tokens(client, stub_google, db_session):
    body = login(client, stub_google)

    assert body["isNewUser"] is True
    assert body["accessToken"] and body["refreshToken"]
    assert body["user"]["email"] == GOOGLE_USER.email
    assert body["actionMeta"]["successCode"] == "AUTH_LOGIN_SUCCEEDED"
    assert body["actionMeta"]["affectedResourceId"] == body["user"]["userId"]

    users = db_session.scalars(select(User)).all()
    assert len(users) == 1
    # refreshToken 원문은 저장하지 않는다
    session = db_session.scalars(select(AuthSession)).one()
    assert session.refresh_token_hash != body["refreshToken"]


def test_dev_login_is_hidden_when_disabled(client, monkeypatch):
    monkeypatch.setattr(
        auth_router,
        "get_settings",
        lambda: type("Settings", (), {"dev_login_enabled": False})(),
    )

    res = client.post("/api/auth/dev")

    assert res.status_code == 404
    assert res.json()["errorCode"] == "DEV_LOGIN_UNAVAILABLE"


def test_dev_login_rejects_non_loopback_request(client, monkeypatch):
    monkeypatch.setattr(
        auth_router,
        "get_settings",
        lambda: type("Settings", (), {"dev_login_enabled": True})(),
    )

    res = client.post("/api/auth/dev")

    assert res.status_code == 404
    assert res.json()["errorCode"] == "DEV_LOGIN_UNAVAILABLE"


def test_dev_login_issues_tokens_for_loopback_request(db_session, monkeypatch):
    monkeypatch.setattr(
        auth_router,
        "get_settings",
        lambda: type("Settings", (), {"dev_login_enabled": True})(),
    )
    app.dependency_overrides[get_db] = lambda: db_session
    try:
        with TestClient(app, client=("127.0.0.1", 50000)) as local_client:
            res = local_client.post("/api/auth/dev")
    finally:
        app.dependency_overrides.clear()

    assert res.status_code == 200
    body = res.json()
    assert body["accessToken"] and body["refreshToken"]
    assert body["user"]["email"] == "developer@flowkit.example.com"
    assert db_session.scalars(select(User)).one().name == "로컬 개발자"


def test_second_login_reuses_existing_user(client, stub_google, db_session):
    login(client, stub_google)
    body = login(client, stub_google)

    assert body["isNewUser"] is False
    assert len(db_session.scalars(select(User)).all()) == 1


def test_google_redirect_login_exchanges_code_once(client, stub_google, monkeypatch):
    code = google_redirect_login(client, stub_google, monkeypatch)

    exchanged = client.post("/api/auth/google/exchange", json={"code": code})

    assert exchanged.status_code == 200, exchanged.text
    assert exchanged.json()["user"]["email"] == GOOGLE_USER.email
    assert client.post("/api/auth/google/exchange", json={"code": code}).json()[
        "errorCode"
    ] == "GOOGLE_LOGIN_EXCHANGE_INVALID"


def test_google_redirect_login_rejects_expired_code(
    client, stub_google, monkeypatch, db_session
):
    code = google_redirect_login(client, stub_google, monkeypatch)
    exchange = db_session.scalars(select(GoogleLoginExchange)).one()
    exchange.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    db_session.commit()

    res = client.post("/api/auth/google/exchange", json={"code": code})

    assert res.status_code == 401
    assert res.json()["errorCode"] == "GOOGLE_LOGIN_EXCHANGE_INVALID"


def test_login_links_google_account_to_existing_email(client, stub_google, db_session):
    db_session.add(
        User(google_user_id="legacy", email=GOOGLE_USER.email, name="기존")
    )
    db_session.commit()

    body = login(client, stub_google)

    assert body["isNewUser"] is False
    user = db_session.scalars(select(User)).one()
    assert user.google_user_id == GOOGLE_USER.google_user_id


# ── , 007: 상태 확인 및 프로필 ──────────────────────────────────


def test_status_without_token_is_200_and_unauthenticated(client):
    res = client.get("/api/auth/status")
    assert res.status_code == 200
    assert res.json() == {"isAuthenticated": False, "user": None}


def test_status_with_invalid_token_does_not_error(client):
    res = client.get("/api/auth/status", headers={"Authorization": "Bearer garbage"})
    assert res.status_code == 200
    assert res.json()["isAuthenticated"] is False


def test_me_requires_authentication(client):
    res = client.get("/api/auth/me")
    assert res.status_code == 401
    assert res.json()["errorCode"] == "UNAUTHORIZED"


def test_me_returns_profile(client, stub_google):
    body = login(client, stub_google)
    res = client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {body['accessToken']}"},
    )
    assert res.status_code == 200
    assert res.json()["email"] == GOOGLE_USER.email
    assert res.json()["plan"] == "free"


# ── 프로필 수정 ────────────────────────────────────────────────


def test_update_profile(client, stub_google):
    body = login(client, stub_google)
    headers = {"Authorization": f"Bearer {body['accessToken']}"}

    res = client.patch("/api/auth/me", json={"name": "새이름", "memo": "메모"}, headers=headers)
    assert res.status_code == 200
    assert res.json()["name"] == "새이름"
    assert res.json()["memo"] == "메모"
    assert res.json()["actionMeta"]["successCode"] == "PROFILE_UPDATED"

    cleared = client.patch("/api/auth/me", json={"memo": None}, headers=headers)
    assert cleared.status_code == 200
    assert cleared.json()["memo"] is None


def test_update_profile_rejects_duplicate_email(client, stub_google, db_session):
    db_session.add(User(google_user_id="other", email="taken@example.com", name="다른사람"))
    db_session.commit()

    body = login(client, stub_google)
    res = client.patch(
        "/api/auth/me",
        json={"email": "taken@example.com"},
        headers={"Authorization": f"Bearer {body['accessToken']}"},
    )
    assert res.status_code == 409
    assert res.json()["errorCode"] == "EMAIL_ALREADY_EXISTS"


# ── refreshToken 회전 ─────────────────────────────────────────


def test_refresh_rotates_token(client, stub_google):
    body = login(client, stub_google)
    res = client.post("/api/auth/refresh", json={"refreshToken": body["refreshToken"]})

    assert res.status_code == 200
    new_body = res.json()
    assert new_body["refreshToken"] != body["refreshToken"]
    assert new_body["user"]["email"] == GOOGLE_USER.email
    assert new_body["actionMeta"]["successCode"] == "AUTH_SESSION_REFRESHED"


def test_old_refresh_token_is_revoked_immediately(client, stub_google):
    body = login(client, stub_google)
    client.post("/api/auth/refresh", json={"refreshToken": body["refreshToken"]})

    # 같은 토큰 재사용 → 탈취 의심
    res = client.post("/api/auth/refresh", json={"refreshToken": body["refreshToken"]})
    assert res.status_code == 401
    assert res.json()["errorCode"] == "TOKEN_REUSE_DETECTED"


def test_token_reuse_revokes_all_sessions(client, stub_google, db_session):
    body = login(client, stub_google)
    rotated = client.post(
        "/api/auth/refresh", json={"refreshToken": body["refreshToken"]}
    ).json()

    client.post("/api/auth/refresh", json={"refreshToken": body["refreshToken"]})

    # 탈취 탐지 후에는 회전으로 받은 최신 토큰도 무효여야 한다
    res = client.post("/api/auth/refresh", json={"refreshToken": rotated["refreshToken"]})
    assert res.status_code == 401
    active = db_session.scalars(
        select(AuthSession).where(AuthSession.revoked_at.is_(None))
    ).all()
    assert active == []


def test_unknown_refresh_token_returns_session_not_found(client):
    res = client.post("/api/auth/refresh", json={"refreshToken": "does-not-exist"})
    assert res.status_code == 401
    assert res.json()["errorCode"] == "SESSION_NOT_FOUND"


def test_expired_refresh_token_rejected(client, stub_google, db_session):
    body = login(client, stub_google)
    session = db_session.scalars(select(AuthSession)).one()
    session.expires_at = datetime.now(UTC) - timedelta(days=1)
    db_session.commit()

    res = client.post("/api/auth/refresh", json={"refreshToken": body["refreshToken"]})
    assert res.status_code == 401
    assert res.json()["errorCode"] == "TOKEN_EXPIRED"


# ── 로그아웃 ──────────────────────────────────────────────────


def test_logout_invalidates_refresh_tokens(client, stub_google):
    body = login(client, stub_google)
    res = client.post(
        "/api/auth/logout",
        headers={"Authorization": f"Bearer {body['accessToken']}"},
    )
    assert res.status_code == 200
    logout = res.json()
    assert logout["logoutSuccess"] is True
    assert logout["actionMeta"] == {
        "actionType": "auth_logout",
        "successCode": "AUTH_LOGOUT_SUCCEEDED",
        "message": "로그아웃했습니다.",
        "affectedResourceId": body["user"]["userId"],
    }

    res = client.post("/api/auth/refresh", json={"refreshToken": body["refreshToken"]})
    assert res.status_code == 401


def test_logout_invalidates_current_access_token(client, stub_google):
    """, 009: 로그아웃하면 만료 전에도 그 자리에서 쓰던 accessToken이 즉시 통하지 않아야 한다."""
    body = login(client, stub_google)
    headers = {"Authorization": f"Bearer {body['accessToken']}"}

    assert client.get("/api/auth/me", headers=headers).status_code == 200

    logout = client.post("/api/auth/logout", headers=headers)
    assert logout.status_code == 200

    res = client.get("/api/auth/me", headers=headers)
    assert res.status_code == 401

    status = client.get("/api/auth/status", headers=headers)
    assert status.json()["isAuthenticated"] is False


def test_refresh_revokes_old_access_token_session(client, stub_google):
    """토큰 회전 시 이전 세션도 폐기되어, 회전 전 accessToken은 더 이상 통하지 않는다."""
    body = login(client, stub_google)
    old_headers = {"Authorization": f"Bearer {body['accessToken']}"}

    rotated = client.post(
        "/api/auth/refresh", json={"refreshToken": body["refreshToken"]}
    )
    assert rotated.status_code == 200

    assert client.get("/api/auth/me", headers=old_headers).status_code == 401
    new_headers = {
        "Authorization": f"Bearer {rotated.json()['accessToken']}"
    }
    assert client.get("/api/auth/me", headers=new_headers).status_code == 200


# ── 표준 오류 형식 ────────────────────────────────────────────


def test_error_response_shape(client):
    res = client.get("/api/auth/me")
    body = res.json()
    assert set(body) == {"errorCode", "message", "detail", "traceId"}
    assert body["traceId"]
