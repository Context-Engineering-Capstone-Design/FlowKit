"""사용자별 AI API 키와 설정 API 테스트 ."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.exceptions import ApiKeyEncryptionError
from app.models import UserApiKey
from app.routers import auth as auth_router
from app.services import api_key_crypto
from app.services.google_auth import GoogleUser
from modeling.types import ConnectionResult

USER = GoogleUser("sub-setting", "setting@example.com", "설정테스터", None)
RAW_KEY = "openai-api-key-1234567890"


def login(client, monkeypatch, user: GoogleUser = USER) -> dict[str, str]:
    monkeypatch.setattr(auth_router, "verify_google_id_token", lambda _t: user)
    response = client.post("/api/auth/google", json={"idToken": "dummy"})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}


@pytest.fixture
def auth(client, monkeypatch) -> dict[str, str]:
    return login(client, monkeypatch)


def save_key(client, auth, api_key: str = RAW_KEY):
    return client.put(
        "/api/settings/api-keys/openai",
        json={"apiKey": api_key},
        headers=auth,
    )


def test_settings_returns_profile_and_empty_key_status(client, auth):
    response = client.get("/api/settings", headers=auth)

    assert response.status_code == 200
    assert response.json() == {
        "userProfile": {
            "userId": response.json()["userProfile"]["userId"],
            "name": "설정테스터",
            "email": "setting@example.com",
            "profileImage": None,
            "memo": None,
            "plan": "free",
        },
        "apiKeyStatus": {
            "hasApiKey": False,
            "provider": "openai",
            "last4": None,
            "connectedStatus": None,
            "checkedAt": None,
            "message": None,
        },
    }


def test_save_encrypts_key_and_returns_only_masked_status(client, auth, db_session):
    response = save_key(client, auth)

    assert response.status_code == 200
    body = response.json()
    assert body == {
        "hasApiKey": True,
        "provider": "openai",
        "last4": "7890",
        "connectedStatus": "unchecked",
        "checkedAt": None,
        "message": None,
        "actionMeta": {
            "actionType": "api_key_saved",
            "successCode": "API_KEY_SAVED",
            "message": "API 키를 저장했습니다.",
            "affectedResourceId": body["actionMeta"]["affectedResourceId"],
        },
    }
    record = db_session.scalar(select(UserApiKey))
    assert record is not None
    assert record.encrypted_api_key != RAW_KEY
    assert RAW_KEY not in record.encrypted_api_key
    assert RAW_KEY not in response.text


def test_save_updates_one_record_and_resets_connection_status(
    client, auth, db_session, monkeypatch
):
    import modeling

    assert save_key(client, auth).status_code == 200
    monkeypatch.setattr(
        modeling,
        "check_connection",
        lambda **_kwargs: ConnectionResult(success=True),
    )
    assert client.post(
        "/api/settings/api-keys/openai/check", headers=auth
    ).json()["connectedStatus"] == "connected"

    updated = save_key(client, auth, "replacement-key-0987654321")

    assert updated.status_code == 200
    assert updated.json()["last4"] == "4321"
    assert updated.json()["connectedStatus"] == "unchecked"
    assert len(db_session.scalars(select(UserApiKey)).all()) == 1


@pytest.mark.parametrize(
    ("url", "payload", "error_code"),
    [
        (
            "/api/settings/api-keys/google",
            {"apiKey": RAW_KEY},
            "PROVIDER_NOT_CONFIGURED",
        ),
        (
            "/api/settings/api-keys/openai",
            {"apiKey": "too-short"},
            "API_KEY_INVALID_FORMAT",
        ),
        (
            "/api/settings/api-keys/openai",
            {"apiKey": "invalid key with spaces"},
            "API_KEY_INVALID_FORMAT",
        ),
    ],
)
def test_save_rejects_unsupported_provider_and_invalid_format(
    client, auth, url, payload, error_code
):
    response = client.put(url, json=payload, headers=auth)

    assert response.status_code == 400
    assert response.json()["errorCode"] == error_code


def test_check_connection_saves_success_and_safe_failure_message(
    client, auth, monkeypatch
):
    import modeling

    assert save_key(client, auth).status_code == 200
    monkeypatch.setattr(
        modeling,
        "check_connection",
        lambda **_kwargs: ConnectionResult(success=True),
    )
    connected = client.post(
        "/api/settings/api-keys/openai/check", headers=auth
    )
    assert connected.status_code == 200
    assert connected.json()["connectedStatus"] == "connected"
    assert connected.json()["checkedAt"] is not None
    assert connected.json()["actionMeta"]["successCode"] == "API_KEY_CONNECTION_CHECKED"

    monkeypatch.setattr(
        modeling,
        "check_connection",
        lambda **_kwargs: ConnectionResult(
            success=False,
            reason=f"401 invalid api key {RAW_KEY}",
        ),
    )
    failed = client.post("/api/settings/api-keys/openai/check", headers=auth)

    assert failed.status_code == 200
    assert failed.json()["connectedStatus"] == "failed"
    assert failed.json()["message"] == "API 키를 확인해주세요."
    assert RAW_KEY not in failed.text

    monkeypatch.setattr(
        modeling,
        "check_connection",
        lambda **_kwargs: ConnectionResult(
            success=False, reason="request timed out"
        ),
    )
    timed_out = client.post("/api/settings/api-keys/openai/check", headers=auth)
    assert timed_out.status_code == 200
    assert timed_out.json()["message"] == (
        "연결 시간이 초과되었습니다. 잠시 후 다시 시도해주세요."
    )


def test_delete_removes_key_and_missing_delete_is_not_found(client, auth):
    assert save_key(client, auth).status_code == 200

    deleted = client.delete("/api/settings/api-keys/openai", headers=auth)

    assert deleted.status_code == 200
    assert deleted.json()["deleteSuccess"] is True
    assert deleted.json()["apiKeyStatus"]["hasApiKey"] is False
    assert deleted.json()["actionMeta"] == {
        "actionType": "api_key_deleted",
        "successCode": "API_KEY_DELETED",
        "message": "API 키를 삭제했습니다.",
        "affectedResourceId": None,
    }
    missing = client.delete("/api/settings/api-keys/openai", headers=auth)
    assert missing.status_code == 404
    assert missing.json()["errorCode"] == "API_KEY_NOT_FOUND"


def test_users_can_only_read_and_delete_their_own_key(client, monkeypatch):
    first = GoogleUser("sub-first", "first@example.com", "첫 사용자", None)
    second = GoogleUser("sub-second", "second@example.com", "둘째 사용자", None)
    first_auth = login(client, monkeypatch, first)
    assert save_key(client, first_auth, "first-user-key-1111").status_code == 200
    second_auth = login(client, monkeypatch, second)
    assert save_key(client, second_auth, "second-user-key-2222").status_code == 200

    assert client.get("/api/settings", headers=first_auth).json()["apiKeyStatus"][
        "last4"
    ] == "1111"
    assert client.get("/api/settings", headers=second_auth).json()["apiKeyStatus"][
        "last4"
    ] == "2222"
    assert client.delete(
        "/api/settings/api-keys/openai", headers=first_auth
    ).status_code == 200
    assert client.get("/api/settings", headers=second_auth).json()["apiKeyStatus"][
        "last4"
    ] == "2222"


def test_answer_and_title_receive_each_current_users_key(client, monkeypatch):
    import modeling

    answer_keys: list[str] = []
    title_keys: list[str] = []

    from modeling.types import AnswerChunk, AnswerResult

    def answer(_request, *, api_key):
        answer_keys.append(api_key)
        yield AnswerChunk(type="done", result=AnswerResult(text="답변", search_sources=[]))

    def title(_prompt, *, api_key):
        title_keys.append(api_key)
        return "제목"

    monkeypatch.setattr(modeling, "generate_answer_stream", answer)
    monkeypatch.setattr(modeling, "generate_title", title)

    users = [
        (
            GoogleUser("sub-ai-first", "ai-first@example.com", "첫 사용자", None),
            "first-user-api-key-1111",
        ),
        (
            GoogleUser("sub-ai-second", "ai-second@example.com", "둘째 사용자", None),
            "second-user-api-key-2222",
        ),
    ]
    for user, api_key in users:
        headers = login(client, monkeypatch, user)
        assert save_key(client, headers, api_key).status_code == 200
        chat = client.post("/api/chats", headers=headers).json()
        response = client.post(
            f"/api/chats/{chat['chatMeta']['chatId']}"
            f"/branches/{chat['branchMeta']['branchId']}/messages",
            json={"userPrompt": "질문", "contextBlockIds": []},
            headers=headers,
        )
        assert response.status_code == 201, response.text

    assert answer_keys == [users[0][1], users[1][1]]
    assert title_keys == [users[0][1], users[1][1]]


def test_refine_receives_current_users_key(client, auth, monkeypatch):
    import modeling
    from modeling.types import RefineResult

    received_keys: list[str] = []

    def refine(targets, _instruction, *, api_key):
        received_keys.append(api_key)
        return [
            RefineResult(block_id=target.block_id, refined_content="정제본")
            for target in targets
        ]

    monkeypatch.setattr(modeling, "refine_blocks", refine)
    assert save_key(client, auth).status_code == 200
    chat = client.post("/api/chats", headers=auth).json()
    chat_id = chat["chatMeta"]["chatId"]
    branch_id = chat["branchMeta"]["branchId"]
    block = client.post(
        f"/api/chats/{chat_id}/branches/{branch_id}/blocks",
        json={"role": "user", "content": "원문"},
        headers=auth,
    ).json()

    response = client.post(
        f"/api/chats/{chat_id}/branches/{branch_id}/refine-jobs",
        json={
            "selectedBlockIds": [block["blockId"]],
            "instructionText": "요약",
        },
        headers=auth,
    )

    assert response.status_code == 201, response.text
    assert received_keys == [RAW_KEY]


def test_refine_without_key_is_blocked_before_job_is_created(client, auth):
    chat = client.post("/api/chats", headers=auth).json()
    chat_id = chat["chatMeta"]["chatId"]
    branch_id = chat["branchMeta"]["branchId"]
    block = client.post(
        f"/api/chats/{chat_id}/branches/{branch_id}/blocks",
        json={"role": "user", "content": "원문"},
        headers=auth,
    ).json()

    response = client.post(
        f"/api/chats/{chat_id}/branches/{branch_id}/refine-jobs",
        json={
            "selectedBlockIds": [block["blockId"]],
            "instructionText": "요약",
        },
        headers=auth,
    )

    assert response.status_code == 400
    assert response.json()["errorCode"] == "API_KEY_NOT_REGISTERED"


def test_provider_failure_response_does_not_expose_api_key(
    client, auth, monkeypatch
):
    import modeling

    def fail(_request, **_kwargs):
        raise RuntimeError(f"provider rejected {RAW_KEY}")

    monkeypatch.setattr(modeling, "generate_answer_stream", fail)
    assert save_key(client, auth).status_code == 200
    chat = client.post("/api/chats", headers=auth).json()

    response = client.post(
        f"/api/chats/{chat['chatMeta']['chatId']}"
        f"/branches/{chat['branchMeta']['branchId']}/messages",
        json={"userPrompt": "질문", "contextBlockIds": []},
        headers=auth,
    )

    # 생성은 배경에서 도니 전송 응답은 항상 즉시 201이다. 실패는 답변 블록의
    # 상태로 나타난다 .
    assert response.status_code == 201, response.text
    assert RAW_KEY not in response.text
    block_id = response.json()["assistantBlock"]["blockId"]

    detail = client.get(f"/api/chats/{chat['chatMeta']['chatId']}", headers=auth)
    block = next(
        b for b in detail.json()["messageBlocks"] if b["blockId"] == block_id
    )
    assert block["generationStatus"] == "failed"
    assert RAW_KEY not in detail.text


def test_ai_request_without_key_is_blocked_before_question_is_saved(
    client, auth
):
    chat = client.post("/api/chats", headers=auth).json()
    chat_id = chat["chatMeta"]["chatId"]
    branch_id = chat["branchMeta"]["branchId"]

    response = client.post(
        f"/api/chats/{chat_id}/branches/{branch_id}/messages",
        json={"userPrompt": "키 없이 보내기", "contextBlockIds": []},
        headers=auth,
    )

    assert response.status_code == 400
    assert response.json()["errorCode"] == "API_KEY_NOT_REGISTERED"
    detail = client.get(f"/api/chats/{chat_id}", headers=auth).json()
    assert detail["messageBlocks"] == []


def test_missing_server_encryption_key_raises_safe_configuration_error(monkeypatch):
    monkeypatch.setattr(
        api_key_crypto,
        "get_settings",
        lambda: SimpleNamespace(api_key_encryption_key=""),
    )

    with pytest.raises(ApiKeyEncryptionError) as exc_info:
        api_key_crypto.encrypt_api_key(RAW_KEY)

    assert exc_info.value.error_code == "API_KEY_ENCRYPTION_FAILED"
    assert RAW_KEY not in exc_info.value.message
