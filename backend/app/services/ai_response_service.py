"""고정 입력 스냅샷을 기준으로 AI 답변 작업을 생성·복구한다."""
from __future__ import annotations
import uuid
from dataclasses import dataclass
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.exceptions import AiInputSnapshotIncompleteError, AiInputSnapshotNotFoundError, AiJobNotFoundError, AiJobNotRetryableError, AppError, ValidationError
from app.models import AiResponseFeedback, AiResponseJob, AiResponseJobStatus, AiResponseJobType, AiResponseRating, Branch, Chat, MessageBlock, MessageRole, User, VersionSourceType
from app.services import chat_service, context_service, input_assist_service, message_service, user_setting_service
from modeling import EmptyAnswerError

class AiResponseFailedError(AppError):
    status_code = 502
    error_code = "AI_RESPONSE_FAILED"
    message = "답변을 생성하지 못했습니다. 잠시 후 다시 시도해주세요."

class NotAssistantBlockError(AppError):
    status_code = 400
    error_code = "NOT_ASSISTANT_BLOCK"
    message = "AI 답변 블록이 아닙니다."

@dataclass(frozen=True)
class SendResult:
    user_block: MessageBlock; assistant_block: MessageBlock; context_items: list[context_service.ContextItem]
    title_generated: bool; selected_model: str; web_search_enabled: bool; reasoning_effort: str; attachments: list; search_sources: list; job: AiResponseJob

@dataclass(frozen=True)
class RegenerateResult:
    block: MessageBlock; search_sources: list; job: AiResponseJob

def send_message(db: Session, user: User, chat: Chat, branch: Branch, user_prompt: str, context_block_ids: list[uuid.UUID] | None = None, selected_model_id: str | None = None, web_search_enabled: bool = False, attachment_ids: list[uuid.UUID] | None = None, reasoning_effort: str = "medium", answerer=None, titler=None) -> SendResult:
    prompt = (user_prompt or "").strip()
    if not prompt: raise ValidationError("질문을 입력해주세요.")
    attachments = input_assist_service.get_attachments_for_message(db, user, chat, attachment_ids or [])
    model = input_assist_service.validate_options(selected_model_id, web_search_enabled, bool(attachments))
    api_key = user_setting_service.require_api_key(db, user)
    context_items = context_service.build_snapshot(db, branch, context_block_ids or [])
    flow = message_service.active_message_flow(db, branch); is_first = not flow
    if context_items: flow = []
    user_block = message_service.create_block(db, chat, branch, MessageRole.USER, prompt, commit=False)
    context_service.save_log(db, chat, branch, user_block.id, context_items)
    input_assist_service.attach_to_message(db, user_block, attachments)
    snapshot = _make_snapshot(prompt, flow, context_items, model.model_id, web_search_enabled, attachments, reasoning_effort)
    job = _new_job(user, chat, branch, user_block.id, AiResponseJobType.GENERATE, snapshot); db.add(job); db.commit(); db.refresh(user_block); db.refresh(job)
    try: answer, sources = _generate_snapshot(db, user, chat, snapshot, api_key, answerer)
    except Exception as exc:
        _fail_job(db, job, exc); raise _failure_error(job) from exc
    assistant = message_service.create_block(db, chat, branch, MessageRole.ASSISTANT, answer, commit=False, search_sources=_sources_payload(sources))
    job.assistant_message_block_id, job.result_version_id, job.status = assistant.id, assistant.current_version_id, AiResponseJobStatus.COMPLETED
    db.commit(); db.refresh(assistant); db.refresh(job)
    titled = is_first and chat.title == chat_service.DEFAULT_TITLE and _try_generate_title(db, chat, prompt, api_key, titler)
    return SendResult(user_block, assistant, context_items, bool(titled), model.model_id, web_search_enabled, reasoning_effort, attachments, sources, job)

def regenerate(db: Session, user: User, chat: Chat, branch: Branch, block_id: uuid.UUID, answerer=None) -> RegenerateResult:
    api_key = user_setting_service.require_api_key(db, user)
    block = message_service.get_editable_block(db, branch, block_id)
    if block.role is not MessageRole.ASSISTANT: raise NotAssistantBlockError()
    origin = _origin_job(db, block.id)
    if origin is None: return _legacy_regenerate(db, user, chat, branch, block, api_key, answerer)
    job = _new_job(user, chat, branch, origin.user_message_block_id, AiResponseJobType.REGENERATE, origin.input_snapshot, origin.id)
    job.assistant_message_block_id = block.id; db.add(job); db.commit()
    try: answer, sources = _generate_snapshot(db, user, chat, origin.input_snapshot, api_key, answerer)
    except Exception as exc:
        _fail_job(db, job, exc); raise _failure_error(job) from exc
    updated = message_service.add_version(db, chat, block, answer, VersionSourceType.AI_REGENERATE, search_sources=_sources_payload(sources))
    job.result_version_id, job.status = updated.current_version_id, AiResponseJobStatus.COMPLETED; db.commit(); db.refresh(job)
    return RegenerateResult(updated, sources, job)

def retry_failed_job(db: Session, user: User, chat: Chat, branch: Branch, job_id: uuid.UUID, answerer=None, titler=None) -> SendResult:
    failed = db.get(AiResponseJob, job_id)
    if failed is None or failed.user_id != user.id or failed.chat_id != chat.id or failed.branch_id != branch.id: raise AiJobNotFoundError()
    if failed.job_type is not AiResponseJobType.GENERATE or failed.status is not AiResponseJobStatus.FAILED: raise AiJobNotRetryableError()
    user_block = message_service.get_editable_block(db, branch, failed.user_message_block_id)
    job = _new_job(user, chat, branch, user_block.id, AiResponseJobType.GENERATE, failed.input_snapshot, failed.id); db.add(job); db.commit()
    try: answer, sources = _generate_snapshot(db, user, chat, failed.input_snapshot, user_setting_service.require_api_key(db, user), answerer)
    except Exception as exc:
        _fail_job(db, job, exc); raise _failure_error(job) from exc
    assistant = message_service.create_block(db, chat, branch, MessageRole.ASSISTANT, answer, commit=False, search_sources=_sources_payload(sources))
    job.assistant_message_block_id, job.result_version_id, job.status = assistant.id, assistant.current_version_id, AiResponseJobStatus.COMPLETED; db.commit(); db.refresh(assistant); db.refresh(job)
    snapshot = failed.input_snapshot
    titled = (
        not snapshot["messageFlow"]
        and chat.title == chat_service.DEFAULT_TITLE
        and _try_generate_title(
            db,
            chat,
            snapshot["userPrompt"],
            user_setting_service.require_api_key(db, user),
            titler,
        )
    )
    return SendResult(user_block, assistant, _context_from_snapshot(snapshot), bool(titled), snapshot["selectedModelId"], snapshot["webSearchEnabled"], snapshot.get("reasoningEffort", "medium"), input_assist_service.get_attached_for_snapshot(db, user, chat, snapshot["attachmentIds"]), sources, job)

def _make_snapshot(prompt, flow, context_items, model_id, web, attachments, reasoning_effort="medium") -> dict:
    return {"schemaVersion": 1, "userPrompt": prompt, "messageFlow": [{"role": x.role.value, "content": x.content} for x in flow], "appliedContext": [{"blockId": str(x.block_id), "versionId": str(x.version_id), "content": x.content, "orderIndex": x.order_index} for x in context_items], "selectedModelId": model_id, "webSearchEnabled": web, "reasoningEffort": reasoning_effort, "attachmentIds": [str(x.id) for x in attachments]}

def _generate_snapshot(db, user, chat, snapshot, api_key, answerer=None):
    required = {"userPrompt", "messageFlow", "appliedContext", "selectedModelId", "webSearchEnabled", "attachmentIds"}
    if snapshot.get("schemaVersion") != 1 or not required.issubset(snapshot): raise AiInputSnapshotIncompleteError()
    try:
        attached = input_assist_service.get_attached_for_snapshot(db, user, chat, snapshot["attachmentIds"])
        from modeling import generate_answer
        from modeling.types import AnswerRequest, ChatTurn
        req = AnswerRequest(snapshot["userPrompt"], [ChatTurn(role=x["role"], content=x["content"]) for x in snapshot["messageFlow"]], [x["content"] for x in snapshot["appliedContext"]], input_assist_service.to_modeling_attachments(attached), snapshot["webSearchEnabled"], snapshot["selectedModelId"], snapshot.get("reasoningEffort", "medium"))
    except (KeyError, TypeError, ValueError) as exc: raise AiInputSnapshotIncompleteError() from exc
    result = (answerer or generate_answer)(req, api_key=api_key); text = (getattr(result, "text", result) or "").strip()
    if not text: raise ValueError("empty")
    return text, list(getattr(result, "search_sources", []) or [])

def _sources_payload(sources: list) -> list[dict] | None:
    """검색 근거를 버전에 저장할 JSON 형태로 바꾼다. 없으면 None (AI-SEARCH-002)."""
    return [{"title": s.title, "url": s.url} for s in sources] or None


def _new_job(user, chat, branch, user_block_id, kind, snapshot, source=None):
    return AiResponseJob(user_id=user.id, chat_id=chat.id, branch_id=branch.id, user_message_block_id=user_block_id, source_job_id=source, job_type=kind, status=AiResponseJobStatus.REQUESTED, input_snapshot=snapshot)

def _origin_job(db, assistant_id):
    return db.scalar(select(AiResponseJob).where(AiResponseJob.assistant_message_block_id == assistant_id, AiResponseJob.job_type == AiResponseJobType.GENERATE, AiResponseJob.status == AiResponseJobStatus.COMPLETED).order_by(AiResponseJob.created_at).limit(1))

def _context_from_snapshot(snapshot):
    return [context_service.ContextItem(uuid.UUID(x["blockId"]), uuid.UUID(x["versionId"]), x["content"], x["orderIndex"]) for x in snapshot["appliedContext"]]

def _fail_job(db, job, exc):
    job.status = AiResponseJobStatus.FAILED; job.error_code, job.error_message = _classify_error(exc); db.commit()

def _failure_error(job):
    return AiResponseFailedError(detail={"aiResponseJobId": str(job.id), "userMessageBlockId": str(job.user_message_block_id), "retryable": job.job_type is AiResponseJobType.GENERATE})

def _classify_error(exc):
    if isinstance(exc, AiInputSnapshotIncompleteError): return exc.error_code, exc.message
    n = exc.__class__.__name__.lower()
    if "timeout" in n: return "AI_TIMEOUT", "AI 응답 시간이 초과되었습니다."
    if "rate" in n or "quota" in n: return "AI_RATE_LIMITED", "AI 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요."
    if isinstance(exc, EmptyAnswerError) or (isinstance(exc, ValueError) and str(exc) == "empty"): return "AI_RESPONSE_EMPTY", "AI 답변이 비어 있습니다."
    return "AI_PROVIDER_ERROR", "AI 응답을 생성하지 못했습니다."

def _legacy_regenerate(db, user, chat, branch, block, api_key, answerer):
    raise AiInputSnapshotNotFoundError()

def get_feedback(db, user, branch, block_id):
    _require_assistant_block(db, branch, block_id); return db.scalar(select(AiResponseFeedback).where(AiResponseFeedback.user_id == user.id, AiResponseFeedback.message_block_id == block_id))
def set_feedback(db, user, branch, block_id, rating):
    _require_assistant_block(db, branch, block_id); item = db.scalar(select(AiResponseFeedback).where(AiResponseFeedback.user_id == user.id, AiResponseFeedback.message_block_id == block_id))
    if rating is None:
        if item: db.delete(item); db.commit()
        return None
    if item is None: item = AiResponseFeedback(user_id=user.id, message_block_id=block_id, rating=rating); db.add(item)
    else: item.rating = rating
    db.commit(); db.refresh(item); return item
def _require_assistant_block(db, branch, block_id):
    # 평가는 내용을 바꾸지 않으므로, 이 브랜치가 이어받은(조상 브랜치 소유) 답변도 허용한다
    block = message_service.get_visible_block(db, branch, block_id)
    if block.role is not MessageRole.ASSISTANT: raise NotAssistantBlockError()
    return block
def _try_generate_title(db, chat, prompt, api_key, titler=None):
    from modeling import generate_title
    try: chat_service.update_title(db, chat, (titler or generate_title)(prompt, api_key=api_key)); return True
    except Exception: return False
