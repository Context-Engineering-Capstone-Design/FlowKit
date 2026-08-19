from __future__ import annotations
from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field
from app.deps import DbSession, OptionalUser
from app.models import ClientErrorLog
router = APIRouter(tags=['Observability'])


class ClientErrorIn(BaseModel):
    client_error_type: str = Field(..., alias='clientErrorType')
    message: str
    page_context: dict | None = Field(None, alias='pageContext')
    model_config = ConfigDict(populate_by_name=True)


@router.post('/api/client-errors', status_code=201)
def client_error(payload: ClientErrorIn, request: Request, db: DbSession, user: OptionalUser):
    text = _mask(payload.message)[:500]
    item = ClientErrorLog(
        trace_id=getattr(request.state, 'trace_id', ''),
        user_id=user.id if user else None,
        client_error_type=payload.client_error_type[:80],
        message=text,
        page_context=_safe_context(payload.page_context),
        user_agent=(request.headers.get('user-agent') or '')[:300],
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return {'logId': str(item.id), 'receivedAt': item.created_at}
def _mask(text: str) -> str:
    import re
    return re.sub(r'(AIza[\w-]{20,}|Bearer\s+\S+|[\w.+-]+@[\w.-]+)', '[redacted]', text)
def _safe_context(value):
    if not isinstance(value, dict): return None
    return {key: str(val)[:100] for key, val in value.items() if key in {'page','feature','chatId','branchId','resourceId'}}
