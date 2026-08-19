from __future__ import annotations

import re
import threading
import time
from collections import OrderedDict, deque

from fastapi import APIRouter, Request

from app.deps import DbSession, OptionalUser
from app.exceptions import ClientErrorRateLimitExceededError
from app.models import ClientErrorLog
from app.schemas.observability import ClientErrorRequest, ClientErrorResponse
from app.settings import get_settings

router = APIRouter(tags=["Observability"])

_SENSITIVE_PATTERN = re.compile(
    r"AIza[\w-]{20,}|Bearer\s+\S+|[\w.+-]+@[\w.-]+|"
    r"\b(?:sk|pk)-[A-Za-z0-9_-]{16,}\b",
    re.IGNORECASE,
)


class _SlidingWindowRateLimiter:
    """프로세스 메모리를 제한한 짧은 구간 요청 제한기."""

    def __init__(self, max_keys: int = 10_000) -> None:
        self._events: OrderedDict[str, deque[float]] = OrderedDict()
        self._max_keys = max_keys
        self._lock = threading.Lock()

    def allow(self, key: str, *, limit: int, window_seconds: int) -> bool:
        now = time.monotonic()
        cutoff = now - window_seconds
        with self._lock:
            events = self._events.setdefault(key, deque())
            while events and events[0] <= cutoff:
                events.popleft()
            self._events.move_to_end(key)
            if len(events) >= limit:
                return False
            events.append(now)
            while len(self._events) > self._max_keys:
                self._events.popitem(last=False)
            return True

    def reset(self) -> None:
        with self._lock:
            self._events.clear()


_client_error_rate_limiter = _SlidingWindowRateLimiter()


@router.post(
    "/api/client-errors", response_model=ClientErrorResponse, status_code=201
)
def collect_client_error(
    payload: ClientErrorRequest,
    request: Request,
    db: DbSession,
    user: OptionalUser,
) -> ClientErrorResponse:
    settings = get_settings()
    client_host = request.client.host if request.client is not None else "unknown"
    rate_key = f"user:{user.id}" if user is not None else f"ip:{client_host}"
    if not _client_error_rate_limiter.allow(
        rate_key,
        limit=settings.client_error_rate_limit,
        window_seconds=settings.client_error_rate_window_seconds,
    ):
        raise ClientErrorRateLimitExceededError()

    page_context = None
    if payload.page_context is not None:
        page_context = payload.page_context.model_dump(
            mode="json", by_alias=True, exclude_none=True
        ) or None

    item = ClientErrorLog(
        trace_id=getattr(request.state, "trace_id", ""),
        user_id=user.id if user else None,
        client_error_type=payload.client_error_type,
        message=_mask(payload.message)[: settings.client_error_stored_message_chars],
        page_context=page_context,
        user_agent=(request.headers.get("user-agent") or "")[:300] or None,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return ClientErrorResponse(log_id=item.id, received_at=item.created_at)


def _mask(text: str) -> str:
    return _SENSITIVE_PATTERN.sub("[redacted]", text)
