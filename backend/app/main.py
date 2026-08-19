from __future__ import annotations

import uuid

from fastapi import FastAPI
from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException

from app.exceptions import (
    AppError,
    app_error_handler,
    http_error_handler,
    unexpected_error_handler,
    validation_error_handler,
)
from app.routers import (
    auth,
    chat,
    conversation,
    input_assist,
    message,
    observability,
    refine,
    user_setting,
)
from app.settings import get_settings

settings = get_settings()

app = FastAPI(title="FlowKit API", version="0.1.0")

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
app.include_router(message.router)
app.include_router(refine.router)
app.include_router(conversation.router)
app.include_router(user_setting.router)
app.include_router(input_assist.router)
app.include_router(observability.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
