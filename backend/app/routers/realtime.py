"""같은 계정의 다른 창에 변화가 생겼다는 신호를 흘려보내는 라우터 (0821_05)."""

from __future__ import annotations

import queue

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.deps import CurrentUser
from app.services import realtime_service, streaming_service

router = APIRouter(prefix="/api/realtime", tags=["Realtime"])


@router.get("/stream")
def stream_realtime_events(user: CurrentUser) -> StreamingResponse:
    user_id = user.id

    def events():
        q = realtime_service.subscribe(user_id)
        try:
            while True:
                try:
                    event, data = q.get(timeout=20)
                except queue.Empty:
                    yield ": ping\n\n"
                    continue
                yield streaming_service.format_sse(event, data)
        finally:
            realtime_service.unsubscribe(user_id, q)

    return StreamingResponse(events(), media_type="text/event-stream")
