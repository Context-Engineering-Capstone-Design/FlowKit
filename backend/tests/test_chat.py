"""채팅·브랜치 테스트 (2.2 채팅 관리, 2.3 브랜치 관리)."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models import (
    Chat,
    MessageBlock,
    MessageBlockVersion,
    MessageRole,
    User,
    VersionSourceType,
)
from app.routers import auth as auth_router
from app.services.google_auth import GoogleUser

USER_A = GoogleUser("sub-a", "a@example.com", "사용자A", None)
USER_B = GoogleUser("sub-b", "b@example.com", "사용자B", None)


def _login(client, monkeypatch, google_user: GoogleUser) -> str:
    monkeypatch.setattr(
        auth_router, "verify_google_id_token", lambda _t: google_user
    )
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
    """메시지 생성 API는 아직 없으므로 DB에 직접 넣는다."""
    block = MessageBlock(
        chat_id=chat_id, branch_id=branch_id, role=role, order_index=order
    )
    db.add(block)
    db.flush()
    version = MessageBlockVersion(
        block_id=block.id, version_no=1, content=text,
        source_type=VersionSourceType.ORIGINAL,
    )
    db.add(version)
    db.flush()
    block.current_version_id = version.id
    db.commit()
    return block


# ── BE-CHAT-001, 002: 생성 ─────────────────────────────────────────────────


def test_create_chat_returns_initial_state(chat):
    assert chat["chatMeta"]["title"] == "새 대화"
    assert chat["branchMeta"]["branchName"] == "Main"
    assert chat["branchMeta"]["branchType"] == "MAIN"
    assert chat["messageBlocks"] == []
    assert len(chat["branchList"]) == 1
    assert chat["branchList"][0]["isActive"] is True


def test_create_chat_requires_auth(client):
    assert client.post("/api/chats").status_code == 401


# ── BE-CHAT-003, 006: 목록·검색 ────────────────────────────────────────────


def test_list_chats_excludes_internal_sort_field(client, auth, chat):
    res = client.get("/api/chats", headers=auth)
    assert res.status_code == 200
    item = res.json()["chats"][0]
    assert set(item) == {"chatId", "title"}


def test_list_chats_is_scoped_to_owner(client, auth, chat, monkeypatch):
    other = _login(client, monkeypatch, USER_B)
    res = client.get("/api/chats", headers={"Authorization": f"Bearer {other}"})
    assert res.json()["chats"] == []


def test_search_filters_by_title(client, auth, db_session):
    for title in ("파이프라이닝 개요", "캐싱 전략"):
        created = client.post("/api/chats", headers=auth).json()
        client.patch(
            f"/api/chats/{created['chatMeta']['chatId']}/title",
            json={"generatedTitle": title},
            headers=auth,
        )

    res = client.get("/api/chats", params={"keyword": "파이프"}, headers=auth)
    titles = [c["title"] for c in res.json()["chats"]]
    assert titles == ["파이프라이닝 개요"]


def test_pagination_walks_all_chats_without_duplicates(client, auth):
    for _ in range(5):
        client.post("/api/chats", headers=auth)

    seen, cursor = [], None
    while True:
        params = {"limit": 2}
        if cursor:
            params["cursor"] = cursor
        body = client.get("/api/chats", params=params, headers=auth).json()
        seen.extend(c["chatId"] for c in body["chats"])
        cursor = body["nextCursor"]
        if not cursor:
            break

    assert len(seen) == 5
    assert len(set(seen)) == 5


def test_invalid_cursor_is_rejected(client, auth):
    res = client.get("/api/chats", params={"cursor": "!!!"}, headers=auth)
    assert res.status_code == 400
    assert res.json()["errorCode"] == "VALIDATION_ERROR"


# ── BE-CHAT-004: 제목 ──────────────────────────────────────────────────────


def test_update_title(client, auth, chat):
    chat_id = chat["chatMeta"]["chatId"]
    res = client.patch(
        f"/api/chats/{chat_id}/title",
        json={"generatedTitle": "  파이프라이닝 정리  "},
        headers=auth,
    )
    assert res.status_code == 200
    assert res.json()["title"] == "파이프라이닝 정리"


@pytest.mark.parametrize("bad", ["", "   ", "줄바꿈\n포함", "x" * 201])
def test_update_title_rejects_bad_values(client, auth, chat, bad):
    chat_id = chat["chatMeta"]["chatId"]
    res = client.patch(
        f"/api/chats/{chat_id}/title", json={"generatedTitle": bad}, headers=auth
    )
    assert res.status_code == 400
    assert res.json()["errorCode"] == "VALIDATION_ERROR"


# ── BE-CHAT-005, 008: 상세·권한 ────────────────────────────────────────────


def test_get_chat_detail(client, auth, chat):
    chat_id = chat["chatMeta"]["chatId"]
    res = client.get(f"/api/chats/{chat_id}", headers=auth)
    assert res.status_code == 200
    assert res.json()["branchMeta"]["branchName"] == "Main"


def test_other_user_cannot_read_chat(client, auth, chat, monkeypatch):
    chat_id = chat["chatMeta"]["chatId"]
    other = _login(client, monkeypatch, USER_B)
    res = client.get(f"/api/chats/{chat_id}", headers={"Authorization": f"Bearer {other}"})
    assert res.status_code == 403
    assert res.json()["errorCode"] == "CHAT_ACCESS_DENIED"


def test_unknown_chat_returns_not_found(client, auth):
    res = client.get(
        "/api/chats/00000000-0000-0000-0000-000000000000", headers=auth
    )
    assert res.status_code == 404
    assert res.json()["errorCode"] == "CHAT_NOT_FOUND"


# ── BE-BRANCH-003, 004: 브랜치 생성 ────────────────────────────────────────


@pytest.fixture
def chat_with_blocks(client, auth, chat, db_session):
    """Main 에 블록 5개(order 0~4)를 넣은 채팅."""
    chat_id = chat["chatMeta"]["chatId"]
    branch_id = chat["branchMeta"]["branchId"]
    import uuid as _uuid

    blocks = [
        _add_block(
            db_session,
            _uuid.UUID(chat_id),
            _uuid.UUID(branch_id),
            i,
            f"메인 블록 {i}",
            MessageRole.USER if i % 2 == 0 else MessageRole.ASSISTANT,
        )
        for i in range(5)
    ]
    return chat, blocks


def test_create_branch_does_not_copy_messages(client, auth, chat_with_blocks, db_session):
    chat, blocks = chat_with_blocks
    chat_id = chat["chatMeta"]["chatId"]

    res = client.post(
        f"/api/chats/{chat_id}/branches",
        json={
            "branchName": "구조적 해저드 중심",
            "baseBranchId": chat["branchMeta"]["branchId"],
            "baseMessageBlockId": str(blocks[2].id),
            "contextBlockIds": [str(blocks[1].id), str(blocks[2].id)],
        },
        headers=auth,
    )
    assert res.status_code == 201, res.text
    new_branch_id = res.json()["branchId"]

    # 새 브랜치에는 자기 블록이 하나도 없어야 한다 (참조형)
    import uuid as _uuid

    own = db_session.scalars(
        select(MessageBlock).where(MessageBlock.branch_id == _uuid.UUID(new_branch_id))
    ).all()
    assert own == []


def test_branch_inherits_only_up_to_branch_point(client, auth, chat_with_blocks):
    chat, blocks = chat_with_blocks
    chat_id = chat["chatMeta"]["chatId"]

    created = client.post(
        f"/api/chats/{chat_id}/branches",
        json={
            "branchName": "분기",
            "baseBranchId": chat["branchMeta"]["branchId"],
            "baseMessageBlockId": str(blocks[2].id),
            "contextBlockIds": [],
        },
        headers=auth,
    ).json()

    res = client.get(
        f"/api/chats/{chat_id}/branches/{created['branchId']}", headers=auth
    )
    contents = [b["content"] for b in res.json()["messageBlocks"]]
    assert contents == ["메인 블록 0", "메인 블록 1", "메인 블록 2"]


def test_original_branch_is_untouched(client, auth, chat_with_blocks):
    """브랜치를 만들어도 원본 대화는 그대로여야 한다 (NFR-007)."""
    chat, blocks = chat_with_blocks
    chat_id = chat["chatMeta"]["chatId"]

    client.post(
        f"/api/chats/{chat_id}/branches",
        json={
            "branchName": "분기",
            "baseBranchId": chat["branchMeta"]["branchId"],
            "baseMessageBlockId": str(blocks[1].id),
            "contextBlockIds": [],
        },
        headers=auth,
    )

    res = client.get(f"/api/chats/{chat_id}", headers=auth)
    assert len(res.json()["messageBlocks"]) == 5


def test_nested_branch_resolves_through_ancestors(
    client, auth, chat_with_blocks, db_session
):
    """손자 브랜치는 부모의 흐름(조부모 상속분 포함)을 이어받아야 한다."""
    chat, blocks = chat_with_blocks
    chat_id = chat["chatMeta"]["chatId"]
    import uuid as _uuid

    a = client.post(
        f"/api/chats/{chat_id}/branches",
        json={
            "branchName": "A",
            "baseBranchId": chat["branchMeta"]["branchId"],
            "baseMessageBlockId": str(blocks[2].id),
            "contextBlockIds": [],
        },
        headers=auth,
    ).json()

    a_block = _add_block(
        db_session, _uuid.UUID(chat_id), _uuid.UUID(a["branchId"]), 3, "A 블록 3"
    )

    b = client.post(
        f"/api/chats/{chat_id}/branches",
        json={
            "branchName": "B",
            "baseBranchId": a["branchId"],
            "baseMessageBlockId": str(a_block.id),
            "contextBlockIds": [],
        },
        headers=auth,
    ).json()

    res = client.get(f"/api/chats/{chat_id}/branches/{b['branchId']}", headers=auth)
    contents = [x["content"] for x in res.json()["messageBlocks"]]
    assert contents == ["메인 블록 0", "메인 블록 1", "메인 블록 2", "A 블록 3"]


def test_create_branch_rejects_duplicate_name(client, auth, chat_with_blocks):
    chat, blocks = chat_with_blocks
    chat_id = chat["chatMeta"]["chatId"]
    payload = {
        "branchName": "중복",
        "baseBranchId": chat["branchMeta"]["branchId"],
        "baseMessageBlockId": str(blocks[0].id),
        "contextBlockIds": [],
    }
    assert client.post(f"/api/chats/{chat_id}/branches", json=payload, headers=auth).status_code == 201
    res = client.post(f"/api/chats/{chat_id}/branches", json=payload, headers=auth)
    assert res.status_code == 400
    assert res.json()["errorCode"] == "VALIDATION_ERROR"


def test_create_branch_rejects_block_from_other_chat(client, auth, chat_with_blocks):
    chat, blocks = chat_with_blocks
    other_chat = client.post("/api/chats", headers=auth).json()

    res = client.post(
        f"/api/chats/{other_chat['chatMeta']['chatId']}/branches",
        json={
            "branchName": "잘못된 분기",
            "baseBranchId": other_chat["branchMeta"]["branchId"],
            "baseMessageBlockId": str(blocks[0].id),
            "contextBlockIds": [],
        },
        headers=auth,
    )
    assert res.status_code == 404
    assert res.json()["errorCode"] == "MESSAGE_BLOCK_NOT_FOUND"


# ── BE-BRANCH-001, 002: 목록·전환 ─────────────────────────────────────────


def test_branch_list_puts_main_first(client, auth, chat_with_blocks):
    chat, blocks = chat_with_blocks
    chat_id = chat["chatMeta"]["chatId"]
    client.post(
        f"/api/chats/{chat_id}/branches",
        json={
            "branchName": "하위",
            "baseBranchId": chat["branchMeta"]["branchId"],
            "baseMessageBlockId": str(blocks[0].id),
            "contextBlockIds": [],
        },
        headers=auth,
    )

    res = client.get(f"/api/chats/{chat_id}/branches", headers=auth)
    names = [b["branchName"] for b in res.json()]
    assert names[0] == "Main"
    assert "하위" in names


def test_source_context_info_points_back_to_original(client, auth, chat_with_blocks):
    """Context pill 을 누르면 원본 위치로 갈 수 있어야 한다 (REQ-012)."""
    chat, blocks = chat_with_blocks
    chat_id = chat["chatMeta"]["chatId"]

    created = client.post(
        f"/api/chats/{chat_id}/branches",
        json={
            "branchName": "요약 참조",
            "baseBranchId": chat["branchMeta"]["branchId"],
            "baseMessageBlockId": str(blocks[3].id),
            "contextBlockIds": [str(blocks[1].id), str(blocks[3].id)],
        },
        headers=auth,
    ).json()

    res = client.get(
        f"/api/chats/{chat_id}/branches/{created['branchId']}", headers=auth
    )
    info = res.json()["sourceContextInfo"]
    assert len(info) == 2
    assert info[0]["sourceMessageBlockId"] == str(blocks[1].id)
    assert info[0]["previewText"] == "메인 블록 1"
    assert info[0]["scrollTargetIndex"] == 1
    assert info[1]["scrollTargetIndex"] == 3
    assert info[0]["sourceBranchId"] == chat["branchMeta"]["branchId"]


def test_branch_from_other_chat_is_not_found(client, auth, chat, monkeypatch):
    chat_id = chat["chatMeta"]["chatId"]
    other = client.post("/api/chats", headers=auth).json()
    res = client.get(
        f"/api/chats/{chat_id}/branches/{other['branchMeta']['branchId']}",
        headers=auth,
    )
    assert res.status_code == 404
    assert res.json()["errorCode"] == "BRANCH_NOT_FOUND"
