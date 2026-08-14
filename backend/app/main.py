from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.exceptions import AppError, app_error_handler
from app.routers import auth, chat, conversation, message, refine
from app.settings import get_settings
from modeling import configure as configure_llm

settings = get_settings()

# modeling 은 환경변수에서 키를 찾는데, 백엔드는 .env 를 설정 객체로만 읽는다.
# 그대로 두면 서버에서 AI 호출이 키 없음으로 실패한다.
configure_llm(settings.google_api_key)

app = FastAPI(title="FlowKit API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_exception_handler(AppError, app_error_handler)

app.include_router(auth.router)
app.include_router(chat.router)
app.include_router(message.router)
app.include_router(refine.router)
app.include_router(conversation.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
