"""고정 입력 스냅샷을 기준으로 AI 답변 작업을 생성·복구한다.

답변 생성은 이 요청을 처리하는 스레드가 아니라 백그라운드 스레드에서 돈다
. 화면은 빈 답변 블록과 작업 id를 즉시 받고, 스트리밍 통로
(streaming_service)에 붙어 조각을 받아간다.
"""
from __future__ import annotations
import logging
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db import SessionLocal
from app.exceptions import AiInputSnapshotIncompleteError, AiInputSnapshotNotFoundError, AiJobNotFoundError, AiJobNotRetryableError, AppError, ValidationError
from app.models import AiResponseFeedback, AiResponseJob, AiResponseJobStatus, AiResponseJobType, AiResponseRating, Branch, BlockGenerationStatus, Chat, ChatKind, MessageBlock, MessageRole, Project, ProjectMemory, User, VersionSourceType
from app.services import ai_execution_service, chat_service, context_service, input_assist_service, message_service, project_service, realtime_service, streaming_service, user_setting_service
from modeling import EmptyAnswerError

logger = logging.getLogger(__name__)

# 백그라운드 스레드가 새 DB 세션을 열 때 쓰는 팩토리. 요청 스레드는 DbSession
# 의존성(get_db)을 쓰지만, 생성 스레드는 요청이 끝난 뒤에도 계속 돌아 별도
# 세션이 필요하다. 테스트는 이 값을 테스트 엔진에 물린 세션 메이커로
# 바꿔치기한다 — 그러지 않으면 이 스레드는 실제 운영 DB를 본다.
session_factory = SessionLocal

# 진짜 스레드로 돌리지 않고 그 자리에서 실행한다. 답변 자체를 검증하는
# 테스트 대부분은 실제 동시 실행이 필요 없고, SQLite 테스트 엔진은 여러
# 스레드가 동시에 쓰면 잠금 오류를 낼 수 있어 이 편이 안전하다. 스트리밍
# 중 취소·재접속처럼 동시성 자체를 검증하는 테스트만 이 값을 False로 되돌린다.
run_jobs_synchronously = False

# 스트리밍 중간 저장 주기 . 너무 잦으면 DB 쓰기 부담이 커진다.
_SAVE_EVERY_CHARS = 120
_SAVE_EVERY_SECONDS = 1.5
# 중단 요청 후 백그라운드 스레드가 정리를 마칠 때까지 기다리는 최대 시간.
_CANCEL_WAIT_SECONDS = 10.0

class NotAssistantBlockError(AppError):
    status_code = 400
    error_code = "NOT_ASSISTANT_BLOCK"
    message = "AI 답변 블록이 아닙니다."

@dataclass(frozen=True)
class SendResult:
    user_block: MessageBlock; assistant_block: MessageBlock; context_items: list[context_service.ContextItem]
    title_generated: bool; selected_model: str; web_search_mode: str; reasoning_effort: str; attachments: list; search_sources: list; job: AiResponseJob

@dataclass(frozen=True)
class RegenerateResult:
    block: MessageBlock; search_sources: list; job: AiResponseJob


def _pin_current_version(block: MessageBlock) -> MessageBlock:
    """지금 이 시점의 본문을 응답 직렬화 때까지 그대로 쓰도록 관계를 미리 당겨온다.

    당겨오지 않으면 라우터가 나중에(응답을 만들 때) current_version에 처음
    접근하는 순간 지연 로딩이 일어난다. 그사이 백그라운드 작업이 이미 본문을
    채워 커밋했다면, "즉시 응답은 비어 있어야 한다"는 계약이 타이밍에 따라
    깨진다 — 특히 테스트처럼 작업이 아주 빨리 끝날 때 그렇다.
    """
    _ = block.current_version
    return block


def send_message(db: Session, user: User, chat: Chat, branch: Branch, user_prompt: str, context_block_ids: list[uuid.UUID] | None = None, selected_model_id: str | None = None, web_search_mode: str = "off", attachment_ids: list[uuid.UUID] | None = None, reasoning_effort: str = "medium", library_resource_ids: list[uuid.UUID] | None = None, context_ranges: list[context_service.ContextRangeSpec] | None = None, titler=None, answerer=None) -> SendResult:
    prompt = (user_prompt or "").strip()
    if not prompt: raise ValidationError("질문을 입력해주세요.")
    attachments = input_assist_service.get_attachments_for_message(db, user, chat, attachment_ids or [])
    model = input_assist_service.validate_options(selected_model_id, web_search_mode, bool(attachments))
    api_key = user_setting_service.require_api_key(db, user)
    context_items = context_service.build_snapshot(db, branch, context_block_ids or [], chat)
    context_items = context_items + context_service.build_range_snapshot(db, branch, context_ranges or [], chat)
    project = db.get(Project, chat.project_id) if chat.project_id else None
    memories = list(db.scalars(select(ProjectMemory).where(ProjectMemory.project_id == project.id).order_by(ProjectMemory.order_index, ProjectMemory.created_at)).all()) if project else []
    library_resources = project_service.selected_library_context(db, project, library_resource_ids or [])
    own_flow = message_service.active_message_flow(db, branch); is_first = not own_flow
    if context_items: own_flow = []
    parent_flow, parent_snapshot = _ancestor_context_flow(db, chat) if chat.kind is ChatKind.SIDE else ([], [])
    flow = parent_flow + own_flow
    user_block = message_service.create_block(db, chat, branch, MessageRole.USER, prompt, commit=False)
    context_service.save_log(db, chat, branch, user_block.current_version_id, context_items)
    input_assist_service.attach_to_message(db, user_block, attachments)
    project_service.save_selected_library_context(db, project, user_block.id, library_resources)
    snapshot = _make_snapshot(prompt, flow, context_items, model.model_id, web_search_mode, attachments, reasoning_effort, parent_snapshot, project.instructions if project else "", [item.content for item in memories], [{"resourceId": str(item.id), "title": item.title, "content": item.content} for item in library_resources])
    assistant_block = message_service.create_block(
        db, chat, branch, MessageRole.ASSISTANT, "", commit=False,
        allow_empty=True, generation_status=BlockGenerationStatus.GENERATING,
    )
    job = _new_job(user, chat, branch, user_block.id, AiResponseJobType.GENERATE, snapshot)
    job.assistant_message_block_id = assistant_block.id
    job.status = AiResponseJobStatus.GENERATING
    db.add(job); db.commit(); db.refresh(user_block); db.refresh(assistant_block); db.refresh(job)
    _pin_current_version(assistant_block)
    ai_execution_service.record_input_events(db, job, snapshot); db.commit()

    titled = is_first and chat.title == chat_service.DEFAULT_TITLE and _try_generate_title(db, chat, prompt, api_key, titler)

    _start_job(job.id, assistant_block.id, assistant_block.current_version_id, chat.id, user.id, snapshot, api_key, answerer)

    return SendResult(user_block, assistant_block, context_items, bool(titled), model.model_id, web_search_mode, reasoning_effort, attachments, [], job)


def _ancestor_context_flow(db: Session, chat: Chat) -> tuple[list, list[dict]]:
    """루트 메인부터 직계 조상 사이드 채팅까지의 흐름을 답변 생성 순간에 고정한다 (0820_10 B1).

    각 사이드 채팅은 자신이 갈라져 나온 지점(parent_branch_id)을 이미 들고 있다.
    그 포인터를 따라 올라가면 몇 단계를 거치든 각 조상의 올바른 브랜치를 얻을 수
    있다 — 형제 사이드 채팅의 흐름은 이 경로에 없으므로 섞이지 않는다.
    자식 메시지는 부모 대화에 기록하거나 다음 부모 입력으로 되돌려 쓰지 않는다.
    snapshot에는 출처와 시각만 함께 남겨 실행 중 어떤 맥락을 썼는지 확인할 수 있다.
    """
    # 통합 노드는 출발 흐름을 자체 블록으로 이미 고정했다. 여기서 조상을 다시
    # 합치면 이후 원본 변경이 섞이므로 추가 자동 참고를 하지 않는다.
    if chat.forked_from_chat_id is not None:
        return [], []

    chain: list[tuple[Chat, uuid.UUID | None]] = []
    current = chat
    while current.parent_chat_id is not None:
        parent = db.get(Chat, current.parent_chat_id)
        if parent is None:
            break
        chain.append((parent, current.parent_branch_id))
        current = parent
    flow: list = []
    sources: list[dict] = []
    for ancestor, branch_id in reversed(chain):
        if branch_id is None:
            branch_id = next((b.id for b in ancestor.branches if b.branch_type.value == "MAIN"), None)
        branch = db.get(Branch, branch_id) if branch_id else None
        if branch is None:
            continue
        blocks = message_service.active_message_flow(db, branch)
        flow.extend(blocks)
        sources.append({"chatId": str(ancestor.id), "branchId": str(branch.id), "capturedAt": datetime.now(UTC).isoformat(), "messageCount": len(blocks)})
    return flow, sources


def regenerate(db: Session, user: User, chat: Chat, branch: Branch, block_id: uuid.UUID, answerer=None) -> RegenerateResult:
    api_key = user_setting_service.require_api_key(db, user)
    block = message_service.get_editable_block(db, branch, block_id)
    if block.role is not MessageRole.ASSISTANT: raise NotAssistantBlockError()
    message_service.ensure_generation_complete(block)
    origin = _origin_job(db, block.id)
    if origin is None: return _legacy_regenerate(db, user, chat, branch, block, api_key, answerer)

    block = message_service.add_version(db, chat, block, "", VersionSourceType.AI_REGENERATE)
    block.generation_status = BlockGenerationStatus.GENERATING
    db.commit(); db.refresh(block)
    _pin_current_version(block)

    job = _new_job(user, chat, branch, origin.user_message_block_id, AiResponseJobType.REGENERATE, origin.input_snapshot, origin.id)
    job.assistant_message_block_id = block.id
    job.status = AiResponseJobStatus.GENERATING
    db.add(job); db.commit(); db.refresh(job)
    ai_execution_service.record_input_events(db, job, origin.input_snapshot); db.commit()

    _start_job(job.id, block.id, block.current_version_id, chat.id, user.id, origin.input_snapshot, api_key, answerer)

    return RegenerateResult(block, [], job)


def retry_failed_job(db: Session, user: User, chat: Chat, branch: Branch, job_id: uuid.UUID, titler=None, answerer=None) -> SendResult:
    failed = db.get(AiResponseJob, job_id)
    if failed is None or failed.user_id != user.id or failed.chat_id != chat.id or failed.branch_id != branch.id: raise AiJobNotFoundError()
    if failed.job_type is not AiResponseJobType.GENERATE or failed.status is not AiResponseJobStatus.FAILED: raise AiJobNotRetryableError()
    api_key = user_setting_service.require_api_key(db, user)
    user_block = message_service.get_editable_block(db, branch, failed.user_message_block_id)
    assistant_block = message_service.create_block(
        db, chat, branch, MessageRole.ASSISTANT, "", commit=False,
        allow_empty=True, generation_status=BlockGenerationStatus.GENERATING,
    )
    job = _new_job(user, chat, branch, user_block.id, AiResponseJobType.GENERATE, failed.input_snapshot, failed.id)
    job.assistant_message_block_id = assistant_block.id
    job.status = AiResponseJobStatus.GENERATING
    db.add(job); db.commit(); db.refresh(assistant_block); db.refresh(job)
    _pin_current_version(assistant_block)
    ai_execution_service.record_input_events(db, job, failed.input_snapshot); db.commit()

    snapshot = failed.input_snapshot
    titled = (
        not snapshot["messageFlow"]
        and chat.title == chat_service.DEFAULT_TITLE
        and _try_generate_title(db, chat, snapshot["userPrompt"], api_key, titler)
    )

    _start_job(job.id, assistant_block.id, assistant_block.current_version_id, chat.id, user.id, snapshot, api_key, answerer)

    return SendResult(user_block, assistant_block, _context_from_snapshot(snapshot), bool(titled), snapshot["selectedModelId"], snapshot["webSearchMode"], snapshot.get("reasoningEffort", "medium"), input_assist_service.get_attached_for_snapshot(db, user, chat, snapshot["attachmentIds"]), [], job)


def get_owned_job(db: Session, user: User, chat: Chat, branch: Branch, job_id: uuid.UUID) -> AiResponseJob:
    job = db.get(AiResponseJob, job_id)
    if job is None or job.user_id != user.id or job.chat_id != chat.id or job.branch_id != branch.id:
        raise AiJobNotFoundError()
    return job


def cancel_job(db: Session, user: User, chat: Chat, branch: Branch, job_id: uuid.UUID) -> MessageBlock:
    """생성을 중단한다 . 이미 끝난 작업이면 그대로 현재 상태를 돌려준다."""
    job = get_owned_job(db, user, chat, branch, job_id)
    if job.status is AiResponseJobStatus.GENERATING:
        done = streaming_service.request_cancel(job_id)
        if done is not None:
            done.wait(timeout=_CANCEL_WAIT_SECONDS)
    db.refresh(job)
    return message_service.get_visible_block(db, branch, job.assistant_message_block_id)


def generating_job_ids_for_blocks(db: Session, block_ids: list[uuid.UUID]) -> dict[uuid.UUID, uuid.UUID]:
    """지금 생성 중인 블록이 어느 작업에 속하는지 찾는다 (, 재접속).

    새로고침·브랜치 재진입 때 화면이 이 값으로 스트리밍 통로에 다시 붙는다.
    끝난 블록은 더 붙을 통로가 없으므로 여기 담지 않는다.
    """
    if not block_ids:
        return {}
    rows = db.scalars(
        select(AiResponseJob).where(
            AiResponseJob.assistant_message_block_id.in_(block_ids),
            AiResponseJob.status == AiResponseJobStatus.GENERATING,
        )
    )
    return {job.assistant_message_block_id: job.id for job in rows}


def cleanup_stuck_jobs(db: Session) -> int:
    """서버가 내려갔다 올라왔을 때, 진행 중으로 남은 작업을 실패로 정리한다 .

    이 프로세스의 메모리 중계(streaming_service)는 재시작과 함께 비므로,
    DB에 GENERATING으로 남은 작업은 다시는 끝나지 않는다.
    """
    stuck = list(db.scalars(select(AiResponseJob).where(AiResponseJob.status == AiResponseJobStatus.GENERATING)))
    for job in stuck:
        job.status = AiResponseJobStatus.FAILED
        job.error_code, job.error_message = "AI_SERVER_RESTARTED", "서버가 재시작되어 답변 생성이 중단되었습니다."
        # 재시작 전 진행 상황(생성 시작·첫 조각 시각)은 이 프로세스가 몰라 남기지
        # 않는다 — 정리 시각과 사유만 남긴다(0820_06 A3).
        job.finished_at = datetime.now(UTC)
        block = db.get(MessageBlock, job.assistant_message_block_id) if job.assistant_message_block_id else None
        if block is not None and block.generation_status is BlockGenerationStatus.GENERATING:
            block.generation_status = BlockGenerationStatus.FAILED
    if stuck:
        db.commit()
    return len(stuck)


def _start_job(job_id, block_id, version_id, chat_id, user_id, snapshot, api_key, answerer=None) -> threading.Thread | None:
    if run_jobs_synchronously:
        _run_generation_job(job_id, block_id, version_id, chat_id, user_id, snapshot, api_key, answerer)
        return None
    thread = threading.Thread(
        target=_run_generation_job,
        args=(job_id, block_id, version_id, chat_id, user_id, snapshot, api_key, answerer),
        daemon=True,
    )
    thread.start()
    return thread


def _run_generation_job(job_id, block_id, version_id, chat_id, user_id, snapshot, api_key, answerer=None) -> None:
    streaming_service.start(job_id)
    db = session_factory()
    try:
        job = db.get(AiResponseJob, job_id)
        branch_id = job.branch_id
        job.generation_started_at = datetime.now(UTC)
        chat = db.get(Chat, chat_id)
        block = db.get(MessageBlock, block_id)
        user = db.get(User, user_id)

        parts: list[str] = []
        sources_payload: list[dict] | None = None
        search_invoked = False
        usage = None
        error_code = error_message = None
        cancelled = False

        try:
            req = _request_from_snapshot(db, user, chat, snapshot)
            from modeling import generate_answer_stream

            gen = (answerer or generate_answer_stream)(req, api_key=api_key)
            last_len, last_time = 0, time.monotonic()
            try:
                for chunk in gen:
                    if chunk.type == "text":
                        if job.first_chunk_at is None:
                            # 본문 중간 저장 주기(최대 1.5초)와 별개로 즉시 남긴다 —
                            # 이 값은 관측 조회가 곧바로 봐야 의미가 있다(0820_06 A1).
                            job.first_chunk_at = datetime.now(UTC)
                            db.commit()
                        parts.append(chunk.delta)
                        streaming_service.publish_text(job_id, chunk.delta)
                        now = time.monotonic()
                        total = sum(len(p) for p in parts)
                        if total - last_len >= _SAVE_EVERY_CHARS or now - last_time >= _SAVE_EVERY_SECONDS:
                            message_service.save_streaming_progress(db, version_id, "".join(parts))
                            last_len, last_time = total, now
                    elif chunk.type == "sources":
                        sources_payload = _sources_payload(chunk.sources)
                        streaming_service.publish_sources(job_id, sources_payload or [])
                    elif chunk.type == "done":
                        parts = [chunk.result.text]
                        sources_payload = _sources_payload(chunk.result.search_sources)
                        search_invoked = chunk.result.web_search_invoked
                        usage = chunk.result.usage
                    elif chunk.type == "error":
                        error_code, error_message = _classify_error(RuntimeError(chunk.error))
                    if streaming_service.is_cancel_requested(job_id):
                        cancelled = True
                        break
            finally:
                close = getattr(gen, "close", None)
                if close is not None:
                    close()
        except (KeyError, TypeError, ValueError):
            error_code = error_code or AiInputSnapshotIncompleteError().error_code
            error_message = error_message or AiInputSnapshotIncompleteError().message
        except Exception as exc:
            error_code, error_message = _classify_error(exc)

        final_text = "".join(parts).strip()
        if cancelled:
            status, job_status = BlockGenerationStatus.CANCELLED, AiResponseJobStatus.CANCELLED
        elif error_code:
            status, job_status = BlockGenerationStatus.FAILED, AiResponseJobStatus.FAILED
        elif not final_text:
            status, job_status = BlockGenerationStatus.FAILED, AiResponseJobStatus.FAILED
            error_code, error_message = "AI_RESPONSE_EMPTY", "AI 답변이 비어 있습니다."
        else:
            status, job_status = BlockGenerationStatus.COMPLETE, AiResponseJobStatus.COMPLETED

        message_service.finalize_streaming_block(db, chat, version_id, block, final_text, status, sources_payload)
        job.status = job_status
        job.error_code, job.error_message = error_code, error_message
        job.finished_at = datetime.now(UTC)
        job.usage_summary = ai_execution_service.build_usage_summary(
            snapshot.get("selectedModelId") or "", _provider_for(snapshot.get("selectedModelId")), usage
        )
        ai_execution_service.record_search_event(
            db, job, snapshot.get("webSearchMode", "off"),
            job.generation_started_at or job.finished_at, len(sources_payload or []), search_invoked,
        )
        if status is BlockGenerationStatus.COMPLETE:
            job.result_version_id = version_id
        db.commit()
    finally:
        db.close()

    error_out = {"errorCode": error_code, "message": error_message} if error_code else None
    streaming_service.publish_done(job_id, job_status.value, final_text, sources_payload or [], error_out)
    realtime_service.publish_chat_activity(user_id, chat_id, branch_id)
    realtime_service.publish_chats_changed(user_id)


def _request_from_snapshot(db, user, chat, snapshot):
    required = {"userPrompt", "messageFlow", "appliedContext", "selectedModelId", "webSearchMode", "attachmentIds"}
    if snapshot.get("schemaVersion") != 1 or not required.issubset(snapshot): raise AiInputSnapshotIncompleteError()
    attached = input_assist_service.get_attached_for_snapshot(db, user, chat, snapshot["attachmentIds"])
    from modeling.types import AnswerRequest, ChatTurn
    return AnswerRequest(
        snapshot["userPrompt"],
        [ChatTurn(role=x["role"], content=x["content"]) for x in snapshot["messageFlow"]],
        [x.get("aiContent") or x["content"] for x in snapshot["appliedContext"]],
        input_assist_service.to_modeling_attachments(attached),
        snapshot["webSearchMode"],
        snapshot["selectedModelId"],
        snapshot.get("reasoningEffort", "medium"),
        snapshot.get("projectInstructions", ""),
        snapshot.get("projectMemories", []),
        [x["content"] for x in snapshot.get("selectedLibraryResources", [])],
    )


def _make_snapshot(prompt, flow, context_items, model_id, web_search_mode, attachments, reasoning_effort="medium", parent_context_sources=None, project_instructions="", project_memories=None, selected_library_resources=None) -> dict:
    return {
        "schemaVersion": 1,
        "userPrompt": prompt,
        "messageFlow": [{"role": x.role.value, "content": x.content} for x in flow],
        "appliedContext": [
            {
                "blockId": str(x.block_id),
                "versionId": str(x.version_id),
                "content": x.content,
                "orderIndex": x.order_index,
                "startOffset": x.start_offset,
                "endOffset": x.end_offset,
                "aiContent": x.ai_content or x.content,
            }
            for x in context_items
        ],
        "selectedModelId": model_id,
        "webSearchMode": web_search_mode,
        "reasoningEffort": reasoning_effort,
        "attachmentIds": [str(x.id) for x in attachments],
        "parentContextSources": parent_context_sources or [],
        "projectInstructions": project_instructions,
        "projectMemories": project_memories or [],
        "selectedLibraryResources": selected_library_resources or [],
    }


def _provider_for(model_id: str | None) -> str:
    """usage_summary에 남길 공급자명을 찾는다. 모델을 못 찾으면 'unknown'."""
    from modeling import UnsupportedModelError, resolve_model

    try:
        return resolve_model(model_id).provider
    except UnsupportedModelError:
        return "unknown"


def _sources_payload(sources: list) -> list[dict] | None:
    """검색 근거를 버전에 저장할 JSON 형태로 바꾼다. 없으면 None ."""
    return [{"title": s.title, "url": s.url} for s in sources] or None


def _new_job(user, chat, branch, user_block_id, kind, snapshot, source=None):
    # id를 미리 만들어 직접 넣는다 — mapped_column(default=uuid.uuid4)는 flush 시점에야
    # 채워지므로, 커밋 전인 여기서 job.id를 그냥 읽으면 아직 None이다.
    job_id = uuid.uuid4()
    job = AiResponseJob(id=job_id, user_id=user.id, chat_id=chat.id, branch_id=branch.id, user_message_block_id=user_block_id, source_job_id=source, job_type=kind, status=AiResponseJobStatus.REQUESTED, input_snapshot=snapshot)
    realtime_service.publish_chat_activity(user.id, chat.id, branch.id, job_id)
    return job

def _origin_job(db, assistant_id):
    return db.scalar(select(AiResponseJob).where(AiResponseJob.assistant_message_block_id == assistant_id, AiResponseJob.job_type == AiResponseJobType.GENERATE, AiResponseJob.status == AiResponseJobStatus.COMPLETED).order_by(AiResponseJob.created_at).limit(1))

def _context_from_snapshot(snapshot):
    return [
        context_service.ContextItem(
            uuid.UUID(x["blockId"]),
            uuid.UUID(x["versionId"]),
            x["content"],
            x["orderIndex"],
            start_offset=x.get("startOffset"),
            end_offset=x.get("endOffset"),
            ai_content=x.get("aiContent"),
        )
        for x in snapshot["appliedContext"]
    ]

def _classify_error(exc):
    if isinstance(exc, AiInputSnapshotIncompleteError): return exc.error_code, exc.message
    # 사용자에게는 안전한 요약 메시지만 보여주지만, 원인 파악을 위해
    # 원본 예외는 서버 로그에 남긴다 — 키 값 자체는 여기 담기지 않는다.
    logger.error("ai generation failed: %r", exc, exc_info=exc)
    text = f"{exc.__class__.__name__} {exc}".lower()
    if "timeout" in text: return "AI_TIMEOUT", "AI 응답 시간이 초과되었습니다."
    if "rate" in text or "quota" in text: return "AI_RATE_LIMITED", "AI 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요."
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
