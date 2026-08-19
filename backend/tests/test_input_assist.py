from __future__ import annotations

import pytest

from app.routers import auth as auth_router
from app.services.google_auth import GoogleUser

USER = GoogleUser("sub-input", "input@example.com", "입력테스터", None)


@pytest.fixture
def auth(client, monkeypatch) -> dict:
    monkeypatch.setattr(auth_router, "verify_google_id_token", lambda _t: USER)
    result = client.post("/api/auth/google", json={"idToken": "dummy"})
    headers = {"Authorization": f"Bearer {result.json()['accessToken']}"}
    client.put("/api/settings/api-keys/google", json={"apiKey": "test-api-key-1234567890"}, headers=headers)
    return headers


@pytest.fixture
def chat(client, auth) -> dict:
    return client.post("/api/chats", headers=auth).json()


def attachment_url(chat: dict) -> str:
    return f"/api/chats/{chat['chatMeta']['chatId']}/attachments"


def message_url(chat: dict) -> str:
    return f"{attachment_url(chat).removesuffix('/attachments')}/branches/{chat['branchMeta']['branchId']}/messages"


def test_models_are_from_modeling_settings(client):
    response = client.get("/api/models")
    assert response.status_code == 200
    assert response.json()[0]["modelId"] == "gemini-3.6-flash"
    assert response.json()[0]["isDefault"] is True


def test_upload_delete_and_send_attachment(client, auth, chat, monkeypatch):
    uploaded = client.post(
        attachment_url(chat), files={"file": ("notes.md", "# FlowKit\n첨부 본문".encode(), "text/markdown")}, headers=auth
    )
    assert uploaded.status_code == 201, uploaded.text
    attachment = uploaded.json()
    assert attachment["status"] == "temporary"
    assert attachment["mimeType"] == "text/markdown"

    import modeling
    calls = []
    monkeypatch.setattr(modeling, "generate_answer", lambda request, **_kwargs: calls.append(request) or "답변")
    monkeypatch.setattr(modeling, "generate_title", lambda *_args, **_kwargs: "제목")
    sent = client.post(message_url(chat), json={
        "userPrompt": "첨부를 읽어줘", "attachmentIds": [attachment["attachmentId"]],
        "webSearchEnabled": True,
    }, headers=auth)
    assert sent.status_code == 201, sent.text
    assert sent.json()["attachments"][0]["status"] == "attached"
    assert calls[0].attachments[0].content == "# FlowKit\n첨부 본문".encode()
    assert calls[0].web_search_enabled is True

    deleted = client.delete(f"{attachment_url(chat)}/{attachment['attachmentId']}", headers=auth)
    assert deleted.status_code == 409
    assert deleted.json()["errorCode"] == "ATTACHMENT_ALREADY_USED"


def test_rejects_path_filename_and_unallowed_bytes(client, auth, chat):
    bad = client.post(attachment_url(chat), files={"file": ("../../evil.exe", b"MZ", "application/octet-stream")}, headers=auth)
    assert bad.status_code == 400
    assert bad.json()["errorCode"] == "ATTACHMENT_INVALID_TYPE"


def test_other_user_cannot_delete_attachment(client, auth, chat, monkeypatch):
    created = client.post(attachment_url(chat), files={"file": ("note.txt", b"hello", "text/plain")}, headers=auth).json()
    other = GoogleUser("sub-other-input", "other-input@example.com", "다른사람", None)
    monkeypatch.setattr(auth_router, "verify_google_id_token", lambda _t: other)
    token = client.post("/api/auth/google", json={"idToken": "other"}).json()["accessToken"]
    result = client.delete(f"{attachment_url(chat)}/{created['attachmentId']}", headers={"Authorization": f"Bearer {token}"})
    assert result.status_code == 403
