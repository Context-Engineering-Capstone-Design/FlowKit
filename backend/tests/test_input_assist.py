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
    client.put("/api/settings/api-keys/openai", json={"apiKey": "test-api-key-1234567890"}, headers=headers)
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
    assert response.json()[0]["modelId"] == "gpt-5.6-terra"
    assert response.json()[0]["isDefault"] is True


def test_upload_delete_and_send_attachment(client, auth, chat, monkeypatch):
    uploaded = client.post(
        attachment_url(chat), files={"file": ("notes.md", "# FlowKit\n첨부 본문".encode(), "text/markdown")}, headers=auth
    )
    assert uploaded.status_code == 201, uploaded.text
    attachment = uploaded.json()
    assert attachment["status"] == "temporary"
    assert attachment["mimeType"] == "text/markdown"
    assert attachment["actionMeta"] == {
        "actionType": "attachment_upload",
        "successCode": "ATTACHMENT_UPLOADED",
        "message": "파일을 첨부했습니다.",
        "affectedResourceId": attachment["attachmentId"],
    }

    import modeling
    from modeling.types import AnswerChunk, AnswerResult
    calls = []

    def _answer_stream(request, **_kwargs):
        calls.append(request)
        yield AnswerChunk(type="done", result=AnswerResult(text="답변", search_sources=[]))

    monkeypatch.setattr(modeling, "generate_answer_stream", _answer_stream)
    monkeypatch.setattr(modeling, "generate_title", lambda *_args, **_kwargs: "제목")
    sent = client.post(message_url(chat), json={
        "userPrompt": "첨부를 읽어줘", "attachmentIds": [attachment["attachmentId"]],
        "webSearchMode": "auto",
    }, headers=auth)
    assert sent.status_code == 201, sent.text
    assert sent.json()["attachments"][0]["status"] == "attached"
    assert calls[0].attachments[0].content == "# FlowKit\n첨부 본문".encode()
    assert calls[0].web_search_mode == "auto"

    deleted = client.delete(f"{attachment_url(chat)}/{attachment['attachmentId']}", headers=auth)
    assert deleted.status_code == 409
    assert deleted.json()["errorCode"] == "ATTACHMENT_ALREADY_USED"

    chat_id = chat["chatMeta"]["chatId"]
    reopened = client.get(f"/api/chats/{chat_id}", headers=auth)
    user_block = next(b for b in reopened.json()["messageBlocks"] if b["role"] == "user")
    assert user_block["attachments"][0]["fileName"] == "notes.md"
    assert user_block["attachments"][0]["status"] == "attached"


def test_upload_accepts_cp949_encoded_text_attachment(client, auth, chat):
    # 한글 레거시 인코딩(cp949)으로 저장된 .txt 도 첨부할 수 있어야 한다.
    # modeling.attachments._decode 가 실제 답변 생성 때 cp949 로 한 번 더
    # 읽어 주므로, 업로드 검증에서도 같은 순서로 받아 줘야 한다.
    cp949_bytes = "한글 문서 테스트".encode("cp949")
    uploaded = client.post(
        attachment_url(chat), files={"file": ("note.txt", cp949_bytes, "text/plain")}, headers=auth
    )
    assert uploaded.status_code == 201, uploaded.text
    assert uploaded.json()["mimeType"] == "text/plain"


def test_upload_rejects_undecodable_bytes_with_text_extension(client, auth, chat):
    garbage = bytes([0xFF, 0xFF, 0xFF, 0xFF])
    uploaded = client.post(
        attachment_url(chat), files={"file": ("broken.txt", garbage, "text/plain")}, headers=auth
    )
    assert uploaded.status_code == 400
    assert uploaded.json()["errorCode"] == "ATTACHMENT_INVALID_TYPE"


MIN_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082"
)


def test_download_uploaded_image(client, auth, chat):
    uploaded = client.post(
        attachment_url(chat),
        files={"file": ("shot.png", MIN_PNG, "image/png")},
        headers=auth,
    )
    assert uploaded.status_code == 201, uploaded.text
    attachment_id = uploaded.json()["attachmentId"]

    downloaded = client.get(
        f"{attachment_url(chat)}/{attachment_id}/file",
        headers=auth,
    )
    assert downloaded.status_code == 200
    assert downloaded.headers["content-type"].startswith("image/png")
    assert downloaded.content == MIN_PNG


def test_other_user_cannot_download_attachment(client, auth, chat, monkeypatch):
    created = client.post(
        attachment_url(chat),
        files={"file": ("shot.png", MIN_PNG, "image/png")},
        headers=auth,
    ).json()
    other = GoogleUser("sub-other-download", "other-download@example.com", "다른사람", None)
    monkeypatch.setattr(auth_router, "verify_google_id_token", lambda _t: other)
    token = client.post("/api/auth/google", json={"idToken": "other"}).json()["accessToken"]
    result = client.get(
        f"{attachment_url(chat)}/{created['attachmentId']}/file",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert result.status_code == 403


def test_delete_temporary_attachment_returns_compatible_success_body(
    client, auth, chat
):
    created = client.post(
        attachment_url(chat),
        files={"file": ("delete-me.txt", b"temporary", "text/plain")},
        headers=auth,
    ).json()

    response = client.delete(
        f"{attachment_url(chat)}/{created['attachmentId']}", headers=auth
    )

    assert response.status_code == 200
    assert response.json() == {
        "deleteSuccess": True,
        "attachmentId": created["attachmentId"],
        "actionMeta": {
            "actionType": "attachment_delete",
            "successCode": "ATTACHMENT_DELETED",
            "message": "첨부 파일을 삭제했습니다.",
            "affectedResourceId": created["attachmentId"],
        },
    }


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
