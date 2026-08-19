from __future__ import annotations

import re

from fastapi import Request

from app.db import SessionLocal
from app.models import ErrorLog

_SENSITIVE_PATTERN = re.compile(
    r"AIza[\w-]{20,}|Bearer\s+\S+|[\w.+-]+@[\w.-]+|"
    r"\b(?:sk|pk)-[A-Za-z0-9_-]{16,}\b",
    re.IGNORECASE,
)


def record_server_error(
    request: Request,
    *,
    trace_id: str,
    error_code: str,
    message: str,
    status_code: int,
    exception: Exception | None = None,
) -> bool:
    """별도 트랜잭션에 안전한 요약만 저장하며 기록 실패는 요청을 가리지 않는다."""

    try:
        with SessionLocal() as db:
            db.add(
                ErrorLog(
                    trace_id=trace_id[:36],
                    user_id=getattr(request.state, "user_id", None),
                    request_path=request.url.path[:300],
                    method=request.method[:10],
                    error_code=error_code[:80],
                    message=_safe_summary(message),
                    exception_type=(
                        type(exception).__name__[:100] if exception is not None else None
                    ),
                    status_code=status_code,
                )
            )
            db.commit()
        return True
    except Exception:
        return False


def _safe_summary(message: str) -> str:
    masked = _SENSITIVE_PATTERN.sub("[redacted]", message)
    return " ".join(masked.split())[:300] or "Server error"
