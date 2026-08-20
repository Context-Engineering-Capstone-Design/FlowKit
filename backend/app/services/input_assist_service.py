"""모델 선택과 첨부 파일의 검증·저장·연결을 담당한다."""

from __future__ import annotations

import os
import tempfile
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from fastapi import UploadFile
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.exceptions import (
    AttachmentAccessDeniedError,
    AttachmentAlreadyUsedError,
    AttachmentInvalidTypeError,
    AttachmentLimitExceededError,
    AttachmentNotFoundError,
    AttachmentReadError,
    AttachmentTooLargeError,
    ModelNotSupportedError,
    WebSearchNotSupportedError,
)
from app.models import Attachment, AttachmentStatus, Chat, MessageAttachment, MessageBlock, User
from app.services.attachment_storage import LocalAttachmentStorage
from app.settings import get_settings

_ALLOWED = {
    "image/png": {".png"},
    "image/jpeg": {".jpg", ".jpeg"},
    "image/webp": {".webp"},
    "application/pdf": {".pdf"},
    "text/plain": {".txt"},
    "text/markdown": {".md", ".markdown"},
}


def list_models():
    from modeling import available_models

    return available_models()


def validate_options(selected_model_id: str | None, web_search_mode: str, has_attachments: bool):
    from modeling.models import UnsupportedModelError, resolve_model

    try:
        model = resolve_model(selected_model_id)
    except UnsupportedModelError as exc:
        raise ModelNotSupportedError() from exc
    if web_search_mode != "off" and not model.supports_web_search:
        raise WebSearchNotSupportedError()
    if has_attachments and not model.supports_attachment:
        raise AttachmentInvalidTypeError("선택한 모델은 파일 첨부를 지원하지 않습니다.")
    return model


def upload_attachment(db: Session, user: User, chat: Chat, upload: UploadFile) -> Attachment:
    settings = get_settings()
    file_name = _safe_name(upload.filename)
    suffix = Path(file_name).suffix.lower()
    if not suffix:
        raise AttachmentInvalidTypeError()

    tmp_path: Path | None = None
    try:
        fd, raw_path = tempfile.mkstemp(prefix="flowkit-upload-")
        tmp_path = Path(raw_path)
        size = 0
        with os.fdopen(fd, "wb") as out:
            while chunk := upload.file.read(1024 * 1024):
                size += len(chunk)
                if size > settings.attachment_max_file_size:
                    raise AttachmentTooLargeError()
                out.write(chunk)
        if size == 0:
            raise AttachmentInvalidTypeError("빈 파일은 첨부할 수 없습니다.")
        mime_type = _detect_mime(tmp_path, suffix)
        storage_key = f"{user.id}/{chat.id}/{uuid.uuid4().hex}{suffix}"
        storage = _storage()
        storage.write(storage_key, tmp_path)
        attachment = Attachment(
            user_id=user.id,
            chat_id=chat.id,
            file_name=file_name,
            mime_type=mime_type,
            file_size=size,
            storage_key=storage_key,
            status=AttachmentStatus.TEMPORARY,
            expires_at=datetime.now(UTC) + timedelta(hours=settings.attachment_temporary_hours),
        )
        db.add(attachment)
        try:
            db.commit()
            db.refresh(attachment)
        except Exception:
            db.rollback()
            storage.delete(storage_key)
            raise
        return attachment
    except AttachmentTooLargeError:
        raise
    except AttachmentInvalidTypeError:
        raise
    except OSError as exc:
        raise AttachmentReadError() from exc
    finally:
        if tmp_path is not None:
            tmp_path.unlink(missing_ok=True)
        upload.file.close()


def delete_attachments_for_chat(db: Session, chat: Chat) -> None:
    """채팅에 속한 첨부 연결·원본 파일을 먼저 정리한다. 채팅 삭제 전에 호출한다."""
    attachments = list(db.scalars(select(Attachment).where(Attachment.chat_id == chat.id)))
    if not attachments:
        return
    ids = [item.id for item in attachments]
    db.execute(delete(MessageAttachment).where(MessageAttachment.attachment_id.in_(ids)))
    storage = _storage()
    for attachment in attachments:
        try:
            storage.delete(attachment.storage_key)
        except (OSError, ValueError):
            pass
        db.delete(attachment)
    db.flush()


def delete_temporary_attachment(db: Session, user: User, chat: Chat, attachment_id: uuid.UUID) -> None:
    attachment = _owned_attachment(db, user, chat, attachment_id)
    if attachment.status is not AttachmentStatus.TEMPORARY:
        raise AttachmentAlreadyUsedError()
    try:
        _storage().delete(attachment.storage_key)
    except OSError as exc:
        raise AttachmentReadError("첨부 파일 삭제에 실패했습니다.") from exc
    db.delete(attachment)
    db.commit()


def read_attachment_file(db: Session, user: User, chat: Chat, attachment_id: uuid.UUID) -> tuple[Attachment, bytes]:
    attachment = _owned_attachment(db, user, chat, attachment_id)
    expired = attachment.status is AttachmentStatus.EXPIRED or (
        attachment.status is AttachmentStatus.TEMPORARY and _is_expired(attachment.expires_at)
    )
    if expired:
        raise AttachmentNotFoundError()
    try:
        return attachment, _storage().read(attachment.storage_key)
    except OSError as exc:
        raise AttachmentReadError() from exc


def get_attachments_for_message(db: Session, user: User, chat: Chat, attachment_ids: list[uuid.UUID]) -> list[Attachment]:
    ids = list(dict.fromkeys(attachment_ids))
    if len(ids) > get_settings().attachment_max_per_message:
        raise AttachmentLimitExceededError()
    attachments = [_owned_attachment(db, user, chat, item_id) for item_id in ids]
    for attachment in attachments:
        if attachment.status is not AttachmentStatus.TEMPORARY or _is_expired(attachment.expires_at):
            raise AttachmentNotFoundError("사용할 수 없는 임시 첨부 파일입니다.")
    return attachments


def attach_to_message(db: Session, message: MessageBlock, attachments: list[Attachment]) -> None:
    for index, attachment in enumerate(attachments):
        db.add(MessageAttachment(
            message_block_id=message.id, attachment_id=attachment.id, order_index=index
        ))
        attachment.status = AttachmentStatus.ATTACHED
        attachment.expires_at = None
    db.flush()


def to_modeling_attachments(attachments: list[Attachment]):
    from modeling.types import Attachment as ModelingAttachment

    converted = []
    for attachment in attachments:
        try:
            content = _storage().read(attachment.storage_key)
        except OSError as exc:
            raise AttachmentReadError() from exc
        converted.append(ModelingAttachment(
            attachment_id=str(attachment.id), file_name=attachment.file_name,
            file_type=attachment.mime_type, content=content,
        ))
    return converted


def get_attached_for_snapshot(db: Session, user: User, chat: Chat, attachment_ids: list[str]) -> list[Attachment]:
    try:
        ids = [uuid.UUID(item) for item in attachment_ids]
    except (TypeError, ValueError) as exc:
        raise AttachmentReadError() from exc
    items = [_owned_attachment(db, user, chat, item_id) for item_id in ids]
    if any(item.status is not AttachmentStatus.ATTACHED for item in items):
        raise AttachmentReadError("첨부 파일 상태가 올바르지 않습니다.")
    return items


def cleanup_expired(db: Session) -> int:
    now = datetime.now(UTC)
    items = list(db.scalars(select(Attachment).where(
        Attachment.status == AttachmentStatus.TEMPORARY,
        Attachment.expires_at.is_not(None), Attachment.expires_at <= now,
    )).all())
    cleaned = 0
    for attachment in items:
        try:
            _storage().delete(attachment.storage_key)
        except OSError:
            continue
        attachment.status = AttachmentStatus.EXPIRED
        cleaned += 1
    db.commit()
    return cleaned


def _owned_attachment(db: Session, user: User, chat: Chat, attachment_id: uuid.UUID) -> Attachment:
    attachment = db.get(Attachment, attachment_id)
    if attachment is None:
        raise AttachmentNotFoundError()
    if attachment.user_id != user.id or attachment.chat_id != chat.id:
        raise AttachmentAccessDeniedError()
    return attachment


def _storage() -> LocalAttachmentStorage:
    return LocalAttachmentStorage(get_settings().attachment_storage_dir)


def _is_expired(expires_at: datetime | None) -> bool:
    if expires_at is None:
        return False
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    return expires_at <= datetime.now(UTC)


def _safe_name(raw_name: str | None) -> str:
    name = Path(raw_name or "").name.replace("\x00", "").strip()
    if not name or name in {".", ".."}:
        raise AttachmentInvalidTypeError("파일 이름이 올바르지 않습니다.")
    return name[:255]


def _detect_mime(path: Path, suffix: str) -> str:
    data = path.read_bytes()[:8192]
    if data.startswith(b"\x89PNG\r\n\x1a\n") and suffix == ".png":
        return "image/png"
    if data.startswith(b"\xff\xd8\xff") and suffix in {".jpg", ".jpeg"}:
        return "image/jpeg"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP" and suffix == ".webp":
        return "image/webp"
    if data.startswith(b"%PDF-") and suffix == ".pdf":
        return "application/pdf"
    if suffix in _ALLOWED["text/plain"] | _ALLOWED["text/markdown"]:
        try:
            data.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise AttachmentInvalidTypeError() from exc
        return "text/markdown" if suffix in _ALLOWED["text/markdown"] else "text/plain"
    raise AttachmentInvalidTypeError()
