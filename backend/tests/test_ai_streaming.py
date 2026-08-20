"""답변 스트리밍 통로 테스트 (BE-AIRESP-007~009).

send()/receive 흐름은 test_conversation.py 에서 검증한다. 여기서는 이
마일스톤에서 새로 생긴 것만 다룬다: 중단, 도중 합류(재접속), 서버 재시작
후 정리.
"""

from __future__ import annotations

import threading
import time
import uuid

import pytest

from app.routers import auth as auth_router
from app.services.google_auth import GoogleUser
from modeling.types import AnswerChunk

USER = GoogleUser("sub-stream", "stream@example.com", "스트림테스터", None)


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


def job_action_url(chat: dict, job_id: str, action: str) -> str:
    return (
        f"/api/chats/{chat['chatMeta']['chatId']}"
        f"/branches/{chat['branchMeta']['branchId']}/ai-response-jobs/{job_id}/{action}"
    )


def block_of(client, auth, chat: dict, block_id: str) -> dict:
    detail = client.get(f"/api/chats/{chat['chatMeta']['chatId']}", headers=auth)
    return next(b for b in detail.json()["messageBlocks"] if b["blockId"] == block_id)


def wait_done(client, auth, chat: dict, block_id: str, timeout: float = 2.0) -> dict:
    deadline = time.monotonic() + timeout
    block = block_of(client, auth, chat, block_id)
    while block["generationStatus"] == "generating" and time.monotonic() < deadline:
        time.sleep(0.01)
        block = block_of(client, auth, chat, block_id)
    return block


# ── BE-AIRESP-008: 중단 ──────────────────────────────────────────────────


def test_cancel_mid_generation_keeps_partial_content(client, auth, chat, monkeypatch):
    """중단하면 그때까지 만들어진 본문이 남고, 블록·작업 상태가 cancelled 로 바뀐다."""
    import modeling
    from app.services import ai_response_service

    monkeypatch.setattr(ai_response_service, "run_jobs_synchronously", False)

    paused = threading.Event()
    resume = threading.Event()

    def _slow(request, **_kwargs):
        yield AnswerChunk(type="text", delta="안녕")
        paused.set()
        resume.wait(timeout=5)
        yield AnswerChunk(type="text", delta="하세요")
        # 이 시점에서 실행 쪽이 취소 요청을 확인하고 멈춘다 — done 조각까지는 못 간다.

    monkeypatch.setattr(modeling, "generate_answer_stream", _slow)

    body = client.post(msg_url(chat), json={"userPrompt": "질문"}, headers=auth).json()
    block_id = body["assistantBlock"]["blockId"]
    job_id = body["aiResponseJobId"]
    assert paused.wait(timeout=2)

    # 취소 요청 스레드가 응답을 기다리는 동안, 멈춰 있던 생성 쪽을 풀어준다.
    threading.Thread(target=lambda: (time.sleep(0.05), resume.set()), daemon=True).start()

    res = client.post(job_action_url(chat, job_id, "cancel"), headers=auth)
    assert res.status_code == 200, res.text
    assert res.json()["generationStatus"] == "cancelled"
    assert res.json()["content"] == "안녕하세요"

    final = wait_done(client, auth, chat, block_id)
    assert final["generationStatus"] == "cancelled"
    assert final["content"] == "안녕하세요"


def test_cancel_on_already_finished_job_is_a_no_op(client, auth, chat, monkeypatch):
    """이미 끝난 작업을 중단해도 오류 없이 지금 상태를 그대로 돌려준다."""
    import modeling
    from modeling.types import AnswerResult

    monkeypatch.setattr(
        modeling,
        "generate_answer_stream",
        lambda r, **_kwargs: iter([AnswerChunk(type="done", result=AnswerResult(text="답변", search_sources=[]))]),
    )
    body = client.post(msg_url(chat), json={"userPrompt": "질문"}, headers=auth).json()
    job_id = body["aiResponseJobId"]

    res = client.post(job_action_url(chat, job_id, "cancel"), headers=auth)
    assert res.status_code == 200, res.text
    assert res.json()["generationStatus"] == "complete"
    assert res.json()["content"] == "답변"


def test_cancel_rejects_other_users_job(client, auth, chat, monkeypatch):
    import modeling
    from modeling.types import AnswerResult

    monkeypatch.setattr(
        modeling,
        "generate_answer_stream",
        lambda r, **_kwargs: iter([AnswerChunk(type="done", result=AnswerResult(text="답변", search_sources=[]))]),
    )
    body = client.post(msg_url(chat), json={"userPrompt": "질문"}, headers=auth).json()
    job_id = body["aiResponseJobId"]

    other = GoogleUser("sub-stream-y", "stream-y@example.com", "다른사람", None)
    monkeypatch.setattr(auth_router, "verify_google_id_token", lambda _t: other)
    token = client.post("/api/auth/google", json={"idToken": "x"}).json()["accessToken"]

    res = client.post(
        job_action_url(chat, job_id, "cancel"),
        headers={"Authorization": f"Bearer {token}"},
    )
    # 채팅 소유권 검증이 작업 조회보다 먼저 걸린다 (다른 사람의 채팅이므로 403).
    assert res.status_code == 403
    assert res.json()["errorCode"] == "CHAT_ACCESS_DENIED"


# ── BE-AIRESP-009: 새로고침·브랜치 재진입 시 다시 붙기 위한 job id 노출 ──────


def test_chat_detail_exposes_job_id_only_while_generating(client, auth, chat, db_session):
    """진행 중인 답변 블록에만 generationJobId 가 실려야, 화면이 어디에 다시 붙을지 안다."""
    import uuid as uuid_module

    from app.models import AiResponseJob, AiResponseJobStatus, BlockGenerationStatus, MessageBlock

    body = client.post(msg_url(chat), json={"userPrompt": "질문"}, headers=auth).json()
    block_id = uuid_module.UUID(body["assistantBlock"]["blockId"])
    job_id = uuid_module.UUID(body["aiResponseJobId"])

    # 동기 테스트라 이미 끝나 있다 — "아직 생성 중"인 상황을 흉내 낸다.
    job = db_session.get(AiResponseJob, job_id)
    job.status = AiResponseJobStatus.GENERATING
    block = db_session.get(MessageBlock, block_id)
    block.generation_status = BlockGenerationStatus.GENERATING
    db_session.commit()

    detail = client.get(f"/api/chats/{chat['chatMeta']['chatId']}", headers=auth).json()
    blocks = {b["blockId"]: b for b in detail["messageBlocks"]}
    assert blocks[str(block_id)]["generationJobId"] == str(job_id)
    # 사용자 질문 블록(완료 상태)에는 없어야 한다.
    user_block_id = body["userBlock"]["blockId"]
    assert blocks[user_block_id]["generationJobId"] is None


# ── BE-AIRESP-007, 009: 중계와 도중 합류 ──────────────────────────────────


def test_stream_of_finished_job_replays_final_state_once(client, auth, chat, monkeypatch):
    """B6: 이미 끝난 작업에 붙으면 지금까지 쌓인 조각이 아니라 완료 상태 하나만 온다.

    테스트는 동기 실행이라(conftest) 전송이 돌아올 때 이미 작업이 끝나 있고
    메모리 중계에서도 빠져 있다 — 그래서 DB 기준 마지막 상태를 본다.
    """
    import modeling
    from modeling.types import AnswerResult, SearchSource

    source = SearchSource("공식 문서", "https://example.com")
    monkeypatch.setattr(
        modeling,
        "generate_answer_stream",
        lambda r, **_kwargs: iter(
            [AnswerChunk(type="done", result=AnswerResult(text="완료된 답변", search_sources=[source]))]
        ),
    )
    body = client.post(msg_url(chat), json={"userPrompt": "질문"}, headers=auth).json()
    job_id = body["aiResponseJobId"]

    with client.stream("GET", job_action_url(chat, job_id, "stream"), headers=auth) as res:
        assert res.status_code == 200
        text = "".join(res.iter_text())

    assert "event: status" in text
    assert '"status": "completed"' in text
    assert "완료된 답변" in text
    assert "event: text" not in text


def test_stream_rejects_other_users_job(client, auth, chat, monkeypatch):
    import modeling
    from modeling.types import AnswerResult

    monkeypatch.setattr(
        modeling,
        "generate_answer_stream",
        lambda r, **_kwargs: iter([AnswerChunk(type="done", result=AnswerResult(text="답변", search_sources=[]))]),
    )
    body = client.post(msg_url(chat), json={"userPrompt": "질문"}, headers=auth).json()
    job_id = body["aiResponseJobId"]

    other = GoogleUser("sub-stream-z", "stream-z@example.com", "다른사람", None)
    monkeypatch.setattr(auth_router, "verify_google_id_token", lambda _t: other)
    token = client.post("/api/auth/google", json={"idToken": "x"}).json()["accessToken"]

    res = client.get(
        job_action_url(chat, job_id, "stream"),
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 403
    assert res.json()["errorCode"] == "CHAT_ACCESS_DENIED"


# ── B7: 서버 재시작 후 정리 ────────────────────────────────────────────────


def test_cleanup_marks_stuck_generating_jobs_as_failed(client, auth, chat, db_session):
    """서버가 내려갔다 올라오면, 그사이 GENERATING으로 멈춘 작업은 실패로 정리된다."""
    import modeling
    from modeling.types import AnswerChunk as _Chunk

    def _never_returns(request, **_kwargs):
        yield _Chunk(type="text", delta="시작")
        raise AssertionError("cleanup 테스트는 이 지점까지 오면 안 된다")

    # send_message가 스레드를 실제로 안 띄우게, 잡만 만들고 바로 GENERATING으로 둔다.
    from app.models import AiResponseJob, AiResponseJobStatus, BlockGenerationStatus, MessageBlock
    from app.services import ai_response_service

    body = client.post(msg_url(chat), json={"userPrompt": "질문"}, headers=auth)
    # 정상 흐름대로 하나 보낸 뒤, 그 작업 상태를 "서버가 죽기 직전"처럼 강제로 되돌린다.
    job_id = uuid.UUID(body.json()["aiResponseJobId"])
    block_id = uuid.UUID(body.json()["assistantBlock"]["blockId"])

    job = db_session.get(AiResponseJob, job_id)
    job.status = AiResponseJobStatus.GENERATING
    block = db_session.get(MessageBlock, block_id)
    block.generation_status = BlockGenerationStatus.GENERATING
    db_session.commit()

    cleaned = ai_response_service.cleanup_stuck_jobs(db_session)
    assert cleaned == 1

    db_session.refresh(job)
    db_session.refresh(block)
    assert job.status is AiResponseJobStatus.FAILED
    assert job.error_code == "AI_SERVER_RESTARTED"
    assert block.generation_status is BlockGenerationStatus.FAILED


def test_cleanup_leaves_finished_jobs_alone(client, auth, chat, db_session, monkeypatch):
    import modeling
    from modeling.types import AnswerResult
    from app.models import AiResponseJob, AiResponseJobStatus
    from app.services import ai_response_service

    monkeypatch.setattr(
        modeling,
        "generate_answer_stream",
        lambda r, **_kwargs: iter([AnswerChunk(type="done", result=AnswerResult(text="답변", search_sources=[]))]),
    )
    body = client.post(msg_url(chat), json={"userPrompt": "질문"}, headers=auth).json()
    job_id = uuid.UUID(body["aiResponseJobId"])

    assert ai_response_service.cleanup_stuck_jobs(db_session) == 0
    job = db_session.get(AiResponseJob, job_id)
    assert job.status is AiResponseJobStatus.COMPLETED
