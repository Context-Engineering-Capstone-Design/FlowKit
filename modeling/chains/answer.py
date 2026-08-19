"""답변 생성 체인 (AI-ANSWER-001~004)."""

from __future__ import annotations

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage

from modeling import attachments as attach
from modeling.llm import get_chat_model, resolve_api_key
from modeling.models import resolve_model
from modeling.prompts import answer as prompt
from modeling.types import AnswerRequest, AnswerResult, SearchSource


def build_messages(request: AnswerRequest) -> list[BaseMessage]:
    """모델에 넣을 메시지를 만든다 (AI-ANSWER-001, 002).

    적용된 Context 가 있으면 시스템 메시지에 함께 실어, 이전 대화보다 그쪽을
    우선 보게 한다.
    """
    system = prompt.SYSTEM
    if request.applied_context:
        joined = "\n\n---\n\n".join(c.strip() for c in request.applied_context if c.strip())
        if joined:
            system = f"{system}\n\n{prompt.CONTEXT_BLOCK.format(context=joined)}"

    messages: list[BaseMessage] = [SystemMessage(content=system)]
    for turn in request.message_flow:
        if turn.role == "user":
            messages.append(HumanMessage(content=turn.content))
        else:
            messages.append(AIMessage(content=turn.content))

    messages.append(_build_question(request))
    return messages


def _build_question(request: AnswerRequest) -> HumanMessage:
    """질문 메시지를 만든다. 첨부가 있으면 함께 싣는다 (AI-ATTACH-001~003)."""
    if not request.attachments:
        return HumanMessage(content=request.user_prompt)

    images, documents = attach.split(request.attachments)

    text = request.user_prompt
    if documents:
        text = f"{attach.document_text(documents)}\n\n{text}"

    if not images:
        return HumanMessage(content=text)

    # 이미지가 있으면 본문을 블록 목록으로 넘긴다. 글자와 이미지를 한 메시지에
    # 담아야 모델이 "이 사진에서" 같은 질문을 이미지와 이어서 읽는다.
    return HumanMessage(content=[{"type": "text", "text": text}, *attach.image_blocks(images)])


def generate_answer(
    request: AnswerRequest,
    model: BaseChatModel | None = None,
    api_key: str | None = None,
) -> AnswerResult:
    """답변을 만든다 (AI-ANSWER-003, 004).

    재생성도 이 함수를 그대로 쓴다. 백엔드가 원래 입력 스냅샷을 복원해 넘기면
    같은 조건으로 다시 생성된다(AI-ANSWER-004).
    """
    if not request.user_prompt.strip():
        raise ValueError("질문이 비어 있습니다.")

    if model is None:
        selected = resolve_model(request.model_id)
        if request.attachments and not selected.supports_attachment:
            raise attach.AttachmentNotSupportedError(
                f"{selected.display_name} 모델은 첨부 입력을 지원하지 않습니다."
            )
        model = get_chat_model(
            resolve_api_key(api_key),
            selected.model_id,
            request.web_search_enabled,
        )

    response = model.invoke(build_messages(request))
    return AnswerResult(
        text=_text_of(response).strip(),
        search_sources=extract_sources(response),
    )


def _text_of(response) -> str:
    """응답 본문을 글자로 꺼낸다.

    검색을 켜면 본문이 블록 목록으로 오는 경우가 있어, 글자 블록만 이어 붙인다.
    """
    content = getattr(response, "content", response)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text", ""))
        return "".join(parts)
    return str(content)


def extract_sources(response) -> list[SearchSource]:
    """검색으로 답한 경우 참고 자료를 꺼낸다 (AI-SEARCH-002).

    근거가 없다고 해서 실패로 보지 않는다. 검색을 켜도 모델이 검색을 쓰지 않고
    답할 수 있다.
    """
    metadata = getattr(response, "response_metadata", None) or {}
    grounding = metadata.get("grounding_metadata") or {}
    sources = []
    for chunk in grounding.get("grounding_chunks") or []:
        web = (chunk or {}).get("web") or {}
        url = web.get("uri")
        if url:
            sources.append(SearchSource(title=web.get("title") or url, url=url))
    return sources
