"""진행 중인 AI 답변 작업의 조각을 중계하는 통로 .

프로세스 하나에서만 동작하는 메모리 중계다. 작업은 백그라운드 스레드에서
돌고, 여러 화면(재접속 포함)이 같은 작업에 동시에 붙어 조각을 받아갈 수
있다. 서버가 재시작되면 이 레지스트리는 비워지므로, 그 뒤로 중계할 진행
중 작업은 없다 — 재시작 시 정리는 별도로 처리한다.
"""

from __future__ import annotations

import json
import queue
import threading
import uuid
from dataclasses import dataclass, field
from typing import Any, Literal

EventType = Literal["text", "snapshot", "sources", "status"]

# 구독자 큐에 이 값이 오면 더 이상 조각이 없다는 뜻이다 (종료 신호).
_SENTINEL = None


@dataclass
class _JobStream:
    buffer: str = ""
    sources: list[dict] = field(default_factory=list)
    status: str = "generating"  # generating | completed | failed | cancelled
    error: dict | None = None
    subscribers: list[queue.Queue] = field(default_factory=list)
    cancel_requested: bool = False
    lock: threading.Lock = field(default_factory=threading.Lock)
    # 중단 요청 쪽이 정리 완료를 기다릴 때 쓴다 (publish_done에서 set).
    done: threading.Event = field(default_factory=threading.Event)


_streams: dict[uuid.UUID, _JobStream] = {}
_registry_lock = threading.Lock()


def start(job_id: uuid.UUID) -> None:
    """작업을 시작하며 중계 통로를 연다."""
    with _registry_lock:
        _streams[job_id] = _JobStream()


def is_cancel_requested(job_id: uuid.UUID) -> bool:
    stream = _streams.get(job_id)
    return stream is not None and stream.cancel_requested


def request_cancel(job_id: uuid.UUID) -> threading.Event | None:
    """중단을 요청한다.

    돌려주는 Event는 백그라운드 스레드가 정리를 마치면(publish_done) set된다.
    호출한 쪽이 이 Event를 기다리면 "중단하면 그때까지의 본문이 남는다"를
    응답 시점에 보장할 수 있다. 이미 끝난(레지스트리에 없는) 작업이면 None.
    """
    stream = _streams.get(job_id)
    if stream is None:
        return None
    with stream.lock:
        stream.cancel_requested = True
    return stream.done


def publish_text(job_id: uuid.UUID, delta: str) -> None:
    stream = _streams.get(job_id)
    if stream is None or not delta:
        return
    with stream.lock:
        stream.buffer += delta
        _broadcast(stream, "text", {"delta": delta})


def publish_sources(job_id: uuid.UUID, sources: list[dict]) -> None:
    stream = _streams.get(job_id)
    if stream is None:
        return
    with stream.lock:
        stream.sources = sources
        _broadcast(stream, "sources", {"sources": sources})


def publish_done(
    job_id: uuid.UUID,
    status: Literal["completed", "failed", "cancelled"],
    content: str,
    sources: list[dict],
    error: dict | None = None,
    user_message_block_id: str | None = None,
    retryable: bool = False,
) -> None:
    """생성이 끝났음을 알리고 통로를 닫는다.

    끝난 뒤 새로 붙는 화면은 레지스트리가 아니라 DB의 최종 상태를 본다
    (B6: 이미 끝난 작업에 붙으면 완료 상태만 알려준다).
    """
    stream = _streams.get(job_id)
    if stream is None:
        return
    with stream.lock:
        stream.status = status
        stream.error = error
        _broadcast(
            stream,
            "status",
            {
                "status": status,
                "content": content,
                "sources": sources,
                "error": error,
                "userMessageBlockId": user_message_block_id,
                "retryable": retryable,
            },
        )
        for q in stream.subscribers:
            q.put(_SENTINEL)
        stream.done.set()
    with _registry_lock:
        _streams.pop(job_id, None)


def _broadcast(stream: _JobStream, event: EventType, data: dict[str, Any]) -> None:
    for q in stream.subscribers:
        q.put((event, data))


@dataclass
class Snapshot:
    buffer: str
    sources: list[dict]
    status: str
    queue: queue.Queue | None  # None이면 이미 끝난 작업(레지스트리에 없음)


def subscribe(job_id: uuid.UUID) -> Snapshot | None:
    """지금까지 만들어진 본문과, 이어질 조각을 받을 큐를 함께 돌려준다.

    반환값이 None이면 이 프로세스가 그 작업을 진행 중으로 알지 못한다는
    뜻이다 — 이미 끝났거나(서버가 그사이 재시작됐거나) 잘못된 job_id다.
    호출한 쪽이 DB를 봐서 마지막 상태를 판단해야 한다.
    """
    stream = _streams.get(job_id)
    if stream is None:
        return None
    with stream.lock:
        q: queue.Queue = queue.Queue()
        stream.subscribers.append(q)
        return Snapshot(buffer=stream.buffer, sources=stream.sources, status=stream.status, queue=q)


def format_sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
