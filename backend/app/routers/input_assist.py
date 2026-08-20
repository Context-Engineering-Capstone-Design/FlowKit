from __future__ import annotations

import uuid

from fastapi import APIRouter, File, UploadFile
from fastapi.responses import Response

from app.deps import CurrentUser, DbSession
from app.schemas.input_assist import (
    AttachmentMutationResponse,
    DeleteAttachmentResponse,
    ModelOut,
)
from app.schemas.notification import ActionMeta
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
            description=model.description, tags=list(model.tags),
        )
        for model in input_assist_service.list_models()
    ]


@router.post(
    "/api/chats/{chat_id}/attachments",
    response_model=AttachmentMutationResponse,
    status_code=201,
)
def upload_attachment(
    chat_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    file: UploadFile = File(...),
) -> AttachmentMutationResponse:
    chat = chat_service.get_owned_chat(db, user, chat_id)
    attachment = input_assist_service.upload_attachment(db, user, chat, file)
    return AttachmentMutationResponse(
        attachment_id=attachment.id, file_name=attachment.file_name,
        mime_type=attachment.mime_type, file_size=attachment.file_size,
        status=attachment.status.value, expires_at=attachment.expires_at,
        action_meta=ActionMeta(
            action_type="attachment_upload",
            success_code="ATTACHMENT_UPLOADED",
            message="파일을 첨부했습니다.",
            affected_resource_id=attachment.id,
        ),
    )


@router.get("/api/chats/{chat_id}/attachments/{attachment_id}/file")
def download_attachment(
    chat_id: uuid.UUID,
    attachment_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
) -> Response:
    chat = chat_service.get_owned_chat(db, user, chat_id)
    attachment, content = input_assist_service.read_attachment_file(db, user, chat, attachment_id)
    return Response(
        content=content,
        media_type=attachment.mime_type,
        headers={"Content-Disposition": f'inline; filename="{attachment.file_name}"'},
    )


@router.delete(
    "/api/chats/{chat_id}/attachments/{attachment_id}",
    response_model=DeleteAttachmentResponse,
)
def delete_attachment(
    chat_id: uuid.UUID,
    attachment_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
) -> DeleteAttachmentResponse:
    chat = chat_service.get_owned_chat(db, user, chat_id)
    input_assist_service.delete_temporary_attachment(db, user, chat, attachment_id)
    return DeleteAttachmentResponse(
        delete_success=True,
        attachment_id=attachment_id,
        action_meta=ActionMeta(
            action_type="attachment_delete",
            success_code="ATTACHMENT_DELETED",
            message="첨부 파일을 삭제했습니다.",
            affected_resource_id=attachment_id,
        ),
    )
