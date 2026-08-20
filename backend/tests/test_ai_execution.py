"""AI 실행 관측 테스트 (0820_06 마일스톤 A~D).

실행 시간 기록, Context·첨부·웹 검색 실행 이벤트, 화면 전달 시간 기록,
소유권 검증, 민감정보 비저장을 확인한다.
"""

from __future__ import annotations

import uuid

import pytest

from app.routers import auth as auth_router
from app.services.google_auth import GoogleUser
from modeling.types import AnswerChunk, AnswerResult, SearchSource, TokenUsage

USER = GoogleUser("sub-exec", "exec@example.com", "관측테스터", None)


@pytest.fixture
def auth(client, monkeypatch) -> dict:
    monkeypatch.setattr(auth_router, "verify_google_id_token", lambda _t: USER)
    res = client.post("/api/auth/google", json={"idToken": "dummy"})
    headers = {"Authorization": f"Bearer {res.json()['accessToken']}"}
    assert client.put(
        "/api/settings/api-keys/openai",
        json={"apiKey": "test-api-key-1234567890"},
        headers=headers,
    ).status_code == 200
    return headers


@pytest.fixture
def chat(client, auth) -> dict:
    return client.post("/api/chats", headers=auth).json()


def msg_url(chat: dict) -> str:
    return (
        f"/api/chats/{chat['chatMeta']['chatId']}"
        f"/branches/{chat['branchMeta']['branchId']}/messages"
    )


def execution_url(chat: dict, job_id: str) -> str:
    return (
        f"/api/chats/{chat['chatMeta']['chatId']}"
        f"/branches/{chat['branchMeta']['branchId']}/ai-response-jobs/{job_id}/execution"
    )


def delivery_url(chat: dict, job_id: str) -> str:
    return (
        f"/api/chats/{chat['chatMeta']['chatId']}"
        f"/branches/{chat['branchMeta']['branchId']}/ai-response-jobs/{job_id}/delivery-timing"
    )


# ── 마일스톤 A: 실행 시간 기록 ────────────────────────────────────────────────


def test_completed_job_records_timing_and_usage(client, auth, chat, monkeypatch):
    import modeling

    monkeypatch.setattr(
        modeling,
        "generate_answer_stream",
        lambda r, **_kwargs: iter(
            [
                AnswerChunk(type="text", delta="안녕"),
                AnswerChunk(
                    type="done",
                    result=AnswerResult(
                        text="안녕하세요",
                        search_sources=[],
                        usage=TokenUsage(input_tokens=10, output_tokens=5, total_tokens=15),
                    ),
                ),
            ]
        ),
    )
    body = client.post(msg_url(chat), json={"userPrompt": "질문"}, headers=auth).json()
    job_id = body["aiResponseJobId"]

    summary = client.get(execution_url(chat, job_id), headers=auth).json()
    assert summary["generationStartedAt"] is not None
    assert summary["firstChunkAt"] is not None
    assert summary["finishedAt"] is not None
    assert summary["usage"]["measured"] is True
    assert summary["usage"]["inputTokens"] == 10
    assert summary["usage"]["outputTokens"] == 5
    assert summary["usage"]["totalTokens"] == 15
    # 실제 단가표가 없으면 비용은 미측정으로 남는다(D4).
    assert summary["usage"]["costAmount"] is None


def test_empty_response_has_no_first_chunk_but_has_finished_at(client, auth, chat, monkeypatch):
    """첫 조각 없이 실패한 경우를 구분한다 (A4)."""
    import modeling

    monkeypatch.setattr(
        modeling,
        "generate_answer_stream",
        lambda r, **_kwargs: iter([AnswerChunk(type="error", error="모델 호출 실패")]),
    )
    body = client.post(msg_url(chat), json={"userPrompt": "질문"}, headers=auth).json()
    job_id = body["aiResponseJobId"]

    summary = client.get(execution_url(chat, job_id), headers=auth).json()
    assert summary["status"] == "failed"
    assert summary["firstChunkAt"] is None
    assert summary["finishedAt"] is not None
    assert summary["usage"]["measured"] is False


def test_no_usage_metadata_is_reported_as_unmeasured(client, auth, chat, monkeypatch):
    import modeling

    monkeypatch.setattr(
        modeling,
        "generate_answer_stream",
        lambda r, **_kwargs: iter(
            [AnswerChunk(type="done", result=AnswerResult(text="답변", search_sources=[]))]
        ),
    )
    body = client.post(msg_url(chat), json={"userPrompt": "질문"}, headers=auth).json()
    job_id = body["aiResponseJobId"]

    summary = client.get(execution_url(chat, job_id), headers=auth).json()
    assert summary["usage"] == {
        "measured": False,
        "inputTokens": None,
        "outputTokens": None,
        "totalTokens": None,
        "model": None,
        "provider": None,
        "costAmount": None,
        "costCurrency": None,
        "pricingVersion": None,
        "pricingEffectiveAt": None,
    }


def test_cleanup_sets_finished_at_without_generation_timing(client, auth, chat, db_session):
    """서버 재시작 정리는 완료 시각이 아니라 정리 시각만 남긴다 (A3)."""
    from app.models import AiResponseJob, AiResponseJobStatus
    from app.services import ai_response_service

    body = client.post(msg_url(chat), json={"userPrompt": "질문"}, headers=auth).json()
    job_id = uuid.UUID(body["aiResponseJobId"])

    job = db_session.get(AiResponseJob, job_id)
    job.status = AiResponseJobStatus.GENERATING
    job.generation_started_at = None
    job.first_chunk_at = None
    job.finished_at = None
    db_session.commit()

    assert ai_response_service.cleanup_stuck_jobs(db_session) == 1
    db_session.refresh(job)
    assert job.finished_at is not None
    assert job.generation_started_at is None
    assert job.first_chunk_at is None
    assert job.error_code == "AI_SERVER_RESTARTED"


# ── 마일스톤 B: 도구·근거 실행 기록 ────────────────────────────────────────────


def test_context_and_attachment_events_are_recorded(client, auth, chat, monkeypatch):
    import modeling

    monkeypatch.setattr(
        modeling,
        "generate_answer_stream",
        lambda r, **_kwargs: iter(
            [AnswerChunk(type="done", result=AnswerResult(text="답변", search_sources=[]))]
        ),
    )
    # Context로 쓸 이전 답변을 하나 만든다.
    first = client.post(msg_url(chat), json={"userPrompt": "첫 질문"}, headers=auth).json()
    context_block_id = first["assistantBlock"]["blockId"]

    body = client.post(
        msg_url(chat),
        json={"userPrompt": "두번째 질문", "contextBlockIds": [context_block_id]},
        headers=auth,
    ).json()
    job_id = body["aiResponseJobId"]

    summary = client.get(execution_url(chat, job_id), headers=auth).json()
    kinds = {e["kind"] for e in summary["events"]}
    assert "context_read" in kinds
    assert "attachment_read" not in kinds  # 첨부를 안 썼으면 기록하지 않는다
    context_event = next(e for e in summary["events"] if e["kind"] == "context_read")
    assert context_event["status"] == "completed"
    assert context_event["summary"]["block_count"] == 1
    # 원문은 담지 않는다 — 식별자만.
    assert "content" not in context_event["summary"]
    assert "첫 질문" not in str(context_event["summary"])


def test_web_search_off_records_no_event(client, auth, chat, monkeypatch):
    import modeling

    monkeypatch.setattr(
        modeling,
        "generate_answer_stream",
        lambda r, **_kwargs: iter(
            [AnswerChunk(type="done", result=AnswerResult(text="답변", search_sources=[]))]
        ),
    )
    body = client.post(
        msg_url(chat), json={"userPrompt": "질문", "webSearchMode": "off"}, headers=auth
    ).json()
    job_id = body["aiResponseJobId"]

    summary = client.get(execution_url(chat, job_id), headers=auth).json()
    assert not any(e["kind"] == "web_search" for e in summary["events"])


def test_web_search_with_sources_is_completed(client, auth, chat, monkeypatch):
    import modeling

    source = SearchSource("공식 문서", "https://example.com")
    monkeypatch.setattr(
        modeling,
        "generate_answer_stream",
        lambda r, **_kwargs: iter(
            [AnswerChunk(type="done", result=AnswerResult(text="답변", search_sources=[source]))]
        ),
    )
    body = client.post(
        msg_url(chat), json={"userPrompt": "질문", "webSearchMode": "auto"}, headers=auth
    ).json()
    job_id = body["aiResponseJobId"]

    summary = client.get(execution_url(chat, job_id), headers=auth).json()
    event = next(e for e in summary["events"] if e["kind"] == "web_search")
    assert event["status"] == "completed"
    assert event["summary"]["source_count"] == 1
    assert event["summary"]["mode"] == "auto"


def test_web_search_without_sources_or_signal_is_unknown(client, auth, chat, monkeypatch):
    """도구를 붙였다는 사실과 실제 검색은 다르다 — 추정하지 않는다 (B5)."""
    import modeling

    monkeypatch.setattr(
        modeling,
        "generate_answer_stream",
        lambda r, **_kwargs: iter(
            [AnswerChunk(type="done", result=AnswerResult(text="답변", search_sources=[]))]
        ),
    )
    body = client.post(
        msg_url(chat), json={"userPrompt": "질문", "webSearchMode": "auto"}, headers=auth
    ).json()
    job_id = body["aiResponseJobId"]

    summary = client.get(execution_url(chat, job_id), headers=auth).json()
    event = next(e for e in summary["events"] if e["kind"] == "web_search")
    assert event["status"] == "unknown"
    assert event["summary"]["provider_signal"] is False


def test_web_search_provider_signal_without_sources_is_completed(client, auth, chat, monkeypatch):
    """근거 인용이 없어도 공급자가 실제 실행을 알려주면 completed다 (B4)."""
    import modeling

    monkeypatch.setattr(
        modeling,
        "generate_answer_stream",
        lambda r, **_kwargs: iter(
            [
                AnswerChunk(
                    type="done",
                    result=AnswerResult(text="답변", search_sources=[], web_search_invoked=True),
                )
            ]
        ),
    )
    body = client.post(
        msg_url(chat), json={"userPrompt": "질문", "webSearchMode": "always"}, headers=auth
    ).json()
    job_id = body["aiResponseJobId"]

    summary = client.get(execution_url(chat, job_id), headers=auth).json()
    event = next(e for e in summary["events"] if e["kind"] == "web_search")
    assert event["status"] == "completed"
    assert event["summary"]["provider_signal"] is True


def test_execution_summary_rejects_other_users_job(client, auth, chat, monkeypatch):
    import modeling

    monkeypatch.setattr(
        modeling,
        "generate_answer_stream",
        lambda r, **_kwargs: iter(
            [AnswerChunk(type="done", result=AnswerResult(text="답변", search_sources=[]))]
        ),
    )
    body = client.post(msg_url(chat), json={"userPrompt": "질문"}, headers=auth).json()
    job_id = body["aiResponseJobId"]

    other = GoogleUser("sub-exec-y", "exec-y@example.com", "다른사람", None)
    monkeypatch.setattr(auth_router, "verify_google_id_token", lambda _t: other)
    token = client.post("/api/auth/google", json={"idToken": "x"}).json()["accessToken"]

    res = client.get(
        execution_url(chat, job_id), headers={"Authorization": f"Bearer {token}"}
    )
    assert res.status_code == 403
    assert res.json()["errorCode"] == "CHAT_ACCESS_DENIED"


# ── 마일스톤 C: 화면 전달 시간 ────────────────────────────────────────────────


def test_delivery_timing_is_recorded_and_readable(client, auth, chat, monkeypatch):
    import modeling

    monkeypatch.setattr(
        modeling,
        "generate_answer_stream",
        lambda r, **_kwargs: iter(
            [AnswerChunk(type="done", result=AnswerResult(text="답변", search_sources=[]))]
        ),
    )
    body = client.post(msg_url(chat), json={"userPrompt": "질문"}, headers=auth).json()
    job_id = body["aiResponseJobId"]

    payload = {
        "clickedAt": "2026-08-20T09:00:00Z",
        "blockShownAt": "2026-08-20T09:00:00.100Z",
        "streamConnectedAt": "2026-08-20T09:00:00.300Z",
        "firstChunkShownAt": "2026-08-20T09:00:01.000Z",
        "doneAt": "2026-08-20T09:00:02.000Z",
        "reconnectCount": 0,
        "finalOutcome": "completed",
    }
    res = client.post(delivery_url(chat, job_id), json=payload, headers=auth)
    assert res.status_code == 200, res.text
    assert res.json()["recorded"] is True

    summary = client.get(execution_url(chat, job_id), headers=auth).json()
    assert summary["delivery"]["finalOutcome"] == "completed"
    assert summary["delivery"]["reconnectCount"] == 0
    assert summary["delivery"]["firstChunkShownAt"] is not None


def test_delivery_timing_resend_overwrites_single_row(client, auth, chat, monkeypatch):
    import modeling

    monkeypatch.setattr(
        modeling,
        "generate_answer_stream",
        lambda r, **_kwargs: iter(
            [AnswerChunk(type="done", result=AnswerResult(text="답변", search_sources=[]))]
        ),
    )
    body = client.post(msg_url(chat), json={"userPrompt": "질문"}, headers=auth).json()
    job_id = body["aiResponseJobId"]

    first_payload = {"finalOutcome": "failed", "reconnectCount": 1}
    client.post(delivery_url(chat, job_id), json=first_payload, headers=auth)
    second_payload = {"finalOutcome": "completed", "reconnectCount": 2}
    client.post(delivery_url(chat, job_id), json=second_payload, headers=auth)

    summary = client.get(execution_url(chat, job_id), headers=auth).json()
    assert summary["delivery"]["finalOutcome"] == "completed"
    assert summary["delivery"]["reconnectCount"] == 2


def test_delivery_timing_rejects_unknown_fields(client, auth, chat, monkeypatch):
    import modeling

    monkeypatch.setattr(
        modeling,
        "generate_answer_stream",
        lambda r, **_kwargs: iter(
            [AnswerChunk(type="done", result=AnswerResult(text="답변", search_sources=[]))]
        ),
    )
    body = client.post(msg_url(chat), json={"userPrompt": "질문"}, headers=auth).json()
    job_id = body["aiResponseJobId"]

    res = client.post(
        delivery_url(chat, job_id),
        json={"finalOutcome": "completed", "questionText": "질문 원문"},
        headers=auth,
    )
    assert res.status_code == 422
