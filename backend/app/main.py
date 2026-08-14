from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.exceptions import AppError, app_error_handler
from app.routers import auth, chat, conversation, message, refine
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

app.include_router(auth.router)
app.include_router(chat.router)
app.include_router(message.router)
app.include_router(refine.router)
app.include_router(conversation.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
