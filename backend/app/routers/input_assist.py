from __future__ import annotations

import uuid

from fastapi import APIRouter, File, UploadFile

from app.deps import CurrentUser, DbSession
from app.schemas.input_assist import AttachmentOut, ModelOut
from app.services import chat_service, input_assist_service

router = APIRouter(tags=["Input assist"])


@router.get("/api/models", response_model=list[ModelOut])
def get_models() -> list[ModelOut]:
    return [
        ModelOut(
            model_id=model.model_id, display_name=model.display_name, provider=model.provider,
            supports_web_search=model.supports_web_search,
            supports_attachment=model.supports_attachment,
            is_default=model.is_default, is_available=True,
        )
        for model in input_assist_service.list_models()
    ]


@router.post("/api/chats/{chat_id}/attachments", response_model=AttachmentOut, status_code=201)
def upload_attachment(chat_id: uuid.UUID, user: CurrentUser, db: DbSession, file: UploadFile = File(...)) -> AttachmentOut:
    chat = chat_service.get_owned_chat(db, user, chat_id)
    attachment = input_assist_service.upload_attachment(db, user, chat, file)
    return AttachmentOut(
        attachment_id=attachment.id, file_name=attachment.file_name,
        mime_type=attachment.mime_type, file_size=attachment.file_size,
        status=attachment.status.value, expires_at=attachment.expires_at,
    )


@router.delete("/api/chats/{chat_id}/attachments/{attachment_id}", status_code=204)
def delete_attachment(chat_id: uuid.UUID, attachment_id: uuid.UUID, user: CurrentUser, db: DbSession) -> None:
    chat = chat_service.get_owned_chat(db, user, chat_id)
    input_assist_service.delete_temporary_attachment(db, user, chat, attachment_id)
