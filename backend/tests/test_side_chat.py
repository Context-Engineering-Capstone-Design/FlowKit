"""사이드 채팅 트리 테스트 (0820_08 마일스톤 A)."""

from __future__ import annotations

import uuid

import pytest

from app.models import Branch, Chat, MessageBlock, MessageBlockVersion, MessageRole, User, VersionSourceType
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
    assert [item["content"] for item in side["messageBlocks"]] == ["질문"]
    assert side["actionMeta"]["successCode"] == "SIDE_CHAT_CREATED"


def test_create_side_chat_without_anchor_uses_latest_message(client, auth, chat, db_session):
    chat_id, branch_id = chat["chatMeta"]["chatId"], chat["branchMeta"]["branchId"]
    _add_block(db_session, chat_id, branch_id, 0, "첫 질문")
    latest = _add_block(db_session, chat_id, branch_id, 1, "둘째 질문")

    side = _create_side_chat(client, auth, chat)

    assert side["chatMeta"]["parentMessageBlockId"] == str(latest.id)


def test_create_conversation_node_makes_sibling_with_frozen_snapshot(client, auth, chat, db_session):
    first = _add_block(db_session, chat["chatMeta"]["chatId"], chat["branchMeta"]["branchId"], 0, "첫 질문")
    side_a = _create_side_chat(client, auth, chat, anchor_id=str(first.id), title="A")
    second = _add_block(db_session, side_a["chatMeta"]["chatId"], side_a["branchMeta"]["branchId"], 1, "A의 질문")
    side_b = _create_side_chat(client, auth, side_a, anchor_id=str(second.id), title="B")
    side_b_detail = client.get(f"/api/chats/{side_b['chatMeta']['chatId']}", headers=auth).json()

    res = client.post(
        f"/api/chats/{side_b['chatMeta']['chatId']}/nodes",
        json={"baseMessageBlockId": side_b_detail["messageBlocks"][-1]["blockId"]},
        headers=auth,
    )
    assert res.status_code == 201, res.text
    node = res.json()
    assert node["chatMeta"]["title"] == "분기 1"
    assert node["chatMeta"]["parentChatId"] == side_a["chatMeta"]["chatId"]
    assert node["chatMeta"]["forkedFromChatId"] == side_b["chatMeta"]["chatId"]
    assert [item["content"] for item in node["messageBlocks"]] == ["첫 질문", "A의 질문"]


def test_legacy_child_branch_migration_preserves_its_identifier_and_snapshot(client, auth, chat, db_session):
    from sqlalchemy import select
    from app.services import branch_service
    from app.services.conversation_node_migration import migrate_legacy_child_branches

    root_block = _add_block(db_session, chat["chatMeta"]["chatId"], chat["branchMeta"]["branchId"], 0, "원본")
    owner = db_session.scalar(select(User).where(User.email == USER_A.email))
    source_chat = db_session.get(Chat, uuid.UUID(chat["chatMeta"]["chatId"]))
    result = branch_service.create_branch(
        db_session, owner, source_chat, "기존 분기", uuid.UUID(chat["branchMeta"]["branchId"]), root_block.id, [],
    )

    assert migrate_legacy_child_branches(db_session) == 1
    moved = db_session.get(Branch, result.branch.id)
    node = db_session.scalar(select(Chat).where(Chat.legacy_branch_id == result.branch.id))
    assert moved.chat_id == node.id
    assert moved.parent_branch_id is None
    assert [item.current_version.content for item in branch_service.resolve_blocks(db_session, moved)] == ["원본"]


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

    # A는 출발 스냅샷(순번 0)을 이미 가졌으므로 뒤에 새 흐름을 쌓는다.
    _add_block(db_session, side_a["chatMeta"]["chatId"], side_a["branchMeta"]["branchId"], 1, "A 안에서의 질문")

    side_b = _create_side_chat(client, auth, side_a)

    meta = side_b["chatMeta"]
    assert meta["parentChatId"] == side_a["chatMeta"]["chatId"]  # 구조적 부모는 A
    assert meta["rootChatId"] == chat["chatMeta"]["chatId"]  # 공통 컨텍스트는 루트 메인
    assert meta["rootBranchId"] == chat["branchMeta"]["branchId"]
    assert meta["isTemporary"] is False


def test_first_child_can_be_temporary_but_is_hidden_from_tree_and_recent_list(client, auth, chat):
    temporary = _create_side_chat(client, auth, chat, title="임시",)
    # 기존 요청 형식은 일반 자식을 유지한다. 명시 opt-in은 API 계약으로 확인한다.
    res = client.post(
        f"/api/chats/{chat['chatMeta']['chatId']}/branches/{chat['branchMeta']['branchId']}/side-chats",
        json={"isTemporary": True, "title": "Temporary"}, headers=auth,
    )
    assert res.status_code == 201, res.text
    temp_id = res.json()["chatMeta"]["chatId"]
    assert res.json()["chatMeta"]["isTemporary"] is True

    tree = client.get(f"/api/chats/{chat['chatMeta']['chatId']}/side-chat-tree", headers=auth).json()
    assert temp_id not in {item["chatId"] for item in tree["chats"]}
    assert temporary["chatMeta"]["chatId"] in {item["chatId"] for item in tree["chats"]}


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
        grandchild_b["chatMeta"]["chatId"],
        child_c["chatMeta"]["chatId"],
    }
    assert grandchild_b["chatMeta"]["isTemporary"] is False

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


def test_deleting_parent_chat_deletes_side_chat_subtree(client, auth, chat):
    side = _create_side_chat(client, auth, chat)

    res = client.delete(f"/api/chats/{chat['chatMeta']['chatId']}", headers=auth)
    assert res.status_code == 200

    detail = client.get(f"/api/chats/{side['chatMeta']['chatId']}", headers=auth)
    assert detail.status_code == 404


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


def test_side_chat_message_flow_keeps_creation_snapshot(client, ai_auth, captured):
    main = client.post("/api/chats", headers=ai_auth).json()
    _send(client, ai_auth, main, "메인 질문 1")

    side = _create_side_chat(client, ai_auth, main)

    # 사이드 채팅을 만든 뒤에도 부모에 새 메시지가 쌓인다
    _send(client, ai_auth, main, "메인 질문 2")

    _send(client, ai_auth, side, "사이드 질문")

    side_request = captured[-1]
    assert [t.content for t in side_request.message_flow] == ["메인 질문 1", "답변(1)"]


def test_grandchild_side_chat_includes_root_and_direct_ancestor_flow(client, ai_auth, captured):
    """0820_10 B1: 손자(항상 Temporary)는 루트 메인과 직계 조상 사이드 채팅의 흐름을 함께 참고한다."""
    main = client.post("/api/chats", headers=ai_auth).json()
    _send(client, ai_auth, main, "메인 질문")

    side_a = _create_side_chat(client, ai_auth, main)
    _send(client, ai_auth, side_a, "A 안에서의 질문")  # B는 이 내용을 참고해야 한다(직계 조상)

    side_b = _create_side_chat(client, ai_auth, side_a)
    _send(client, ai_auth, side_b, "B 질문")

    side_b_request = captured[-1]
    assert [t.content for t in side_b_request.message_flow] == [
        "메인 질문", "답변(1)", "A 안에서의 질문", "답변(2)",
    ]


def test_great_grandchild_side_chat_includes_full_ancestor_chain_not_siblings(client, ai_auth, captured):
    """0820_10 B1, B2: 3단계 깊이에서도 직계 조상 전체를 순서대로 참고하고, 무관한 형제는 섞이지 않는다."""
    main = client.post("/api/chats", headers=ai_auth).json()
    _send(client, ai_auth, main, "메인 질문")

    side_a = _create_side_chat(client, ai_auth, main)
    _send(client, ai_auth, side_a, "A 질문")

    side_sibling = _create_side_chat(client, ai_auth, main)  # 무관한 형제 — 참고되면 안 된다
    _send(client, ai_auth, side_sibling, "형제 질문")

    side_b = _create_side_chat(client, ai_auth, side_a)
    _send(client, ai_auth, side_b, "B 질문")

    side_c = _create_side_chat(client, ai_auth, side_b)
    _send(client, ai_auth, side_c, "C 질문")

    side_c_request = captured[-1]
    assert [t.content for t in side_c_request.message_flow] == [
        "메인 질문", "답변(1)", "A 질문", "답변(2)", "B 질문", "답변(4)",
    ]


def test_main_chat_message_flow_has_no_parent_prefix(client, ai_auth, captured):
    main = client.post("/api/chats", headers=ai_auth).json()
    _send(client, ai_auth, main, "첫 질문")
    _send(client, ai_auth, main, "둘째 질문")

    second_request = captured[-1]
    assert [t.content for t in second_request.message_flow] == ["첫 질문", "답변(1)"]


# ── C1~C4: 사이드 채팅 결과의 선택적 메인 반영 ────────────────────────────────


def _send_with_context(client, headers, chat: dict, prompt: str, context_ids: list[str]) -> dict:
    res = client.post(
        f"/api/chats/{chat['chatMeta']['chatId']}/branches/{chat['branchMeta']['branchId']}/messages",
        json={"userPrompt": prompt, "contextBlockIds": context_ids},
        headers=headers,
    )
    assert res.status_code == 201, res.text
    return res.json()


def test_main_chat_can_use_side_chat_answer_as_context(client, ai_auth, captured):
    """C1: 사이드 답변을 기존 Context 추가 흐름(contextBlockIds)으로 그대로 넘길 수 있다."""
    main = client.post("/api/chats", headers=ai_auth).json()
    _send(client, ai_auth, main, "메인 질문")
    side = _create_side_chat(client, ai_auth, main)
    side_answer = _send(client, ai_auth, side, "사이드 탐색 질문")
    side_answer_block_id = side_answer["assistantBlock"]["blockId"]

    _send_with_context(client, ai_auth, main, "이 내용 참고해서 답해줘", [side_answer_block_id])

    request = captured[-1]
    assert request.applied_context == ["답변(2)"]
    assert request.user_prompt == "이 내용 참고해서 답해줘"


def test_context_from_unrelated_chat_is_rejected(client, ai_auth, captured):
    """C1: 같은 사이드 채팅 트리가 아닌 다른 채팅의 블록은 Context 로 못 쓴다."""
    main = client.post("/api/chats", headers=ai_auth).json()
    other = client.post("/api/chats", headers=ai_auth).json()
    other_sent = _send(client, ai_auth, other, "다른 대화 질문")

    res = client.post(
        f"/api/chats/{main['chatMeta']['chatId']}/branches/{main['branchMeta']['branchId']}/messages",
        json={"userPrompt": "질문", "contextBlockIds": [other_sent["assistantBlock"]["blockId"]]},
        headers=ai_auth,
    )
    assert res.status_code == 400
    assert res.json()["errorCode"] == "VALIDATION_ERROR"


def test_import_side_chat_messages_into_parent(client, ai_auth, captured):
    """C2: 사이드 채팅의 질문·답변을 부모 채팅 메시지로 실제로 복사해 가져온다."""
    main = client.post("/api/chats", headers=ai_auth).json()
    side = _create_side_chat(client, ai_auth, main)
    sent = _send(client, ai_auth, side, "사이드 질문")

    res = client.post(
        f"/api/chats/{main['chatMeta']['chatId']}/branches/{main['branchMeta']['branchId']}/import-blocks",
        json={"blockIds": [sent["userBlock"]["blockId"], sent["assistantBlock"]["blockId"]]},
        headers=ai_auth,
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert [b["role"] for b in body["importedBlocks"]] == ["user", "assistant"]
    assert [b["content"] for b in body["importedBlocks"]] == ["사이드 질문", "답변(1)"]
    assert body["actionMeta"]["successCode"] == "SIDE_CHAT_BLOCKS_IMPORTED"

    detail = client.get(f"/api/chats/{main['chatMeta']['chatId']}", headers=ai_auth)
    contents = [b["content"] for b in detail.json()["messageBlocks"]]
    assert contents == ["사이드 질문", "답변(1)"]

    # 사이드 채팅 자신의 메시지는 그대로 남아 있다 — 복사이지 이동이 아니다
    side_detail = client.get(f"/api/chats/{side['chatMeta']['chatId']}", headers=ai_auth)
    assert [b["content"] for b in side_detail.json()["messageBlocks"]] == ["사이드 질문", "답변(1)"]


def test_import_rejects_blocks_outside_family(client, ai_auth, captured):
    """C2: 같은 사이드 채팅 트리가 아니면 가져오기 대상이 될 수 없다."""
    main = client.post("/api/chats", headers=ai_auth).json()
    other = client.post("/api/chats", headers=ai_auth).json()
    other_sent = _send(client, ai_auth, other, "다른 대화 질문")

    res = client.post(
        f"/api/chats/{main['chatMeta']['chatId']}/branches/{main['branchMeta']['branchId']}/import-blocks",
        json={"blockIds": [other_sent["userBlock"]["blockId"]]},
        headers=ai_auth,
    )
    assert res.status_code == 404
    assert res.json()["errorCode"] == "MESSAGE_BLOCK_NOT_FOUND"


def test_import_rejects_empty_selection(client, ai_auth):
    main = client.post("/api/chats", headers=ai_auth).json()
    res = client.post(
        f"/api/chats/{main['chatMeta']['chatId']}/branches/{main['branchMeta']['branchId']}/import-blocks",
        json={"blockIds": []},
        headers=ai_auth,
    )
    assert res.status_code == 400
    assert res.json()["errorCode"] == "VALIDATION_ERROR"


def test_sibling_branch_from_side_chat_shares_its_fork_point(client, ai_auth, captured):
    """C3: 사이드 채팅 기준 새 브랜치는 그 사이드 채팅과 같은 부모·분기점 아래 형제로 붙는다.

    기존 브랜치 생성 API를 그대로 재사용한다 — 대상만 사이드 채팅의 부모 채팅·
    부모 브랜치·생성 시점(anchor)으로 잡으면 된다.
    """
    main = client.post("/api/chats", headers=ai_auth).json()
    sent = _send(client, ai_auth, main, "메인 질문")
    side = _create_side_chat(client, ai_auth, main, anchor_id=sent["assistantBlock"]["blockId"])

    res = client.post(
        f"/api/chats/{main['chatMeta']['chatId']}/branches",
        json={
            "branchName": "탐색 결과 반영",
            "baseBranchId": side["chatMeta"]["parentBranchId"],
            "baseMessageBlockId": side["chatMeta"]["parentMessageBlockId"],
            "contextBlockIds": [],
            "editedBaseContent": "사이드 채팅에서 가져온 더 나은 답변",
        },
        headers=ai_auth,
    )
    assert res.status_code == 201, res.text
    branch = res.json()
    assert branch["parentBranchId"] == side["chatMeta"]["parentBranchId"]

    detail = client.get(
        f"/api/chats/{main['chatMeta']['chatId']}/branches/{branch['branchId']}", headers=ai_auth,
    )
    contents = [b["content"] for b in detail.json()["messageBlocks"]]
    assert contents == ["메인 질문", "사이드 채팅에서 가져온 더 나은 답변"]


def test_side_chat_activity_never_changes_parent_until_explicit_action(client, ai_auth, captured):
    """C4: 사이드 채팅을 만들고 메시지를 보내는 동안, 명시적으로 반영하기 전엔 부모가 그대로다."""
    main = client.post("/api/chats", headers=ai_auth).json()
    _send(client, ai_auth, main, "메인 질문")
    before = client.get(f"/api/chats/{main['chatMeta']['chatId']}", headers=ai_auth).json()

    side = _create_side_chat(client, ai_auth, main)
    _send(client, ai_auth, side, "사이드 질문")

    after = client.get(f"/api/chats/{main['chatMeta']['chatId']}", headers=ai_auth).json()
    assert after["messageBlocks"] == before["messageBlocks"]
    assert after["branchList"] == before["branchList"]
