"""메시지 전송·답변 테스트 (2.7 Context 적용, 2.8 AI 응답 관리)."""

from __future__ import annotations

import pytest

from app.routers import auth as auth_router
from app.services.google_auth import GoogleUser

USER = GoogleUser("sub-conv", "conv@example.com", "대화테스터", None)


@pytest.fixture
def auth(client, monkeypatch) -> dict:
    monkeypatch.setattr(auth_router, "verify_google_id_token", lambda _t: USER)
    res = client.post("/api/auth/google", json={"idToken": "dummy"})
    headers = {"Authorization": f"Bearer {res.json()['accessToken']}"}
    saved = client.put(
        "/api/settings/api-keys/google",
        json={"apiKey": "test-api-key-1234567890"},
        headers=headers,
    )
    assert saved.status_code == 200, saved.text
    return headers


@pytest.fixture
def captured(monkeypatch) -> list:
    """AI 에 실제로 무엇이 전달됐는지 확인하기 위해 입력을 기록한다."""
    calls = []
    import modeling

    def _answer(request, **_kwargs):
        calls.append(request)
        return f"답변({len(calls)})"

    monkeypatch.setattr(modeling, "generate_answer", _answer)
    monkeypatch.setattr(
        modeling, "generate_title", lambda p, **_kwargs: f"제목: {p[:10]}"
    )
    return calls


@pytest.fixture
def chat(client, auth) -> dict:
    return client.post("/api/chats", headers=auth).json()


def msg_url(chat: dict) -> str:
    return (
        f"/api/chats/{chat['chatMeta']['chatId']}"
        f"/branches/{chat['branchMeta']['branchId']}/messages"
    )


def send(client, auth, chat, prompt: str, context_ids=None) -> dict:
    res = client.post(
        msg_url(chat),
        json={"userPrompt": prompt, "contextBlockIds": context_ids or []},
        headers=auth,
    )
    assert res.status_code == 201, res.text
    return res.json()


def feedback_url(chat: dict, block_id: str) -> str:
    return (
        f"/api/chats/{chat['chatMeta']['chatId']}"
        f"/branches/{chat['branchMeta']['branchId']}/blocks/{block_id}/feedback"
    )


# ── BE-AIRESP-001, 002: 전송과 저장 ───────────────────────────────────────


def test_send_creates_question_and_answer(client, auth, chat, captured):
    body = send(client, auth, chat, "파이프라이닝이 뭐야?")

    assert body["userBlock"]["role"] == "user"
    assert body["userBlock"]["content"] == "파이프라이닝이 뭐야?"
    assert body["assistantBlock"]["role"] == "assistant"
    assert body["assistantBlock"]["content"] == "답변(1)"
    assert body["actionMeta"] == {
        "actionType": "message_send",
        "successCode": "MESSAGE_SENT",
        "message": "메시지를 보내고 답변을 생성했습니다.",
        "affectedResourceId": body["assistantBlock"]["blockId"],
    }


def test_blocks_are_in_order(client, auth, chat, captured):
    send(client, auth, chat, "첫 질문")
    send(client, auth, chat, "두 번째 질문")

    detail = client.get(f"/api/chats/{chat['chatMeta']['chatId']}", headers=auth)
    blocks = detail.json()["messageBlocks"]
    assert [b["role"] for b in blocks] == ["user", "assistant", "user", "assistant"]
    assert [b["orderIndex"] for b in blocks] == [0, 1, 2, 3]


def test_prompt_is_not_duplicated_into_history(client, auth, chat, captured):
    """방금 보낸 질문이 이전 대화에도 들어가면 같은 말이 두 번 전달된다."""
    send(client, auth, chat, "첫 질문")

    request = captured[0]
    assert request.user_prompt == "첫 질문"
    assert request.message_flow == []


def test_second_send_includes_previous_turns(client, auth, chat, captured):
    send(client, auth, chat, "첫 질문")
    send(client, auth, chat, "두 번째 질문")

    request = captured[1]
    assert [t.content for t in request.message_flow] == ["첫 질문", "답변(1)"]
    assert request.user_prompt == "두 번째 질문"


def test_send_requires_prompt(client, auth, chat, captured):
    res = client.post(
        msg_url(chat), json={"userPrompt": "   "}, headers=auth
    )
    assert res.status_code == 400
    assert res.json()["errorCode"] == "VALIDATION_ERROR"


def test_question_survives_ai_failure(client, auth, chat, monkeypatch):
    """답변 생성이 실패해도 질문은 남아야 다시 입력하지 않는다."""
    import modeling

    def _boom(request, **_kwargs):
        raise RuntimeError("모델 오류")

    monkeypatch.setattr(modeling, "generate_answer", _boom)

    res = client.post(msg_url(chat), json={"userPrompt": "질문"}, headers=auth)
    assert res.status_code == 502
    assert res.json()["errorCode"] == "AI_RESPONSE_FAILED"

    detail = client.get(f"/api/chats/{chat['chatMeta']['chatId']}", headers=auth)
    assert [b["content"] for b in detail.json()["messageBlocks"]] == ["질문"]


# ── BE-AIRESP-004: AI 답변 평가 ───────────────────────────────────────────


def test_feedback_can_be_saved_changed_and_cleared(client, auth, chat, captured):
    answer_id = send(client, auth, chat, "질문")["assistantBlock"]["blockId"]
    url = feedback_url(chat, answer_id)

    liked = client.put(url, json={"rating": "like"}, headers=auth)
    assert liked.status_code == 200
    assert liked.json()["rating"] == "like"
    assert liked.json()["updatedAt"] is not None
    assert liked.json()["actionMeta"]["successCode"] == "AI_RESPONSE_FEEDBACK_UPDATED"

    disliked = client.put(url, json={"rating": "dislike"}, headers=auth)
    assert disliked.status_code == 200
    assert disliked.json()["rating"] == "dislike"

    loaded = client.get(url, headers=auth)
    assert loaded.status_code == 200
    assert loaded.json()["rating"] == "dislike"
    assert "actionMeta" not in loaded.json()

    cleared = client.put(url, json={"rating": None}, headers=auth)
    assert cleared.status_code == 200
    assert cleared.json()["rating"] is None
    assert client.get(url, headers=auth).json()["rating"] is None


def test_feedback_rejects_user_block_and_invalid_rating(client, auth, chat, captured):
    sent = send(client, auth, chat, "질문")
    user_url = feedback_url(chat, sent["userBlock"]["blockId"])
    bad_role = client.put(user_url, json={"rating": "like"}, headers=auth)
    assert bad_role.status_code == 400
    assert bad_role.json()["errorCode"] == "NOT_ASSISTANT_BLOCK"

    answer_url = feedback_url(chat, sent["assistantBlock"]["blockId"])
    bad_rating = client.put(answer_url, json={"rating": "neutral"}, headers=auth)
    assert bad_rating.status_code == 422


def test_feedback_allowed_on_inherited_block(client, auth, chat, captured):
    """A1: 평가는 내용을 바꾸지 않으므로 하위 브랜치가 이어받은 답변도 허용한다 (BE-AIRESP-004, 006)."""
    sent = send(client, auth, chat, "질문")
    assistant_id = sent["assistantBlock"]["blockId"]
    chat_id = chat["chatMeta"]["chatId"]

    branch_res = client.post(
        f"/api/chats/{chat_id}/branches",
        json={
            "branchName": "하위 브랜치",
            "baseBranchId": chat["branchMeta"]["branchId"],
            "baseMessageBlockId": assistant_id,
            "contextBlockIds": [],
        },
        headers=auth,
    )
    assert branch_res.status_code == 201, branch_res.text
    new_branch_id = branch_res.json()["branchId"]

    url = (
        f"/api/chats/{chat_id}/branches/{new_branch_id}"
        f"/blocks/{assistant_id}/feedback"
    )
    liked = client.put(url, json={"rating": "like"}, headers=auth)
    assert liked.status_code == 200, liked.text
    assert liked.json()["rating"] == "like"
    assert client.get(url, headers=auth).json()["rating"] == "like"


# ── BE-CTXAPPLY-001~003: Context 적용 ─────────────────────────────────────


def test_applied_context_is_passed_to_ai(client, auth, chat, captured):
    first = send(client, auth, chat, "구조적 해저드 설명해줘")
    answer_block = first["assistantBlock"]["blockId"]

    body = send(client, auth, chat, "표로 정리해줘", context_ids=[answer_block])

    assert [c["blockId"] for c in body["appliedContext"]] == [answer_block]
    assert captured[1].applied_context == ["답변(1)"]


def test_applied_context_replaces_prior_conversation(client, auth, chat, captured):
    """Context 를 고르면 나머지 대화는 빼고 묻는 것이다 (NFR-011).

    이전 흐름을 함께 넣으면 최근 대화가 Context 를 눌러, 고르지 않은 주제로
    답이 흘러간다.
    """
    first = send(client, auth, chat, "해저드 설명해줘")
    send(client, auth, chat, "캐시는 뭐야?")

    send(
        client,
        auth,
        chat,
        "방금 내용을 표로 정리해줘",
        context_ids=[first["assistantBlock"]["blockId"]],
    )

    request = captured[-1]
    assert request.applied_context == ["답변(1)"]
    assert request.message_flow == []


def test_prior_conversation_is_kept_without_context(client, auth, chat, captured):
    """Context 를 고르지 않았으면 평소처럼 이전 대화를 이어간다."""
    send(client, auth, chat, "첫 질문")
    send(client, auth, chat, "두 번째 질문")

    assert [t.content for t in captured[-1].message_flow] == ["첫 질문", "답변(1)"]


def test_context_uses_server_side_current_version(client, auth, chat, captured):
    """화면이 보낸 본문이 아니라 서버의 현재 활성 버전을 쓴다."""
    first = send(client, auth, chat, "질문")
    block_id = first["assistantBlock"]["blockId"]

    block_url = (
        f"/api/chats/{chat['chatMeta']['chatId']}"
        f"/branches/{chat['branchMeta']['branchId']}/blocks/{block_id}"
    )
    client.patch(block_url, json={"editedContent": "수정된 답변"}, headers=auth)

    send(client, auth, chat, "이어서", context_ids=[block_id])
    assert captured[1].applied_context == ["수정된 답변"]


def test_context_items_follow_conversation_order(client, auth, chat, captured):
    first = send(client, auth, chat, "첫 질문")
    second = send(client, auth, chat, "두 번째 질문")

    # 일부러 뒤집어 보낸다
    body = send(
        client,
        auth,
        chat,
        "정리해줘",
        context_ids=[second["assistantBlock"]["blockId"], first["userBlock"]["blockId"]],
    )

    assert [c["orderIndex"] for c in body["appliedContext"]] == [0, 3]


def test_duplicate_context_ids_are_deduplicated(client, auth, chat, captured):
    first = send(client, auth, chat, "질문")
    block_id = first["assistantBlock"]["blockId"]

    body = send(client, auth, chat, "이어서", context_ids=[block_id, block_id])

    assert len(body["appliedContext"]) == 1
    assert captured[1].applied_context == ["답변(1)"]


def test_context_block_outside_branch_is_rejected(client, auth, chat, captured):
    res = client.post(
        msg_url(chat),
        json={
            "userPrompt": "질문",
            "contextBlockIds": ["00000000-0000-0000-0000-000000000000"],
        },
        headers=auth,
    )
    assert res.status_code == 400
    assert res.json()["errorCode"] == "VALIDATION_ERROR"


def test_pending_refine_result_is_not_used_as_context(
    client, auth, chat, captured, monkeypatch
):
    """승인하지 않은 정제본은 활성 버전이 아니므로 Context 에 들어가면 안 된다."""
    import modeling
    from modeling.types import RefineResult

    first = send(client, auth, chat, "질문")
    block_id = first["assistantBlock"]["blockId"]

    monkeypatch.setattr(
        modeling,
        "refine_blocks",
        lambda targets, instruction, **_kwargs: [
            RefineResult(block_id=t.block_id, refined_content="정제된 내용")
            for t in targets
        ],
    )
    client.post(
        f"/api/chats/{chat['chatMeta']['chatId']}"
        f"/branches/{chat['branchMeta']['branchId']}/refine-jobs",
        json={"selectedBlockIds": [block_id], "instructionText": "요약"},
        headers=auth,
    )

    send(client, auth, chat, "이어서", context_ids=[block_id])
    assert captured[1].applied_context == ["답변(1)"]


# ── BE-CHAT-004: 제목 자동 생성 ───────────────────────────────────────────


def test_first_message_generates_title(client, auth, chat, captured):
    body = send(client, auth, chat, "파이프라이닝 알려줘")

    assert body["titleGenerated"] is True
    assert body["chatTitle"] == "제목: 파이프라이닝 알려줘"


def test_title_is_generated_only_once(client, auth, chat, captured):
    send(client, auth, chat, "첫 질문")
    body = send(client, auth, chat, "두 번째 질문")

    assert body["titleGenerated"] is False
    assert body["chatTitle"] == "제목: 첫 질문"


def test_conversation_continues_when_title_fails(client, auth, chat, monkeypatch):
    """제목은 부가 정보라 실패해도 대화는 정상이어야 한다."""
    import modeling

    monkeypatch.setattr(modeling, "generate_answer", lambda r, **_kwargs: "답변")

    def _boom(prompt, **_kwargs):
        raise RuntimeError("제목 생성 실패")

    monkeypatch.setattr(modeling, "generate_title", _boom)

    body = send(client, auth, chat, "질문")
    assert body["assistantBlock"]["content"] == "답변"
    assert body["titleGenerated"] is False
    assert body["chatTitle"] == "새 대화"


# ── BE-AIRESP-003: 재생성 ─────────────────────────────────────────────────


def test_regenerate_adds_version_to_same_block(client, auth, chat, captured):
    first = send(client, auth, chat, "질문")
    block_id = first["assistantBlock"]["blockId"]
    base = (
        f"/api/chats/{chat['chatMeta']['chatId']}"
        f"/branches/{chat['branchMeta']['branchId']}/blocks/{block_id}"
    )

    again = client.post(f"{base}/regenerate", headers=auth).json()

    assert again["blockId"] == block_id
    assert again["versionNo"] == 2
    assert again["content"] == "답변(2)"
    assert again["actionMeta"] == {
        "actionType": "ai_response_regenerate",
        "successCode": "AI_RESPONSE_REGENERATED",
        "message": "답변을 다시 생성했습니다.",
        "affectedResourceId": block_id,
    }

    versions = client.get(f"{base}/versions", headers=auth).json()
    assert [v["content"] for v in versions] == ["답변(1)", "답변(2)"]
    assert versions[-1]["sourceType"] == "ai_regenerate"


def test_regenerate_returns_search_sources(client, auth, chat, captured, monkeypatch):
    import modeling
    from modeling.types import AnswerResult, SearchSource

    source = SearchSource("공식 문서", "https://example.com")
    monkeypatch.setattr(
        modeling,
        "generate_answer",
        lambda _request, **_kwargs: AnswerResult("검색 답변", [source]),
    )
    first = send(client, auth, chat, "검색해줘")
    block_id = first["assistantBlock"]["blockId"]
    res = client.post(
        f"/api/chats/{chat['chatMeta']['chatId']}/branches/{chat['branchMeta']['branchId']}"
        f"/blocks/{block_id}/regenerate",
        headers=auth,
    )

    assert res.status_code == 200
    assert res.json()["searchSources"] == [{"title": source.title, "url": source.url}]

    reopened = client.get(
        f"/api/chats/{chat['chatMeta']['chatId']}?branchId={chat['branchMeta']['branchId']}",
        headers=auth,
    )
    reopened_block = next(
        b for b in reopened.json()["messageBlocks"] if b["blockId"] == block_id
    )
    assert reopened_block["searchSources"] == [{"title": source.title, "url": source.url}]


def test_regenerate_reuses_the_original_question(client, auth, chat, captured):
    send(client, auth, chat, "첫 질문")
    second = send(client, auth, chat, "두 번째 질문")

    client.post(
        f"/api/chats/{chat['chatMeta']['chatId']}"
        f"/branches/{chat['branchMeta']['branchId']}"
        f"/blocks/{second['assistantBlock']['blockId']}/regenerate",
        headers=auth,
    )

    request = captured[-1]
    assert request.user_prompt == "두 번째 질문"
    assert [t.content for t in request.message_flow] == ["첫 질문", "답변(1)"]


def test_regenerate_reuses_context_and_original_snapshot(client, auth, chat, captured):
    first = send(client, auth, chat, "기준 내용")
    second = send(client, auth, chat, "Context로 답해줘", [first["assistantBlock"]["blockId"]])
    client.post(
        f"/api/chats/{chat['chatMeta']['chatId']}/branches/{chat['branchMeta']['branchId']}"
        f"/blocks/{second['assistantBlock']['blockId']}/regenerate", headers=auth,
    )
    original, regenerated = captured[1], captured[2]
    assert regenerated.user_prompt == original.user_prompt
    assert regenerated.applied_context == original.applied_context
    assert regenerated.message_flow == original.message_flow


def test_failed_job_can_retry_without_duplicate_question(client, auth, chat, monkeypatch):
    import modeling
    calls = [0]
    def flaky(_request, **_kwargs):
        calls[0] += 1
        if calls[0] == 1:
            raise RuntimeError("temporary")
        return "복구 답변"
    monkeypatch.setattr(modeling, "generate_answer", flaky)
    failed = client.post(msg_url(chat), json={"userPrompt": "복구할 질문"}, headers=auth)
    assert failed.status_code == 502
    job_id = failed.json()["detail"]["aiResponseJobId"]
    retried = client.post(f"{msg_url(chat).removesuffix('/messages')}/ai-response-jobs/{job_id}/retry", headers=auth)
    assert retried.status_code == 201
    assert retried.json()["actionMeta"]["successCode"] == "AI_RESPONSE_RETRY_SUCCEEDED"
    detail = client.get(f"/api/chats/{chat['chatMeta']['chatId']}", headers=auth).json()
    assert [block["content"] for block in detail["messageBlocks"]] == ["복구할 질문", "복구 답변"]


def test_failed_first_question_retry_generates_title(client, auth, chat, monkeypatch):
    import modeling

    calls = [0]

    def flaky(_request, **_kwargs):
        calls[0] += 1
        if calls[0] == 1:
            raise RuntimeError("temporary")
        return "복구 답변"

    monkeypatch.setattr(modeling, "generate_answer", flaky)
    title_calls = []
    monkeypatch.setattr(
        modeling,
        "generate_title",
        lambda prompt, **_kwargs: title_calls.append(prompt) or "복구 질문 제목",
    )

    failed = client.post(
        msg_url(chat), json={"userPrompt": "복구할 첫 질문"}, headers=auth
    )
    job_id = failed.json()["detail"]["aiResponseJobId"]
    retried = client.post(
        f"{msg_url(chat).removesuffix('/messages')}/ai-response-jobs/{job_id}/retry",
        headers=auth,
    )

    assert retried.status_code == 201
    body = retried.json()
    assert body["titleGenerated"] is True
    assert body["chatTitle"] == "복구 질문 제목"
    assert title_calls == ["복구할 첫 질문"]


def test_legacy_regenerate_does_not_use_default_conditions(
    client, auth, chat, captured, db_session
):
    import uuid
    from sqlalchemy import delete
    from app.models import AiResponseJob

    first = send(client, auth, chat, "예전 답변")
    db_session.execute(
        delete(AiResponseJob).where(
            AiResponseJob.assistant_message_block_id
            == uuid.UUID(first["assistantBlock"]["blockId"])
        )
    )
    db_session.commit()

    res = client.post(
        f"/api/chats/{chat['chatMeta']['chatId']}/branches/{chat['branchMeta']['branchId']}"
        f"/blocks/{first['assistantBlock']['blockId']}/regenerate",
        headers=auth,
    )

    assert res.status_code == 404
    assert res.json()["errorCode"] == "AI_INPUT_SNAPSHOT_NOT_FOUND"


def test_regenerate_rejects_user_block(client, auth, chat, captured):
    first = send(client, auth, chat, "질문")

    res = client.post(
        f"/api/chats/{chat['chatMeta']['chatId']}"
        f"/branches/{chat['branchMeta']['branchId']}"
        f"/blocks/{first['userBlock']['blockId']}/regenerate",
        headers=auth,
    )
    assert res.status_code == 400
    assert res.json()["errorCode"] == "NOT_ASSISTANT_BLOCK"


def test_regenerate_rejects_inherited_block(client, auth, chat, captured):
    """A2: 재생성은 내용을 바꾸므로 하위 브랜치가 이어받은 답변은 그대로 막는다 (NFR-007)."""
    sent = send(client, auth, chat, "질문")
    assistant_id = sent["assistantBlock"]["blockId"]
    chat_id = chat["chatMeta"]["chatId"]

    branch_res = client.post(
        f"/api/chats/{chat_id}/branches",
        json={
            "branchName": "하위 브랜치",
            "baseBranchId": chat["branchMeta"]["branchId"],
            "baseMessageBlockId": assistant_id,
            "contextBlockIds": [],
        },
        headers=auth,
    )
    assert branch_res.status_code == 201, branch_res.text
    new_branch_id = branch_res.json()["branchId"]

    res = client.post(
        f"/api/chats/{chat_id}/branches/{new_branch_id}/blocks/{assistant_id}/regenerate",
        headers=auth,
    )
    assert res.status_code == 400
    assert res.json()["errorCode"] == "VALIDATION_ERROR"


def test_regenerated_answer_can_be_rolled_back(client, auth, chat, captured):
    first = send(client, auth, chat, "질문")
    block_id = first["assistantBlock"]["blockId"]
    base = (
        f"/api/chats/{chat['chatMeta']['chatId']}"
        f"/branches/{chat['branchMeta']['branchId']}/blocks/{block_id}"
    )
    client.post(f"{base}/regenerate", headers=auth)

    versions = client.get(f"{base}/versions", headers=auth).json()
    restored = client.patch(
        f"{base}/version",
        json={"targetVersionId": versions[0]["versionId"]},
        headers=auth,
    ).json()

    assert restored["content"] == "답변(1)"


# ── 권한 ──────────────────────────────────────────────────────────────────


def test_other_user_cannot_send(client, auth, chat, captured, monkeypatch):
    other = GoogleUser("sub-y", "y@example.com", "다른사람", None)
    monkeypatch.setattr(auth_router, "verify_google_id_token", lambda _t: other)
    token = client.post("/api/auth/google", json={"idToken": "x"}).json()["accessToken"]

    res = client.post(
        msg_url(chat),
        json={"userPrompt": "침입"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 403
