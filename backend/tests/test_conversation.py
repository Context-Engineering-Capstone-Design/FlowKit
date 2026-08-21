"""메시지 전송·답변 테스트 (2.7 Context 적용, 2.8 AI 응답 관리, ).

AI 답변 생성은 백그라운드 스레드에서 돈다. conftest의 client 픽스처가
ai_response_service.run_jobs_synchronously를 True로 바꿔두므로, 이 파일의
테스트에서는 send()/regenerate() 호출이 돌아올 때 이미 생성이 끝나 있다 —
다만 응답 본문 자체는 "즉시 응답" 계약대로 늘 빈 채로 온다.
그래서 최종 본문을 확인해야 하는 테스트는 wait_done()으로 블록을 다시 읽는다.
"""

from __future__ import annotations

import time

import pytest

from app.routers import auth as auth_router
from app.services.google_auth import GoogleUser
from modeling.types import AnswerChunk, AnswerResult

USER = GoogleUser("sub-conv", "conv@example.com", "대화테스터", None)


@pytest.fixture
def auth(client, monkeypatch) -> dict:
    monkeypatch.setattr(auth_router, "verify_google_id_token", lambda _t: USER)
    res = client.post("/api/auth/google", json={"idToken": "dummy"})
    headers = {"Authorization": f"Bearer {res.json()['accessToken']}"}
    saved = client.put(
        "/api/settings/api-keys/openai",
        json={"apiKey": "test-api-key-1234567890"},
        headers=headers,
    )
    assert saved.status_code == 200, saved.text
    return headers


def _stream_of(text: str, sources: list | None = None):
    """문자열 답변 하나를 스트리밍 조각(완료 하나)으로 감싼다."""
    yield AnswerChunk(type="done", result=AnswerResult(text=text, search_sources=sources or []))


@pytest.fixture
def captured(monkeypatch) -> list:
    """AI 에 실제로 무엇이 전달됐는지 확인하기 위해 입력을 기록한다."""
    calls = []
    import modeling

    def _answer_stream(request, **_kwargs):
        calls.append(request)
        yield from _stream_of(f"답변({len(calls)})")

    monkeypatch.setattr(modeling, "generate_answer_stream", _answer_stream)
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


def send(client, auth, chat, prompt: str, context_ids=None, context_ranges=None) -> dict:
    """즉시 응답만 확인한다. assistantBlock 은 비어 있고 generating 상태다."""
    res = client.post(
        msg_url(chat),
        json={
            "userPrompt": prompt,
            "contextBlockIds": context_ids or [],
            "contextRanges": context_ranges or [],
        },
        headers=auth,
    )
    assert res.status_code == 201, res.text
    return res.json()


def block_of(client, auth, chat: dict, block_id: str) -> dict:
    detail = client.get(f"/api/chats/{chat['chatMeta']['chatId']}", headers=auth)
    return next(b for b in detail.json()["messageBlocks"] if b["blockId"] == block_id)


def wait_done(client, auth, chat: dict, block_id: str, timeout: float = 2.0) -> dict:
    """생성이 끝날 때까지(더 이상 generating 이 아닐 때까지) 블록을 다시 읽는다.

    테스트는 동기 실행이라 보통 첫 조회에서 바로 끝나 있다. 그래도 실제
    스레드 스케줄링 여지를 남겨 두려고 짧게 재시도한다.
    """
    deadline = time.monotonic() + timeout
    block = block_of(client, auth, chat, block_id)
    while block["generationStatus"] == "generating" and time.monotonic() < deadline:
        time.sleep(0.01)
        block = block_of(client, auth, chat, block_id)
    return block


def send_and_wait(client, auth, chat, prompt: str, context_ids=None) -> dict:
    """전송 후 답변 생성이 끝날 때까지 기다려, assistantBlock 을 최종 본문으로 채워 돌려준다."""
    body = send(client, auth, chat, prompt, context_ids)
    body["assistantBlock"] = wait_done(client, auth, chat, body["assistantBlock"]["blockId"])
    return body


def feedback_url(chat: dict, block_id: str) -> str:
    return (
        f"/api/chats/{chat['chatMeta']['chatId']}"
        f"/branches/{chat['branchMeta']['branchId']}/blocks/{block_id}/feedback"
    )


# ── , 002, 007: 전송과 저장 ─────────────────────────────────


def test_send_returns_immediately_with_empty_generating_block(client, auth, chat, captured):
    """ B1: 전송 응답은 답변을 기다리지 않고 빈 블록을 즉시 돌려준다."""
    body = send(client, auth, chat, "파이프라이닝이 뭐야?")

    assert body["userBlock"]["role"] == "user"
    assert body["userBlock"]["content"] == "파이프라이닝이 뭐야?"
    assert body["assistantBlock"]["role"] == "assistant"
    assert body["assistantBlock"]["content"] == ""
    assert body["assistantBlock"]["generationStatus"] == "generating"
    assert body["jobStatus"] == "generating"
    assert body["searchSources"] == []
    assert body["actionMeta"] == {
        "actionType": "message_send",
        "successCode": "MESSAGE_SENT",
        "message": "메시지를 보내고 답변을 생성했습니다.",
        "affectedResourceId": body["assistantBlock"]["blockId"],
    }


def test_send_creates_question_and_answer(client, auth, chat, captured):
    body = send_and_wait(client, auth, chat, "파이프라이닝이 뭐야?")

    assert body["assistantBlock"]["content"] == "답변(1)"
    assert body["assistantBlock"]["generationStatus"] == "complete"


def test_default_send_does_not_enable_web_search(client, auth, chat, captured):
    """웹 검색 모드를 지정하지 않으면 off로 전달돼 검색 도구가 붙지 않아야 한다."""
    send(client, auth, chat, "질문")

    assert captured[0].web_search_mode == "off"


def test_web_search_mode_is_passed_through(client, auth, chat, captured):
    res = client.post(
        msg_url(chat),
        json={"userPrompt": "질문", "webSearchMode": "always"},
        headers=auth,
    )
    assert res.status_code == 201, res.text
    assert res.json()["webSearchMode"] == "always"
    assert captured[0].web_search_mode == "always"


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
    """답변 생성이 실패해도 질문은 남아야 다시 입력하지 않는다.

    실패는 이제 백그라운드에서 일어나므로 전송 응답 자체는 여전히 201이고,
    답변 블록의 상태가 failed 로 바뀐다.
    """
    import modeling

    def _boom(request, **_kwargs):
        raise RuntimeError("모델 오류")

    monkeypatch.setattr(modeling, "generate_answer_stream", _boom)

    res = client.post(msg_url(chat), json={"userPrompt": "질문"}, headers=auth)
    assert res.status_code == 201, res.text
    block_id = res.json()["assistantBlock"]["blockId"]

    block = wait_done(client, auth, chat, block_id)
    assert block["generationStatus"] == "failed"
    assert block["content"] == ""

    detail = client.get(f"/api/chats/{chat['chatMeta']['chatId']}", headers=auth)
    assert [b["content"] for b in detail.json()["messageBlocks"]] == ["질문", ""]


# ── AI 답변 평가 ───────────────────────────────────────────


def test_feedback_can_be_saved_changed_and_cleared(client, auth, chat, captured):
    answer_id = send_and_wait(client, auth, chat, "질문")["assistantBlock"]["blockId"]
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
    """A1: 평가는 내용을 바꾸지 않으므로 하위 브랜치가 이어받은 답변도 허용한다 (, 006)."""
    sent = send_and_wait(client, auth, chat, "질문")
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


# ── Context 적용 ─────────────────────────────────────


def test_applied_context_is_passed_to_ai(client, auth, chat, captured):
    first = send_and_wait(client, auth, chat, "구조적 해저드 설명해줘")
    answer_block = first["assistantBlock"]["blockId"]

    body = send(client, auth, chat, "표로 정리해줘", context_ids=[answer_block])

    assert [c["blockId"] for c in body["appliedContext"]] == [answer_block]
    assert captured[1].applied_context == ["답변(1)"]


def test_applied_context_replaces_prior_conversation(client, auth, chat, captured):
    """Context 를 고르면 나머지 대화는 빼고 묻는 것이다 .

    이전 흐름을 함께 넣으면 최근 대화가 Context 를 눌러, 고르지 않은 주제로
    답이 흘러간다.
    """
    first = send_and_wait(client, auth, chat, "해저드 설명해줘")
    send_and_wait(client, auth, chat, "캐시는 뭐야?")

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
    send_and_wait(client, auth, chat, "첫 질문")
    send(client, auth, chat, "두 번째 질문")

    assert [t.content for t in captured[-1].message_flow] == ["첫 질문", "답변(1)"]


def test_context_uses_server_side_current_version(client, auth, chat, captured):
    """화면이 보낸 본문이 아니라 서버의 현재 활성 버전을 쓴다."""
    first = send_and_wait(client, auth, chat, "질문")
    block_id = first["assistantBlock"]["blockId"]

    block_url = (
        f"/api/chats/{chat['chatMeta']['chatId']}"
        f"/branches/{chat['branchMeta']['branchId']}/blocks/{block_id}"
    )
    client.patch(block_url, json={"editedContent": "수정된 답변"}, headers=auth)

    send(client, auth, chat, "이어서", context_ids=[block_id])
    assert captured[1].applied_context == ["수정된 답변"]


def test_context_items_follow_conversation_order(client, auth, chat, captured):
    first = send_and_wait(client, auth, chat, "첫 질문")
    second = send_and_wait(client, auth, chat, "두 번째 질문")

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
    first = send_and_wait(client, auth, chat, "질문")
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


# ── 0820_13: 드래그로 고른 부분 범위 Context ─────────────────────────────


def test_range_context_snippet_is_passed_to_ai_instead_of_full_block(client, auth, chat, captured):
    first = send_and_wait(client, auth, chat, "구조적 해저드 설명해줘")
    block_id = first["assistantBlock"]["blockId"]
    version_id = first["assistantBlock"]["currentVersionId"]

    body = send(
        client, auth, chat, "이 부분만 표로 정리해줘",
        context_ranges=[{
            "blockId": block_id,
            "versionId": version_id,
            "snippetText": "답변(1)",
            "startOffset": 0,
            "endOffset": 5,
        }],
    )

    assert [c["blockId"] for c in body["appliedContext"]] == [block_id]
    assert body["appliedContext"][0]["startOffset"] == 0
    assert body["appliedContext"][0]["endOffset"] == 5
    assert captured[1].applied_context == ["[[답변(1)]]"]


def test_range_context_handles_repeated_words_at_different_offsets(client, auth, chat, captured):
    """0821_10: 같은 문구가 여러 번 나와도 지정한 startOffset/endOffset 기준 맥락이 AI로 넘어간다."""
    source = client.post(
        f"/api/chats/{chat['chatMeta']['chatId']}/branches/{chat['branchMeta']['branchId']}/blocks",
        json={"role": "assistant", "content": "첫 번째 K 그리고 두 번째 K와 세 번째 K"},
        headers=auth,
    ).json()
    block_id = source["blockId"]
    version_id = source["currentVersionId"]

    # "두 번째 K"의 "K" 위치는 offset 12 (0-indexed: "첫 번째 K 그리고 두 번째 K와 세 번째 K")
    # "첫 번째 K 그리고 두 번째 " -> 12글자
    k_offset = source["content"].index("두 번째 K") + len("두 번째 ")
    body = send(
        client, auth, chat, "이 K가 뭐야?",
        context_ranges=[{
            "blockId": block_id,
            "versionId": version_id,
            "snippetText": "K",
            "startOffset": k_offset,
            "endOffset": k_offset + 1,
        }],
    )

    assert body["appliedContext"][0]["startOffset"] == k_offset
    assert body["appliedContext"][0]["endOffset"] == k_offset + 1
    assert captured[-1].applied_context == ["첫 번째 K 그리고 두 번째 [[K]]와 세 번째 K"]


def test_range_context_rejects_mismatched_offset(client, auth, chat, captured):
    """0821_10: 오프셋 위치의 원문과 snippetText가 일치하지 않으면 거부한다."""
    first = send_and_wait(client, auth, chat, "질문")
    block_id = first["assistantBlock"]["blockId"]
    version_id = first["assistantBlock"]["currentVersionId"]

    res = client.post(
        msg_url(chat),
        json={
            "userPrompt": "이어서",
            "contextRanges": [{
                "blockId": block_id,
                "versionId": version_id,
                "snippetText": "답변",
                "startOffset": 10,
                "endOffset": 12,
            }],
        },
        headers=auth,
    )
    assert res.status_code == 400
    assert res.json()["errorCode"] == "VALIDATION_ERROR"


def test_range_context_rejects_out_of_bounds_offset(client, auth, chat, captured):
    """0821_10: 본문 길이를 벗어난 오프셋은 거부한다."""
    first = send_and_wait(client, auth, chat, "질문")
    block_id = first["assistantBlock"]["blockId"]
    version_id = first["assistantBlock"]["currentVersionId"]

    res = client.post(
        msg_url(chat),
        json={
            "userPrompt": "이어서",
            "contextRanges": [{
                "blockId": block_id,
                "versionId": version_id,
                "snippetText": "답변",
                "startOffset": 100,
                "endOffset": 102,
            }],
        },
        headers=auth,
    )
    assert res.status_code == 400
    assert res.json()["errorCode"] == "VALIDATION_ERROR"


def test_range_context_replaces_prior_conversation_like_block_context(client, auth, chat, captured):
    first = send_and_wait(client, auth, chat, "질문")
    version_id = first["assistantBlock"]["currentVersionId"]
    block_id = first["assistantBlock"]["blockId"]

    send(
        client, auth, chat, "이어서",
        context_ranges=[{"blockId": block_id, "versionId": version_id, "snippetText": "답변(1)"}],
    )

    assert captured[-1].message_flow == []


def test_range_context_rejects_snippet_not_in_version_content(client, auth, chat, captured):
    first = send_and_wait(client, auth, chat, "질문")
    block_id = first["assistantBlock"]["blockId"]
    version_id = first["assistantBlock"]["currentVersionId"]

    res = client.post(
        msg_url(chat),
        json={
            "userPrompt": "이어서",
            "contextRanges": [{"blockId": block_id, "versionId": version_id, "snippetText": "원문에 없는 내용"}],
        },
        headers=auth,
    )
    assert res.status_code == 400
    assert res.json()["errorCode"] == "VALIDATION_ERROR"


def test_range_context_rejects_block_outside_branch(client, auth, chat, captured):
    res = client.post(
        msg_url(chat),
        json={
            "userPrompt": "질문",
            "contextRanges": [{
                "blockId": "00000000-0000-0000-0000-000000000000",
                "versionId": "00000000-0000-0000-0000-000000000000",
                "snippetText": "아무거나",
            }],
        },
        headers=auth,
    )
    assert res.status_code == 400
    assert res.json()["errorCode"] == "VALIDATION_ERROR"


def test_range_context_can_combine_with_multiple_snippets_from_same_block(client, auth, chat, captured):
    """겹치거나 같은 블록에서 고른 여러 범위도 각각 별도 Context 항목으로 유지된다."""
    first = send_and_wait(client, auth, chat, "질문")
    block_id = first["assistantBlock"]["blockId"]
    version_id = first["assistantBlock"]["currentVersionId"]

    body = send(
        client, auth, chat, "정리해줘",
        context_ranges=[
            {"blockId": block_id, "versionId": version_id, "snippetText": "답변"},
            {"blockId": block_id, "versionId": version_id, "snippetText": "(1)"},
        ],
    )

    assert len(body["appliedContext"]) == 2
    assert captured[-1].applied_context == ["[[답변]](1)", "답변[[(1)]]"]


def test_range_context_content_is_included_in_send_response(client, auth, chat, captured):
    """전송 응답에도 인용 스니펫 내용이 곧바로 실려야 채팅 내역에 바로 보여줄 수 있다."""
    first = send_and_wait(client, auth, chat, "질문")
    block_id = first["assistantBlock"]["blockId"]
    version_id = first["assistantBlock"]["currentVersionId"]

    body = send(
        client, auth, chat, "이 부분만 표로 정리해줘",
        context_ranges=[{"blockId": block_id, "versionId": version_id, "snippetText": "답변(1)"}],
    )

    assert body["appliedContext"][0]["content"] == "답변(1)"


def test_range_context_snippet_persists_on_chat_reload(client, auth, chat, captured):
    """대화를 다시 조회해도 사용자 메시지에 인용 스니펫이 그대로 남아 있어야 한다."""
    first = send_and_wait(client, auth, chat, "질문")
    block_id = first["assistantBlock"]["blockId"]
    version_id = first["assistantBlock"]["currentVersionId"]

    sent = send(
        client, auth, chat, "이 부분만 표로 정리해줘",
        context_ranges=[{"blockId": block_id, "versionId": version_id, "snippetText": "답변(1)"}],
    )
    user_block_id = sent["userBlock"]["blockId"]

    reloaded = block_of(client, auth, chat, user_block_id)
    assert [c["content"] for c in reloaded["appliedContext"]] == ["답변(1)"]

    other_block = block_of(client, auth, chat, first["userBlock"]["blockId"])
    assert other_block["appliedContext"] == []


def test_range_context_keeps_snapshot_of_its_pinned_version_after_edit(client, auth, chat, captured):
    """0820_13 D3: 원문이 나중에 수정돼도 선택 당시(구 버전) 스냅샷을 Context로 쓴다."""
    first = send_and_wait(client, auth, chat, "질문")
    block_id = first["assistantBlock"]["blockId"]
    old_version_id = first["assistantBlock"]["currentVersionId"]

    block_url = (
        f"/api/chats/{chat['chatMeta']['chatId']}"
        f"/branches/{chat['branchMeta']['branchId']}/blocks/{block_id}"
    )
    client.patch(block_url, json={"editedContent": "수정된 답변"}, headers=auth)

    body = send(
        client, auth, chat, "예전 답변 기준으로 정리해줘",
        context_ranges=[{"blockId": block_id, "versionId": old_version_id, "snippetText": "답변(1)"}],
    )

    # 지금 활성 버전(수정된 답변)이 아니라, 태그가 고정한 예전 버전의 스니펫이 그대로 쓰인다
    assert captured[-1].applied_context == ["[[답변(1)]]"]
    assert body["appliedContext"][0]["versionId"] == old_version_id


def test_generating_block_cannot_be_used_as_context(client, auth, chat, captured, db_session):
    """D밀스톤: 아직 생성 중인 답변은 Context 로 고를 수 없다 (문장 중간에 끊긴 글이 근거가 되면 안 된다).

    실제 스레드 타이밍에 기대지 않고, 생성 중 상태를 DB에 직접 만들어 확인한다.
    """
    import uuid as uuid_module

    from app.models import BlockGenerationStatus, MessageBlock

    first = send_and_wait(client, auth, chat, "질문")
    block_id = first["assistantBlock"]["blockId"]

    block = db_session.get(MessageBlock, uuid_module.UUID(block_id))
    block.generation_status = BlockGenerationStatus.GENERATING
    db_session.commit()

    res = client.post(
        msg_url(chat),
        json={"userPrompt": "이어서", "contextBlockIds": [block_id]},
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

    first = send_and_wait(client, auth, chat, "질문")
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


# ── 제목 자동 생성 ───────────────────────────────────────────


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

    monkeypatch.setattr(
        modeling, "generate_answer_stream", lambda r, **_kwargs: _stream_of("답변")
    )

    def _boom(prompt, **_kwargs):
        raise RuntimeError("제목 생성 실패")

    monkeypatch.setattr(modeling, "generate_title", _boom)

    body = send_and_wait(client, auth, chat, "질문")
    assert body["assistantBlock"]["content"] == "답변"
    assert body["titleGenerated"] is False
    assert body["chatTitle"] == "새 대화"


# ── 재생성 ─────────────────────────────────────────────────


def regenerate_and_wait(client, auth, chat, block_id: str) -> dict:
    base = (
        f"/api/chats/{chat['chatMeta']['chatId']}"
        f"/branches/{chat['branchMeta']['branchId']}/blocks/{block_id}"
    )
    res = client.post(f"{base}/regenerate", headers=auth)
    assert res.status_code == 200, res.text
    return wait_done(client, auth, chat, block_id)


def test_regenerate_returns_immediately_then_replaces_content(client, auth, chat, captured):
    first = send_and_wait(client, auth, chat, "질문")
    block_id = first["assistantBlock"]["blockId"]
    base = (
        f"/api/chats/{chat['chatMeta']['chatId']}"
        f"/branches/{chat['branchMeta']['branchId']}/blocks/{block_id}"
    )

    immediate = client.post(f"{base}/regenerate", headers=auth).json()
    assert immediate["content"] == ""
    assert immediate["generationStatus"] == "generating"
    assert immediate["jobStatus"] == "generating"


def test_regenerate_adds_version_to_same_block(client, auth, chat, captured):
    first = send_and_wait(client, auth, chat, "질문")
    block_id = first["assistantBlock"]["blockId"]
    base = (
        f"/api/chats/{chat['chatMeta']['chatId']}"
        f"/branches/{chat['branchMeta']['branchId']}/blocks/{block_id}"
    )

    regenerate_and_wait(client, auth, chat, block_id)

    versions = client.get(f"{base}/versions", headers=auth).json()
    assert [v["content"] for v in versions] == ["답변(1)", "답변(2)"]
    assert versions[-1]["sourceType"] == "ai_regenerate"

    final = block_of(client, auth, chat, block_id)
    assert final["blockId"] == block_id
    assert final["content"] == "답변(2)"
    assert final["generationStatus"] == "complete"


def test_regenerate_returns_search_sources(client, auth, chat, captured, monkeypatch):
    import modeling
    from modeling.types import SearchSource

    source = SearchSource("공식 문서", "https://example.com")
    monkeypatch.setattr(
        modeling,
        "generate_answer_stream",
        lambda _request, **_kwargs: _stream_of("검색 답변", [source]),
    )
    first = send_and_wait(client, auth, chat, "검색해줘")
    block_id = first["assistantBlock"]["blockId"]

    final = regenerate_and_wait(client, auth, chat, block_id)
    assert final["searchSources"] == [{"title": source.title, "url": source.url}]

    reopened = client.get(
        f"/api/chats/{chat['chatMeta']['chatId']}?branchId={chat['branchMeta']['branchId']}",
        headers=auth,
    )
    reopened_block = next(
        b for b in reopened.json()["messageBlocks"] if b["blockId"] == block_id
    )
    assert reopened_block["searchSources"] == [{"title": source.title, "url": source.url}]


def test_regenerate_reuses_the_original_question(client, auth, chat, captured):
    send_and_wait(client, auth, chat, "첫 질문")
    second = send_and_wait(client, auth, chat, "두 번째 질문")

    regenerate_and_wait(client, auth, chat, second["assistantBlock"]["blockId"])

    request = captured[-1]
    assert request.user_prompt == "두 번째 질문"
    assert [t.content for t in request.message_flow] == ["첫 질문", "답변(1)"]


def test_regenerate_reuses_context_and_original_snapshot(client, auth, chat, captured):
    first = send_and_wait(client, auth, chat, "기준 내용")
    second = send_and_wait(client, auth, chat, "Context로 답해줘", [first["assistantBlock"]["blockId"]])
    regenerate_and_wait(client, auth, chat, second["assistantBlock"]["blockId"])

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
        yield from _stream_of("복구 답변")

    monkeypatch.setattr(modeling, "generate_answer_stream", flaky)
    failed = client.post(msg_url(chat), json={"userPrompt": "복구할 질문"}, headers=auth)
    assert failed.status_code == 201, failed.text
    job_id = failed.json()["aiResponseJobId"]
    assert wait_done(client, auth, chat, failed.json()["assistantBlock"]["blockId"])["generationStatus"] == "failed"

    retried = client.post(f"{msg_url(chat).removesuffix('/messages')}/ai-response-jobs/{job_id}/retry", headers=auth)
    assert retried.status_code == 201, retried.text
    assert retried.json()["actionMeta"]["successCode"] == "AI_RESPONSE_RETRY_SUCCEEDED"

    block = wait_done(client, auth, chat, retried.json()["assistantBlock"]["blockId"])
    assert block["content"] == "복구 답변"

    # 실패했던 첫 시도 블록은 지우지 않고 남긴다 — 중단된 답변과 같은 원칙이다.
    detail = client.get(f"/api/chats/{chat['chatMeta']['chatId']}", headers=auth).json()
    contents = [b["content"] for b in detail["messageBlocks"]]
    statuses = [b["generationStatus"] for b in detail["messageBlocks"]]
    assert contents == ["복구할 질문", "", "복구 답변"]
    assert statuses == ["complete", "failed", "complete"]


def test_failed_first_question_generates_title_even_though_answer_failed(client, auth, chat, monkeypatch):
    """제목은 질문만 있으면 만들 수 있어, 답변 생성 성공 여부와 무관하게 첫 전송에서 바로 붙는다.

    그래서 재시도는 제목을 다시 만들지 않는다 — 이미 첫 전송에서 만들어졌다.
    """
    import modeling

    calls = [0]

    def flaky(_request, **_kwargs):
        calls[0] += 1
        if calls[0] == 1:
            raise RuntimeError("temporary")
        yield from _stream_of("복구 답변")

    monkeypatch.setattr(modeling, "generate_answer_stream", flaky)
    title_calls = []
    monkeypatch.setattr(
        modeling,
        "generate_title",
        lambda prompt, **_kwargs: title_calls.append(prompt) or "복구 질문 제목",
    )

    failed = client.post(
        msg_url(chat), json={"userPrompt": "복구할 첫 질문"}, headers=auth
    )
    assert failed.status_code == 201, failed.text
    assert failed.json()["titleGenerated"] is True
    assert failed.json()["chatTitle"] == "복구 질문 제목"
    job_id = failed.json()["aiResponseJobId"]
    wait_done(client, auth, chat, failed.json()["assistantBlock"]["blockId"])

    retried = client.post(
        f"{msg_url(chat).removesuffix('/messages')}/ai-response-jobs/{job_id}/retry",
        headers=auth,
    )

    assert retried.status_code == 201
    body = retried.json()
    assert body["titleGenerated"] is False
    assert body["chatTitle"] == "복구 질문 제목"
    assert title_calls == ["복구할 첫 질문"]


def test_legacy_regenerate_does_not_use_default_conditions(
    client, auth, chat, captured, db_session
):
    import uuid
    from sqlalchemy import delete
    from app.models import AiResponseJob

    first = send_and_wait(client, auth, chat, "예전 답변")
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
    """A2: 재생성은 내용을 바꾸므로 하위 브랜치가 이어받은 답변은 그대로 막는다 ."""
    sent = send_and_wait(client, auth, chat, "질문")
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
    first = send_and_wait(client, auth, chat, "질문")
    block_id = first["assistantBlock"]["blockId"]
    base = (
        f"/api/chats/{chat['chatMeta']['chatId']}"
        f"/branches/{chat['branchMeta']['branchId']}/blocks/{block_id}"
    )
    regenerate_and_wait(client, auth, chat, block_id)

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
