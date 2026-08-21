from __future__ import annotations

import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException

from app.db import SessionLocal, get_db
from app.exceptions import (
    AppError,
    app_error_handler,
    http_error_handler,
    unexpected_error_handler,
    validation_error_handler,
)
from app.routers import (
    ai_execution,
    auth,
    chat,
    conversation,
    input_assist,
    message,
    observability,
    project,
    realtime,
    refine,
    side_chat,
    user_setting,
)
from app.services import ai_response_service
from app.settings import get_settings

settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # 서버가 내려갔다 올라온 사이 GENERATING으로 멈춰버린 답변 작업을 정리한다
    # . 메모리 중계가 재시작과 함께 비어 다시는 끝나지 않는다.
    #
    # 테스트는 get_db를 오버라이드해 자체 세션(sqlite)을 쓴다. 있으면 그 세션을
    # 그대로 쓰고 닫지 않는다 — 세션의 수명은 그 오버라이드를 등록한 쪽 몫이다.
    override = _app.dependency_overrides.get(get_db)
    if override is not None:
        db = override()
        ai_response_service.cleanup_stuck_jobs(db)
        from app.services import chat_service
        chat_service.cleanup_expired_temporary_chats(db)
    else:
        with SessionLocal() as db:
            ai_response_service.cleanup_stuck_jobs(db)
            from app.services import chat_service
            chat_service.cleanup_expired_temporary_chats(db)
    yield


app = FastAPI(title="FlowKit API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_exception_handler(AppError, app_error_handler)
app.add_exception_handler(RequestValidationError, validation_error_handler)
app.add_exception_handler(HTTPException, http_error_handler)
app.add_exception_handler(Exception, unexpected_error_handler)


@app.middleware("http")
async def trace_request(request: Request, call_next):
    request.state.trace_id = str(uuid.uuid4())
    response = await call_next(request)
    response.headers["X-Trace-Id"] = request.state.trace_id
    return response

app.include_router(auth.router)
app.include_router(chat.router)
app.include_router(project.router)
app.include_router(side_chat.router)
app.include_router(message.router)
app.include_router(refine.router)
app.include_router(conversation.router)
app.include_router(user_setting.router)
app.include_router(input_assist.router)
app.include_router(observability.router)
app.include_router(ai_execution.router)
app.include_router(realtime.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
