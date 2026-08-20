"""사이드 채팅 트리 테스트 (0820_08 마일스톤 A)."""

from __future__ import annotations

import uuid

import pytest

from app.models import MessageBlock, MessageBlockVersion, MessageRole, VersionSourceType
from app.routers import auth as auth_router
from app.services.google_auth import GoogleUser
from modeling.types import AnswerChunk, AnswerResult

USER_A = GoogleUser("sub-side-a", "side-a@example.com", "사용자A", None)
USER_B = GoogleUser("sub-side-b", "side-b@example.com", "사용자B", None)


def _login(client, monkeypatch, google_user: GoogleUser) -> str:
    monkeypatch.setattr(auth_router, "verify_google_id_token", lambda _t: google_user)
    res = client.post("/api/auth/google", json={"idToken": "dummy"})
    assert res.status_code == 200, res.text
    return res.json()["accessToken"]


@pytest.fixture
def token(client, monkeypatch) -> str:
    return _login(client, monkeypatch, USER_A)


@pytest.fixture
def auth(token) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def chat(client, auth) -> dict:
    res = client.post("/api/chats", headers=auth)
    assert res.status_code == 201, res.text
    return res.json()


def _add_block(db, chat_id, branch_id, order: int, text: str, role=MessageRole.USER):
    block = MessageBlock(
        chat_id=uuid.UUID(str(chat_id)), branch_id=uuid.UUID(str(branch_id)),
        role=role, order_index=order,
    )
    db.add(block)
    db.flush()
    version = MessageBlockVersion(
        block_id=block.id, version_no=1, content=text, source_type=VersionSourceType.ORIGINAL,
    )
    db.add(version)
    db.flush()
    block.current_version_id = version.id
    db.commit()
    return block


def _create_side_chat(client, auth, chat: dict, anchor_id: str | None = None, title: str | None = None):
    chat_id = chat["chatMeta"]["chatId"]
    branch_id = chat["branchMeta"]["branchId"]
    body = {}
    if anchor_id is not None:
        body["anchorMessageBlockId"] = anchor_id
    if title is not None:
        body["title"] = title
    res = client.post(
        f"/api/chats/{chat_id}/branches/{branch_id}/side-chats", json=body, headers=auth,
    )
    assert res.status_code == 201, res.text
    return res.json()


# ── A1, A3: 생성과 부모·루트 기록 ────────────────────────────────────────────


def test_create_side_chat_from_main_records_parent_and_root(client, auth, chat, db_session):
    block = _add_block(db_session, chat["chatMeta"]["chatId"], chat["branchMeta"]["branchId"], 0, "질문")

    side = _create_side_chat(client, auth, chat, anchor_id=str(block.id))

    meta = side["chatMeta"]
    assert meta["kind"] == "SIDE"
    assert meta["title"] == "새 사이드 채팅"
    assert meta["parentChatId"] == chat["chatMeta"]["chatId"]
    assert meta["parentBranchId"] == chat["branchMeta"]["branchId"]
    assert meta["parentMessageBlockId"] == str(block.id)
    assert meta["rootChatId"] == chat["chatMeta"]["chatId"]
    assert meta["rootBranchId"] == chat["branchMeta"]["branchId"]
    assert side["branchMeta"]["branchName"] == "Main"
    assert side["messageBlocks"] == []
    assert side["actionMeta"]["successCode"] == "SIDE_CHAT_CREATED"


def test_create_side_chat_without_anchor_uses_latest_message(client, auth, chat, db_session):
    chat_id, branch_id = chat["chatMeta"]["chatId"], chat["branchMeta"]["branchId"]
    _add_block(db_session, chat_id, branch_id, 0, "첫 질문")
    latest = _add_block(db_session, chat_id, branch_id, 1, "둘째 질문")

    side = _create_side_chat(client, auth, chat)

    assert side["chatMeta"]["parentMessageBlockId"] == str(latest.id)


def test_create_side_chat_with_custom_title(client, auth, chat, db_session):
    block = _add_block(db_session, chat["chatMeta"]["chatId"], chat["branchMeta"]["branchId"], 0, "질문")
    side = _create_side_chat(client, auth, chat, anchor_id=str(block.id), title="다른 각도로 탐색")
    assert side["chatMeta"]["title"] == "다른 각도로 탐색"


def test_create_side_chat_rejects_unknown_anchor(client, auth, chat):
    res = client.post(
        f"/api/chats/{chat['chatMeta']['chatId']}/branches/{chat['branchMeta']['branchId']}/side-chats",
        json={"anchorMessageBlockId": "00000000-0000-0000-0000-000000000000"},
        headers=auth,
    )
    assert res.status_code == 404
    assert res.json()["errorCode"] == "MESSAGE_BLOCK_NOT_FOUND"


def test_create_side_chat_denied_for_other_users_chat(client, auth, chat, monkeypatch):
    other_token = _login(client, monkeypatch, USER_B)
    res = client.post(
        f"/api/chats/{chat['chatMeta']['chatId']}/branches/{chat['branchMeta']['branchId']}/side-chats",
        json={},
        headers={"Authorization": f"Bearer {other_token}"},
    )
    assert res.status_code == 403


def test_child_of_side_chat_inherits_root_from_grandparent_not_immediate_parent(client, auth, chat, db_session):
    block = _add_block(db_session, chat["chatMeta"]["chatId"], chat["branchMeta"]["branchId"], 0, "질문")
    side_a = _create_side_chat(client, auth, chat, anchor_id=str(block.id))

    # A 자신의 대화 흐름에 블록을 하나 쌓는다 — B는 이걸 참고하면 안 된다.
    _add_block(db_session, side_a["chatMeta"]["chatId"], side_a["branchMeta"]["branchId"], 0, "A 안에서의 질문")

    side_b = _create_side_chat(client, auth, side_a)

    meta = side_b["chatMeta"]
    assert meta["parentChatId"] == side_a["chatMeta"]["chatId"]  # 구조적 부모는 A
    assert meta["rootChatId"] == chat["chatMeta"]["chatId"]  # 공통 컨텍스트는 루트 메인
    assert meta["rootBranchId"] == chat["branchMeta"]["branchId"]


# ── A2: 부모·자식·형제 조회 ──────────────────────────────────────────────────


def test_list_side_chats_returns_direct_children_only(client, auth, chat, db_session):
    block = _add_block(db_session, chat["chatMeta"]["chatId"], chat["branchMeta"]["branchId"], 0, "질문")
    child_a = _create_side_chat(client, auth, chat, anchor_id=str(block.id), title="A")
    child_c = _create_side_chat(client, auth, chat, anchor_id=str(block.id), title="C")
    _create_side_chat(client, auth, child_a, title="A의 자식")  # 손자는 포함되면 안 된다

    res = client.get(f"/api/chats/{chat['chatMeta']['chatId']}/side-chats", headers=auth)
    assert res.status_code == 200
    ids = {item["chatId"] for item in res.json()}
    assert ids == {child_a["chatMeta"]["chatId"], child_c["chatMeta"]["chatId"]}


def test_side_chat_tree_includes_root_and_all_descendants(client, auth, chat):
    child_a = _create_side_chat(client, auth, chat, title="A")
    grandchild_b = _create_side_chat(client, auth, child_a, title="B")
    child_c = _create_side_chat(client, auth, chat, title="C")

    res = client.get(f"/api/chats/{chat['chatMeta']['chatId']}/side-chat-tree", headers=auth)
    assert res.status_code == 200
    body = res.json()
    assert body["rootChatId"] == chat["chatMeta"]["chatId"]
    ids = {item["chatId"] for item in body["chats"]}
    assert ids == {
        chat["chatMeta"]["chatId"], child_a["chatMeta"]["chatId"],
        grandchild_b["chatMeta"]["chatId"], child_c["chatMeta"]["chatId"],
    }
    by_id = {item["chatId"]: item for item in body["chats"]}
    assert by_id[grandchild_b["chatMeta"]["chatId"]]["parentChatId"] == child_a["chatMeta"]["chatId"]

    # 사이드 채팅 자신을 기준으로 물어도 같은 루트·같은 트리를 돌려준다
    res2 = client.get(
        f"/api/chats/{grandchild_b['chatMeta']['chatId']}/side-chat-tree", headers=auth,
    )
    assert {item["chatId"] for item in res2.json()["chats"]} == ids


# ── 최근 대화 목록과의 분리 ───────────────────────────────────────────────────


def test_recent_chat_list_excludes_side_chats(client, auth, chat):
    _create_side_chat(client, auth, chat)

    res = client.get("/api/chats", headers=auth)
    ids = [item["chatId"] for item in res.json()["chats"]]
    assert ids == [chat["chatMeta"]["chatId"]]


# ── A3: 삭제 ────────────────────────────────────────────────────────────────


def test_deleting_parent_chat_orphans_side_chat_without_deleting_it(client, auth, chat):
    side = _create_side_chat(client, auth, chat)

    res = client.delete(f"/api/chats/{chat['chatMeta']['chatId']}", headers=auth)
    assert res.status_code == 200

    detail = client.get(f"/api/chats/{side['chatMeta']['chatId']}", headers=auth)
    assert detail.status_code == 200
    meta = detail.json()["chatMeta"]
    assert meta["kind"] == "SIDE"
    assert meta["parentChatId"] is None
    assert meta["rootChatId"] is None


# ── A4: 부모 메인 채팅의 최신 흐름 자동 참고 ──────────────────────────────────


def _stream_of(text: str):
    yield AnswerChunk(type="done", result=AnswerResult(text=text, search_sources=[]))


@pytest.fixture
def ai_auth(client, monkeypatch) -> dict:
    monkeypatch.setattr(auth_router, "verify_google_id_token", lambda _t: USER_A)
    res = client.post("/api/auth/google", json={"idToken": "dummy"})
    headers = {"Authorization": f"Bearer {res.json()['accessToken']}"}
    saved = client.put(
        "/api/settings/api-keys/openai",
        json={"apiKey": "test-api-key-1234567890"},
        headers=headers,
    )
    assert saved.status_code == 200, saved.text
    return headers


@pytest.fixture
def captured(monkeypatch) -> list:
    calls = []
    import modeling

    def _answer_stream(request, **_kwargs):
        calls.append(request)
        yield from _stream_of(f"답변({len(calls)})")

    monkeypatch.setattr(modeling, "generate_answer_stream", _answer_stream)
    monkeypatch.setattr(modeling, "generate_title", lambda p, **_kwargs: f"제목: {p[:10]}")
    return calls


def _send(client, headers, chat: dict, prompt: str) -> dict:
    res = client.post(
        f"/api/chats/{chat['chatMeta']['chatId']}/branches/{chat['branchMeta']['branchId']}/messages",
        json={"userPrompt": prompt, "contextBlockIds": []},
        headers=headers,
    )
    assert res.status_code == 201, res.text
    return res.json()


def test_side_chat_message_includes_root_chat_flow(client, ai_auth, captured):
    main = client.post("/api/chats", headers=ai_auth).json()
    _send(client, ai_auth, main, "메인 질문")

    side = _create_side_chat(client, ai_auth, main)
    _send(client, ai_auth, side, "사이드 질문")

    side_request = captured[-1]
    assert [t.content for t in side_request.message_flow] == ["메인 질문", "답변(1)"]
    assert side_request.user_prompt == "사이드 질문"


def test_side_chat_message_flow_reflects_new_parent_messages(client, ai_auth, captured):
    main = client.post("/api/chats", headers=ai_auth).json()
    _send(client, ai_auth, main, "메인 질문 1")

    side = _create_side_chat(client, ai_auth, main)

    # 사이드 채팅을 만든 뒤에도 부모에 새 메시지가 쌓인다
    _send(client, ai_auth, main, "메인 질문 2")

    _send(client, ai_auth, side, "사이드 질문")

    side_request = captured[-1]
    assert [t.content for t in side_request.message_flow] == [
        "메인 질문 1", "답변(1)", "메인 질문 2", "답변(2)",
    ]


def test_grandchild_side_chat_ignores_intermediate_parent_flow(client, ai_auth, captured):
    main = client.post("/api/chats", headers=ai_auth).json()
    _send(client, ai_auth, main, "메인 질문")

    side_a = _create_side_chat(client, ai_auth, main)
    _send(client, ai_auth, side_a, "A 안에서의 질문")  # B가 이 내용을 참고하면 안 된다

    side_b = _create_side_chat(client, ai_auth, side_a)
    _send(client, ai_auth, side_b, "B 질문")

    side_b_request = captured[-1]
    assert [t.content for t in side_b_request.message_flow] == ["메인 질문", "답변(1)"]


def test_main_chat_message_flow_has_no_parent_prefix(client, ai_auth, captured):
    main = client.post("/api/chats", headers=ai_auth).json()
    _send(client, ai_auth, main, "첫 질문")
    _send(client, ai_auth, main, "둘째 질문")

    second_request = captured[-1]
    assert [t.content for t in second_request.message_flow] == ["첫 질문", "답변(1)"]
