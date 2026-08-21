"""같은 계정의 다른 창에 "다시 확인해봐" 신호를 보내는 통로 (0821_05).

streaming_service.py와 같은 구조(락으로 보호된 registry, 구독자별 큐)를
쓰되 키를 job_id가 아니라 user_id로 바꿨다. 이벤트에 데이터를 직접 담지
않고 무효화 신호만 보낸다 — 실제 상태(사이드바 배지, 대화 내용)는 구독자가
다시 조회해서 얻으므로 항상 DB와 일치한다.

streaming_service.py와 마찬가지로 프로세스 하나짜리 메모리 registry다.
서버가 재시작되면 모든 구독이 끊기고, 프론트의 재연결이 놓친 변화를
loadChats 강제 호출로 보정한다.
"""

from __future__ import annotations

import queue
import threading
import uuid
from typing import Any, Literal

EventType = Literal["chats_changed", "chat_activity"]

_subscribers: dict[uuid.UUID, list[queue.Queue]] = {}
_lock = threading.Lock()


def subscribe(user_id: uuid.UUID) -> queue.Queue:
    """그 사용자의 구독자 목록에 새 큐를 등록하고 돌려준다."""
    q: queue.Queue = queue.Queue()
    with _lock:
        _subscribers.setdefault(user_id, []).append(q)
    return q


def unsubscribe(user_id: uuid.UUID, q: queue.Queue) -> None:
    """연결이 끊기면 목록에서 뺀다. 구독자가 없어진 사용자는 registry에서 지운다."""
    with _lock:
        subs = _subscribers.get(user_id)
        if subs is None:
            return
        if q in subs:
            subs.remove(q)
        if not subs:
            _subscribers.pop(user_id, None)


def publish_chats_changed(user_id: uuid.UUID) -> None:
    """사이드바 목록을 다시 조회하라는 신호."""
    _broadcast(user_id, "chats_changed", {})


def publish_chat_activity(
    user_id: uuid.UUID,
    chat_id: uuid.UUID,
    branch_id: uuid.UUID,
    job_id: uuid.UUID | None = None,
) -> None:
    """특정 대화·브랜치를 다시 조회하라는 신호. job_id가 있으면 그 job 스트림에 붙으라는 뜻."""
    data: dict[str, Any] = {"chatId": str(chat_id), "branchId": str(branch_id)}
    if job_id is not None:
        data["jobId"] = str(job_id)
    _broadcast(user_id, "chat_activity", data)


def _broadcast(user_id: uuid.UUID, event: EventType, data: dict[str, Any]) -> None:
    with _lock:
        subs = list(_subscribers.get(user_id, []))
    for q in subs:
        q.put((event, data))
