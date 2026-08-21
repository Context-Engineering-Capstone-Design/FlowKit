"""다중 창 실시간 동기화 이벤트 채널 테스트 (0821_05).

D1: realtime_service 자체의 구독·발행·구독 해제.
D2: 새 대화 생성·메시지 전송·job 완료가 실제로 이벤트를 발행하는지, 가짜
구독자 큐를 직접 붙여 확인한다.
"""

from __future__ import annotations

import queue
import uuid

from app.routers import auth as auth_router
from app.services import realtime_service
from app.services.google_auth import GoogleUser

USER = GoogleUser("sub-realtime", "realtime@example.com", "실시간테스터", None)


# ── D1: realtime_service 단위 테스트 ────────────────────────────────────


def test_subscribe_receives_published_events():
    user_id = uuid.uuid4()
    q = realtime_service.subscribe(user_id)

    realtime_service.publish_chats_changed(user_id)
    event, data = q.get_nowait()
    assert event == "chats_changed"
    assert data == {}

    chat_id, branch_id, job_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    realtime_service.publish_chat_activity(user_id, chat_id, branch_id, job_id)
    event, data = q.get_nowait()
    assert event == "chat_activity"
    assert data == {"chatId": str(chat_id), "branchId": str(branch_id), "jobId": str(job_id)}


def test_unrelated_user_does_not_receive_events():
    user_id, other_id = uuid.uuid4(), uuid.uuid4()
    realtime_service.subscribe(user_id)
    q_other = realtime_service.subscribe(other_id)

    realtime_service.publish_chats_changed(user_id)
    assert q_other.empty()


def test_unsubscribe_stops_delivery_and_clears_empty_registry():
    user_id = uuid.uuid4()
    q = realtime_service.subscribe(user_id)
    realtime_service.unsubscribe(user_id, q)

    realtime_service.publish_chats_changed(user_id)
    assert q.empty()
    # 구독자가 없어진 사용자는 registry에서 지워져야 한다(메모리 누수 방지).
    assert user_id not in realtime_service._subscribers


# ── D2: 발행 지점 통합 테스트 ────────────────────────────────────────────


def auth_headers(client) -> dict:
    res = client.post("/api/auth/google", json={"idToken": "dummy"})
    return {"Authorization": f"Bearer {res.json()['accessToken']}"}


def test_creating_chat_publishes_chats_changed(client, monkeypatch):
    monkeypatch.setattr(auth_router, "verify_google_id_token", lambda _t: USER)
    auth = auth_headers(client)
    user_id = uuid.UUID(client.get("/api/auth/me", headers=auth).json()["userId"])

    q = realtime_service.subscribe(user_id)
    res = client.post("/api/chats", headers=auth)
    assert res.status_code == 201, res.text

    event, data = q.get_nowait()
    assert event == "chats_changed"
    assert data == {}


def test_sending_message_publishes_activity_with_job_id_then_completion(client, monkeypatch):
    import modeling
    from modeling.types import AnswerChunk, AnswerResult

    # 제목 자동 생성·실제 답변 생성 둘 다 이 테스트의 관심사가 아니다. 실제
    # 네트워크 호출 없이 결정적으로 끝나도록 둘 다 가짜로 바꾼다.
    monkeypatch.setattr(modeling, "generate_title", lambda *_a, **_kw: (_ for _ in ()).throw(RuntimeError("stub")))
    monkeypatch.setattr(
        modeling,
        "generate_answer_stream",
        lambda r, **_kwargs: iter([AnswerChunk(type="done", result=AnswerResult(text="답변", search_sources=[]))]),
    )
    monkeypatch.setattr(auth_router, "verify_google_id_token", lambda _t: USER)
    auth = auth_headers(client)
    user_id = uuid.UUID(client.get("/api/auth/me", headers=auth).json()["userId"])
    assert client.put(
        "/api/settings/api-keys/openai",
        json={"apiKey": "test-api-key-1234567890"},
        headers=auth,
    ).status_code == 200

    chat = client.post("/api/chats", headers=auth).json()
    chat_id = chat["chatMeta"]["chatId"]
    branch_id = chat["branchMeta"]["branchId"]

    q = realtime_service.subscribe(user_id)
    res = client.post(
        f"/api/chats/{chat_id}/branches/{branch_id}/messages",
        json={"userPrompt": "질문"},
        headers=auth,
    )
    assert res.status_code == 201, res.text
    job_id = res.json()["aiResponseJobId"]

    # send_message 안에서 새 채팅 생성(chats_changed)은 이미 구독 전에 끝났으므로,
    # 여기서는 job 시작(chat_activity + jobId)과 완료(chat_activity, chats_changed) 두 쌍만 온다.
    events = []
    try:
        while True:
            events.append(q.get_nowait())
    except queue.Empty:
        pass

    started = next(e for e in events if e[0] == "chat_activity" and e[1].get("jobId") == job_id)
    assert started[1] == {"chatId": chat_id, "branchId": branch_id, "jobId": job_id}

    finished = [e for e in events if e[0] == "chat_activity" and "jobId" not in e[1]]
    assert finished == [("chat_activity", {"chatId": chat_id, "branchId": branch_id})]

    assert ("chats_changed", {}) in events
