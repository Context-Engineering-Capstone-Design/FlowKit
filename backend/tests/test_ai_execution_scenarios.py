"""0820_06 마일스톤 D: 고정 시나리오 검증과 내부용 비교 요약.

여덟 개 고정 시나리오(짧은 대화, 긴 설명, Context 적용, 첨부 사용, 검색
미사용, 검색 사용, 중단, 재접속) 각각에서 첫 글자까지 시간·완료 시간·실행
이벤트·오류·중단 상태를 확인한다(D2). 실제 API 키 없이 가짜 모델로 돈다.
"""

from __future__ import annotations

import threading
import time
import uuid

import pytest

from app.routers import auth as auth_router
from app.services.google_auth import GoogleUser
from modeling.types import AnswerChunk, AnswerResult, SearchSource

USER = GoogleUser("sub-scenario", "scenario@example.com", "시나리오테스터", None)


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


def job_action_url(chat: dict, job_id: str, action: str) -> str:
    return (
        f"/api/chats/{chat['chatMeta']['chatId']}"
        f"/branches/{chat['branchMeta']['branchId']}/ai-response-jobs/{job_id}/{action}"
    )


# ── D1, D2: 여덟 개 고정 시나리오 ─────────────────────────────────────────────


def test_scenario_short_conversation(client, auth, chat, monkeypatch):
    """짧은 대화: 첫 조각·완료 시각이 모두 있고 상태는 completed다."""
    import modeling

    monkeypatch.setattr(
        modeling,
        "generate_answer_stream",
        lambda r, **_kwargs: iter(
            [AnswerChunk(type="text", delta="네"), AnswerChunk(type="done", result=AnswerResult(text="네", search_sources=[]))]
        ),
    )
    body = client.post(msg_url(chat), json={"userPrompt": "안녕"}, headers=auth).json()
    summary = client.get(execution_url(chat, body["aiResponseJobId"]), headers=auth).json()

    assert summary["status"] == "completed"
    assert summary["firstChunkAt"] is not None
    assert summary["finishedAt"] is not None


def test_scenario_long_explanation(client, auth, chat, monkeypatch):
    """긴 설명: 여러 조각에 걸쳐 만들어져도 시간 기록은 동일한 규칙을 따른다."""
    import modeling

    long_chunks = [AnswerChunk(type="text", delta="문단 " * 20) for _ in range(5)]
    monkeypatch.setattr(
        modeling,
        "generate_answer_stream",
        lambda r, **_kwargs: iter(
            [*long_chunks, AnswerChunk(type="done", result=AnswerResult(text=("문단 " * 20) * 5, search_sources=[]))]
        ),
    )
    body = client.post(msg_url(chat), json={"userPrompt": "자세히 설명해줘"}, headers=auth).json()
    summary = client.get(execution_url(chat, body["aiResponseJobId"]), headers=auth).json()

    assert summary["status"] == "completed"
    assert summary["firstChunkAt"] is not None


def test_scenario_context_applied(client, auth, chat, monkeypatch):
    """Context 적용: context_read 이벤트가 남고 선택 블록 수가 맞는다."""
    import modeling

    monkeypatch.setattr(
        modeling,
        "generate_answer_stream",
        lambda r, **_kwargs: iter([AnswerChunk(type="done", result=AnswerResult(text="답변", search_sources=[]))]),
    )
    first = client.post(msg_url(chat), json={"userPrompt": "첫 질문"}, headers=auth).json()
    body = client.post(
        msg_url(chat),
        json={"userPrompt": "두번째 질문", "contextBlockIds": [first["assistantBlock"]["blockId"]]},
        headers=auth,
    ).json()
    summary = client.get(execution_url(chat, body["aiResponseJobId"]), headers=auth).json()

    event = next(e for e in summary["events"] if e["kind"] == "context_read")
    assert event["status"] == "completed"
    assert event["summary"]["block_count"] == 1


def test_scenario_attachment_used(client, auth, chat, monkeypatch):
    """첨부 사용: attachment_read 이벤트에 형식·크기만 남고 파일 본문은 없다."""
    import modeling

    uploaded = client.post(
        f"/api/chats/{chat['chatMeta']['chatId']}/attachments",
        files={"file": ("notes.md", "비밀 첨부 본문".encode(), "text/markdown")},
        headers=auth,
    ).json()
    monkeypatch.setattr(
        modeling,
        "generate_answer_stream",
        lambda r, **_kwargs: iter([AnswerChunk(type="done", result=AnswerResult(text="답변", search_sources=[]))]),
    )
    body = client.post(
        msg_url(chat),
        json={"userPrompt": "첨부를 읽어줘", "attachmentIds": [uploaded["attachmentId"]]},
        headers=auth,
    ).json()
    summary = client.get(execution_url(chat, body["aiResponseJobId"]), headers=auth).json()

    event = next(e for e in summary["events"] if e["kind"] == "attachment_read")
    assert event["summary"]["count"] == 1
    assert event["summary"]["items"][0]["file_type"] == "text/markdown"
    assert "비밀" not in str(event["summary"])


def test_scenario_search_not_used(client, auth, chat, monkeypatch):
    """검색 미사용: webSearchMode off면 web_search 이벤트 자체가 없다."""
    import modeling

    monkeypatch.setattr(
        modeling,
        "generate_answer_stream",
        lambda r, **_kwargs: iter([AnswerChunk(type="done", result=AnswerResult(text="답변", search_sources=[]))]),
    )
    body = client.post(
        msg_url(chat), json={"userPrompt": "질문", "webSearchMode": "off"}, headers=auth
    ).json()
    summary = client.get(execution_url(chat, body["aiResponseJobId"]), headers=auth).json()

    assert not any(e["kind"] == "web_search" for e in summary["events"])


def test_scenario_search_used(client, auth, chat, monkeypatch):
    """검색 사용: 근거가 있으면 web_search 이벤트가 completed로 남는다."""
    import modeling

    source = SearchSource("공식 문서", "https://example.com")
    monkeypatch.setattr(
        modeling,
        "generate_answer_stream",
        lambda r, **_kwargs: iter([AnswerChunk(type="done", result=AnswerResult(text="답변", search_sources=[source]))]),
    )
    body = client.post(
        msg_url(chat), json={"userPrompt": "질문", "webSearchMode": "always"}, headers=auth
    ).json()
    summary = client.get(execution_url(chat, body["aiResponseJobId"]), headers=auth).json()

    event = next(e for e in summary["events"] if e["kind"] == "web_search")
    assert event["status"] == "completed"


def test_scenario_cancelled(client, auth, chat, monkeypatch):
    """중단: 첫 조각은 있지만 완료가 아니라 중단으로 끝난다."""
    import modeling
    from app.services import ai_response_service

    monkeypatch.setattr(ai_response_service, "run_jobs_synchronously", False)
    paused, resume = threading.Event(), threading.Event()

    def _slow(request, **_kwargs):
        yield AnswerChunk(type="text", delta="시작")
        paused.set()
        resume.wait(timeout=5)
        yield AnswerChunk(type="text", delta="계속")

    monkeypatch.setattr(modeling, "generate_answer_stream", _slow)
    body = client.post(msg_url(chat), json={"userPrompt": "질문"}, headers=auth).json()
    job_id = body["aiResponseJobId"]
    assert paused.wait(timeout=2)

    threading.Thread(target=lambda: (time.sleep(0.05), resume.set()), daemon=True).start()
    res = client.post(job_action_url(chat, job_id, "cancel"), headers=auth)
    assert res.status_code == 200, res.text

    deadline = time.monotonic() + 2
    summary = client.get(execution_url(chat, job_id), headers=auth).json()
    while summary["status"] == "generating" and time.monotonic() < deadline:
        time.sleep(0.01)
        summary = client.get(execution_url(chat, job_id), headers=auth).json()

    assert summary["status"] == "cancelled"
    assert summary["firstChunkAt"] is not None
    assert summary["finishedAt"] is not None


def test_scenario_reconnect_mid_generation(client, auth, chat, monkeypatch):
    """재접속: 진행 중에 다시 붙어도 서버 실행 기록은 그대로 조회된다."""
    import modeling
    from app.services import ai_response_service

    monkeypatch.setattr(ai_response_service, "run_jobs_synchronously", False)
    paused, resume = threading.Event(), threading.Event()

    def _slow(request, **_kwargs):
        yield AnswerChunk(type="text", delta="진행")
        paused.set()
        resume.wait(timeout=5)
        yield AnswerChunk(type="done", result=AnswerResult(text="진행 완료", search_sources=[]))

    monkeypatch.setattr(modeling, "generate_answer_stream", _slow)
    body = client.post(msg_url(chat), json={"userPrompt": "질문"}, headers=auth).json()
    job_id = body["aiResponseJobId"]
    assert paused.wait(timeout=2)

    # 도중에 실행 요약을 다시 조회한다 (새로고침 뒤 재접속을 흉내).
    mid_summary = client.get(execution_url(chat, job_id), headers=auth).json()
    assert mid_summary["status"] == "generating"
    assert mid_summary["firstChunkAt"] is not None
    assert mid_summary["finishedAt"] is None

    resume.set()
    deadline = time.monotonic() + 2
    final_summary = client.get(execution_url(chat, job_id), headers=auth).json()
    while final_summary["status"] == "generating" and time.monotonic() < deadline:
        time.sleep(0.01)
        final_summary = client.get(execution_url(chat, job_id), headers=auth).json()

    assert final_summary["status"] == "completed"
    assert final_summary["finishedAt"] is not None


# ── D3: 추론 단계·모델·검색 모드별 내부용 비교 요약 ────────────────────────────


def test_comparison_report_lines_up_model_effort_and_search_mode(client, auth, chat, monkeypatch, db_session):
    import modeling
    from app.models import AiResponseJob
    from app.services import ai_execution_service

    source = SearchSource("문서", "https://example.com")

    def _answer(model_id, mode, has_source):
        def _gen(request, **_kwargs):
            yield AnswerChunk(
                type="done",
                result=AnswerResult(text="답변", search_sources=[source] if has_source else []),
            )
        return _gen

    monkeypatch.setattr(modeling, "generate_answer_stream", _answer("gpt-5.6-terra", "off", False))
    j1 = client.post(
        msg_url(chat),
        json={"userPrompt": "질문1", "selectedModelId": "gpt-5.6-terra", "reasoningEffort": "low", "webSearchMode": "off"},
        headers=auth,
    ).json()["aiResponseJobId"]

    monkeypatch.setattr(modeling, "generate_answer_stream", _answer("gpt-5.6-sol", "always", True))
    j2 = client.post(
        msg_url(chat),
        json={"userPrompt": "질문2", "selectedModelId": "gpt-5.6-sol", "reasoningEffort": "high", "webSearchMode": "always"},
        headers=auth,
    ).json()["aiResponseJobId"]

    jobs = [db_session.get(AiResponseJob, uuid.UUID(j1)), db_session.get(AiResponseJob, uuid.UUID(j2))]
    report = ai_execution_service.build_comparison_report(db_session, jobs)

    assert len(report) == 2
    by_model = {row["model"]: row for row in report}
    assert by_model["gpt-5.6-terra"]["reasoning_effort"] == "low"
    assert by_model["gpt-5.6-terra"]["web_search_mode"] == "off"
    assert "web_search" not in by_model["gpt-5.6-terra"]["event_kinds"]
    assert by_model["gpt-5.6-sol"]["reasoning_effort"] == "high"
    assert "web_search" in by_model["gpt-5.6-sol"]["event_kinds"]
    for row in report:
        assert row["total_latency_seconds"] is not None
        # 원문은 요약 어디에도 없어야 한다.
        assert "질문1" not in str(row) and "질문2" not in str(row)
