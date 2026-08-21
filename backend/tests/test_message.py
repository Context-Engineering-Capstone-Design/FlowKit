"""메시지 블록 테스트 (2.4 메시지 블록 관리)."""

from __future__ import annotations

import pytest

from app.routers import auth as auth_router
from app.services.google_auth import GoogleUser

USER = GoogleUser("sub-msg", "msg@example.com", "메시지테스터", None)


@pytest.fixture
def auth(client, monkeypatch) -> dict:
    monkeypatch.setattr(auth_router, "verify_google_id_token", lambda _t: USER)
    res = client.post("/api/auth/google", json={"idToken": "dummy"})
    return {"Authorization": f"Bearer {res.json()['accessToken']}"}


@pytest.fixture
def chat(client, auth) -> dict:
    return client.post("/api/chats", headers=auth).json()


def blocks_url(chat_id: str, branch_id: str) -> str:
    return f"/api/chats/{chat_id}/branches/{branch_id}/blocks"


def add_block(client, auth, chat, role: str, content: str) -> dict:
    res = client.post(
        blocks_url(chat["chatMeta"]["chatId"], chat["branchMeta"]["branchId"]),
        json={"role": role, "content": content},
        headers=auth,
    )
    assert res.status_code == 201, res.text
    return res.json()


# ── 생성 ───────────────────────────────────────────────────────


def test_create_block_starts_at_version_one(client, auth, chat):
    block = add_block(client, auth, chat, "user", "첫 질문")

    assert block["content"] == "첫 질문"
    assert block["orderIndex"] == 0
    assert block["versionNo"] == 1
    assert block["currentVersionId"]
    assert block["actionMeta"] == {
        "actionType": "message_block_create",
        "successCode": "MESSAGE_BLOCK_CREATED",
        "message": "메시지를 추가했습니다.",
        "affectedResourceId": block["blockId"],
    }


def test_order_index_increases(client, auth, chat):
    first = add_block(client, auth, chat, "user", "질문")
    second = add_block(client, auth, chat, "assistant", "답변")

    assert (first["orderIndex"], second["orderIndex"]) == (0, 1)


def test_create_block_rejects_empty_content(client, auth, chat):
    res = client.post(
        blocks_url(chat["chatMeta"]["chatId"], chat["branchMeta"]["branchId"]),
        json={"role": "user", "content": "   "},
        headers=auth,
    )
    assert res.status_code == 400
    assert res.json()["errorCode"] == "VALIDATION_ERROR"


def test_created_block_appears_in_chat_detail(client, auth, chat):
    add_block(client, auth, chat, "user", "질문")
    res = client.get(f"/api/chats/{chat['chatMeta']['chatId']}", headers=auth)
    assert [b["content"] for b in res.json()["messageBlocks"]] == ["질문"]


# ── , 005, 006: 수정과 버전 ──────────────────────────────────────


def test_edit_adds_version_and_keeps_original(client, auth, chat):
    """수정해도 이전 내용은 이력에 남아야 한다 ."""
    block = add_block(client, auth, chat, "user", "원본 내용")
    url = blocks_url(chat["chatMeta"]["chatId"], chat["branchMeta"]["branchId"])

    edited = client.patch(
        f"{url}/{block['blockId']}",
        json={"editedContent": "수정한 내용"},
        headers=auth,
    ).json()

    assert edited["content"] == "수정한 내용"
    assert edited["versionNo"] == 2
    assert edited["currentVersionId"] != block["currentVersionId"]
    assert edited["actionMeta"]["successCode"] == "MESSAGE_BLOCK_UPDATED"

    versions = client.get(f"{url}/{block['blockId']}/versions", headers=auth).json()
    assert [v["content"] for v in versions] == ["원본 내용", "수정한 내용"]
    assert [v["isCurrent"] for v in versions] == [False, True]


def test_edit_saves_context_ranges_per_version(client, auth, chat):
    source = add_block(client, auth, chat, "assistant", "인용할 원문입니다")
    target = add_block(client, auth, chat, "user", "원래 질문")
    url = blocks_url(chat["chatMeta"]["chatId"], chat["branchMeta"]["branchId"])

    edited = client.patch(
        f"{url}/{target['blockId']}",
        json={
            "editedContent": "태그를 붙인 질문",
            "contextRanges": [{
                "blockId": source["blockId"],
                "versionId": source["currentVersionId"],
                "snippetText": "인용할 원문",
            }],
        },
        headers=auth,
    ).json()

    assert edited["appliedContext"] == [{
        "blockId": source["blockId"],
        "versionId": source["currentVersionId"],
        "orderIndex": source["orderIndex"],
        "content": "인용할 원문",
        "startOffset": 0,
        "endOffset": 6,
    }]

    latest = client.patch(
        f"{url}/{target['blockId']}",
        json={"editedContent": "태그를 지운 질문", "contextRanges": []},
        headers=auth,
    ).json()
    assert latest["appliedContext"] == []

    restored = client.patch(
        f"{url}/{target['blockId']}/version",
        json={"targetVersionId": edited["currentVersionId"]},
        headers=auth,
    ).json()
    assert restored["appliedContext"] == edited["appliedContext"]


def test_edit_rejects_forged_context_range(client, auth, chat):
    source = add_block(client, auth, chat, "assistant", "실제 원문")
    target = add_block(client, auth, chat, "user", "원래 질문")
    url = blocks_url(chat["chatMeta"]["chatId"], chat["branchMeta"]["branchId"])

    res = client.patch(
        f"{url}/{target['blockId']}",
        json={
            "editedContent": "수정 질문",
            "contextRanges": [{
                "blockId": source["blockId"],
                "versionId": source["currentVersionId"],
                "snippetText": "위조된 문구",
            }],
        },
        headers=auth,
    )

    assert res.status_code == 400


def test_rollback_to_previous_version(client, auth, chat):
    """되돌리기는 이력을 지우지 않고 활성 버전만 옮긴다 ."""
    block = add_block(client, auth, chat, "assistant", "원본 내용")
    url = blocks_url(chat["chatMeta"]["chatId"], chat["branchMeta"]["branchId"])
    original_version = block["currentVersionId"]

    client.patch(
        f"{url}/{block['blockId']}",
        json={"editedContent": "수정본"},
        headers=auth,
    )

    restored = client.patch(
        f"{url}/{block['blockId']}/version",
        json={"targetVersionId": original_version},
        headers=auth,
    ).json()

    assert restored["content"] == "원본 내용"
    assert restored["actionMeta"]["successCode"] == "MESSAGE_VERSION_ACTIVATED"
    versions = client.get(f"{url}/{block['blockId']}/versions", headers=auth).json()
    assert len(versions) == 2


def test_edit_reflected_in_chat_detail(client, auth, chat):
    block = add_block(client, auth, chat, "user", "원본")
    url = blocks_url(chat["chatMeta"]["chatId"], chat["branchMeta"]["branchId"])
    client.patch(
        f"{url}/{block['blockId']}", json={"editedContent": "수정"}, headers=auth
    )

    res = client.get(f"/api/chats/{chat['chatMeta']['chatId']}", headers=auth)
    assert res.json()["messageBlocks"][0]["content"] == "수정"


def test_edit_rejects_empty_content(client, auth, chat):
    block = add_block(client, auth, chat, "user", "원본")
    url = blocks_url(chat["chatMeta"]["chatId"], chat["branchMeta"]["branchId"])
    res = client.patch(
        f"{url}/{block['blockId']}", json={"editedContent": " "}, headers=auth
    )
    assert res.status_code == 400


def test_version_from_other_block_is_rejected(client, auth, chat):
    a = add_block(client, auth, chat, "user", "A")
    b = add_block(client, auth, chat, "user", "B")
    url = blocks_url(chat["chatMeta"]["chatId"], chat["branchMeta"]["branchId"])

    res = client.patch(
        f"{url}/{a['blockId']}/version",
        json={"targetVersionId": b["currentVersionId"]},
        headers=auth,
    )
    assert res.status_code == 404
    assert res.json()["errorCode"] == "MESSAGE_BLOCK_NOT_FOUND"


# ── 선택 검증 ─────────────────────────────────────────────────


def test_validate_selection_splits_valid_and_invalid(client, auth, chat):
    block = add_block(client, auth, chat, "user", "질문")
    url = blocks_url(chat["chatMeta"]["chatId"], chat["branchMeta"]["branchId"])
    unknown = "00000000-0000-0000-0000-000000000000"

    res = client.post(
        f"{url}/validate",
        json={"selectedBlockIds": [block["blockId"], unknown]},
        headers=auth,
    ).json()

    assert res["validBlockIds"] == [block["blockId"]]
    assert res["invalidBlockIds"] == [unknown]
    assert res["selectedCount"] == 1


# ── 참조형 브랜치와의 관계 ────────────────────────────────────────────────


@pytest.fixture
def branched(client, auth, chat):
    """Main 에 블록 3개를 만들고, 두 번째 블록에서 갈라진 브랜치를 만든다."""
    blocks = [
        add_block(client, auth, chat, "user" if i % 2 == 0 else "assistant", f"메인{i}")
        for i in range(3)
    ]
    child = client.post(
        f"/api/chats/{chat['chatMeta']['chatId']}/branches",
        json={
            "branchName": "하위",
            "baseBranchId": chat["branchMeta"]["branchId"],
            "baseMessageBlockId": blocks[1]["blockId"],
            "contextBlockIds": [],
        },
        headers=auth,
    ).json()
    return chat, blocks, child


def test_new_block_continues_numbering_after_inherited(client, auth, branched):
    """상속받은 블록과 순번이 겹치면 화면 순서가 뒤엉킨다."""
    chat, blocks, child = branched

    created = client.post(
        blocks_url(chat["chatMeta"]["chatId"], child["branchId"]),
        json={"role": "user", "content": "브랜치 질문"},
        headers=auth,
    ).json()

    assert created["orderIndex"] == 2

    res = client.get(
        f"/api/chats/{chat['chatMeta']['chatId']}/branches/{child['branchId']}",
        headers=auth,
    )
    assert [b["content"] for b in res.json()["messageBlocks"]] == [
        "메인0",
        "메인1",
        "브랜치 질문",
    ]


def test_inherited_block_cannot_be_edited_from_child_branch(client, auth, branched):
    """상속 블록을 고치면 원본 대화까지 바뀌므로 막는다 ."""
    chat, blocks, child = branched

    res = client.patch(
        f"{blocks_url(chat['chatMeta']['chatId'], child['branchId'])}/{blocks[0]['blockId']}",
        json={"editedContent": "몰래 수정"},
        headers=auth,
    )
    assert res.status_code == 400
    assert res.json()["errorCode"] == "VALIDATION_ERROR"

    detail = client.get(f"/api/chats/{chat['chatMeta']['chatId']}", headers=auth)
    assert detail.json()["messageBlocks"][0]["content"] == "메인0"


def test_inherited_block_versions_are_readable(client, auth, branched):
    """수정은 막되 이력 확인은 되어야 한다."""
    chat, blocks, child = branched

    res = client.get(
        f"{blocks_url(chat['chatMeta']['chatId'], child['branchId'])}/{blocks[0]['blockId']}/versions",
        headers=auth,
    )
    assert res.status_code == 200
    assert res.json()[0]["content"] == "메인0"


def test_block_outside_branch_flow_is_not_found(client, auth, branched):
    """분기점 이후 블록은 하위 브랜치에서 보이지 않는다."""
    chat, blocks, child = branched

    res = client.get(
        f"{blocks_url(chat['chatMeta']['chatId'], child['branchId'])}/{blocks[2]['blockId']}/versions",
        headers=auth,
    )
    assert res.status_code == 404
    assert res.json()["errorCode"] == "MESSAGE_BLOCK_NOT_FOUND"


# ── 활성 메시지 흐름 ──────────────────────────────────────────


def test_active_flow_uses_current_version(client, auth, chat, db_session):
    """AI 입력은 화면 값이 아니라 서버의 현재 활성 버전을 기준으로 만든다."""
    import uuid as _uuid

    from app.models import Branch
    from app.services import message_service

    block = add_block(client, auth, chat, "user", "원본")
    url = blocks_url(chat["chatMeta"]["chatId"], chat["branchMeta"]["branchId"])
    client.patch(
        f"{url}/{block['blockId']}", json={"editedContent": "수정본"}, headers=auth
    )

    branch = db_session.get(Branch, _uuid.UUID(chat["branchMeta"]["branchId"]))
    flow = message_service.active_message_flow(db_session, branch)

    assert [t.content for t in flow] == ["수정본"]
    assert flow[0].role.value == "user"


# ── 권한 ──────────────────────────────────────────────────────────────────


def test_other_user_cannot_create_block(client, auth, chat, monkeypatch):
    other = GoogleUser("sub-other", "other@example.com", "다른사람", None)
    monkeypatch.setattr(auth_router, "verify_google_id_token", lambda _t: other)
    token = client.post("/api/auth/google", json={"idToken": "x"}).json()["accessToken"]

    res = client.post(
        blocks_url(chat["chatMeta"]["chatId"], chat["branchMeta"]["branchId"]),
        json={"role": "user", "content": "침입"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 403
    assert res.json()["errorCode"] == "CHAT_ACCESS_DENIED"
