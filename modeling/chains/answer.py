"""답변 생성 체인 (AI-ANSWER-001~004)."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage

from modeling import attachments as attach
from modeling.llm import get_chat_model, resolve_api_key
from modeling.models import resolve_model
from modeling.prompts import answer as prompt
from modeling.types import AnswerChunk, AnswerRequest, AnswerResult, SearchSource, TokenUsage


class EmptyAnswerError(ValueError):
    """모델이 빈 응답을 돌려줬을 때 (AI-ANSWER-003)."""


def build_messages(request: AnswerRequest) -> list[BaseMessage]:
    """모델에 넣을 메시지를 만든다 (AI-ANSWER-001, 002).

    적용된 Context 가 있으면 시스템 메시지에 함께 실어, 이전 대화보다 그쪽을
    우선 보게 한다.
    """
    system = prompt.SYSTEM.format(today=datetime.now().strftime("%Y-%m-%d"))
    if request.project_instructions or request.project_memories:
        memories = "\n\n---\n\n".join(x.strip() for x in request.project_memories if x.strip()) or "(없음)"
        system = f"{system}\n\n{prompt.PROJECT_BLOCK.format(instructions=request.project_instructions.strip() or '(없음)', memories=memories)}"
    if request.selected_library_resources:
        resources = "\n\n---\n\n".join(x.strip() for x in request.selected_library_resources if x.strip())
        system = f"{system}\n\n{prompt.LIBRARY_BLOCK.format(resources=resources)}"
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


def _resolve_model(request: AnswerRequest, api_key: str | None) -> BaseChatModel:
    selected = resolve_model(request.model_id)
    if request.attachments and not selected.supports_attachment:
        raise attach.AttachmentNotSupportedError(
            f"{selected.display_name} 모델은 첨부 입력을 지원하지 않습니다."
        )
    return get_chat_model(
        resolve_api_key(api_key),
        selected.model_id,
        request.web_search_mode,
        reasoning_effort=request.reasoning_effort,
    )


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
        model = _resolve_model(request, api_key)

    response = model.invoke(build_messages(request))
    text = _text_of(response).strip()
    if not text:
        raise EmptyAnswerError("모델이 빈 응답을 돌려줬습니다.")
    return AnswerResult(
        text=text,
        search_sources=extract_sources(response),
        web_search_invoked=web_search_invoked(response),
        usage=extract_usage(response),
    )


def generate_answer_stream(
    request: AnswerRequest,
    model: BaseChatModel | None = None,
    api_key: str | None = None,
) -> Iterator[AnswerChunk]:
    """답변을 조각으로 흘려보낸다 (AI-ANSWER-005).

    입력·모델 선택은 generate_answer와 같다. 다른 점은 본문을 한 번에
    돌려주지 않고, 모델이 만들어내는 대로 text 조각을 하나씩 내보낸다는
    것이다. 다 나오면 sources(있는 경우)와 done(최종 본문)을 순서대로
    내보낸다. 도중 실패하면 error 하나만 내보내고 끝낸다.

    받는 쪽이 순회를 멈추면(break, 제너레이터 close) 그 뒤로는 모델 스트림에서
    다음 조각을 더 당겨오지 않는다 — 파이썬 제너레이터가 원래 그렇게
    동작한다. finally에서 스트림을 명시적으로 닫아, 남은 연결도 정리한다.
    """
    if not request.user_prompt.strip():
        raise ValueError("질문이 비어 있습니다.")

    if model is None:
        model = _resolve_model(request, api_key)

    parts: list[str] = []
    accumulated = None
    stream = model.stream(build_messages(request))
    try:
        for chunk in stream:
            delta = _text_of(chunk)
            if delta:
                parts.append(delta)
                yield AnswerChunk(type="text", delta=delta)
            accumulated = chunk if accumulated is None else accumulated + chunk
    except Exception as exc:
        yield AnswerChunk(type="error", error=str(exc))
        return
    finally:
        close = getattr(stream, "close", None)
        if close is not None:
            close()

    text = "".join(parts).strip()
    if not text:
        yield AnswerChunk(type="error", error="모델이 빈 응답을 돌려줬습니다.")
        return

    sources = extract_sources(accumulated) if accumulated is not None else []
    if sources:
        yield AnswerChunk(type="sources", sources=sources)
    yield AnswerChunk(
        type="done",
        result=AnswerResult(
            text=text,
            search_sources=sources,
            web_search_invoked=web_search_invoked(accumulated) if accumulated is not None else False,
            usage=extract_usage(accumulated) if accumulated is not None else None,
        ),
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

    OpenAI Responses API 는 본문 블록의 `annotations` 에 인라인 인용
    (`url_citation`)을 실어 준다. 같은 자료가 여러 번 인용될 수 있어 주소로
    중복을 없앤다.
    """
    content = getattr(response, "content", None)
    if not isinstance(content, list):
        return []

    sources: list[SearchSource] = []
    seen: set[str] = set()
    for block in content:
        if not isinstance(block, dict):
            continue
        for annotation in block.get("annotations") or []:
            if not isinstance(annotation, dict) or annotation.get("type") != "url_citation":
                continue
            url = annotation.get("url")
            if not url or url in seen:
                continue
            seen.add(url)
            sources.append(SearchSource(title=annotation.get("title") or url, url=url))
    return sources


def web_search_invoked(response) -> bool:
    """공급자가 실제로 검색 도구를 실행했다는 신호가 있는지 본다 (AI-SEARCH-003).

    OpenAI Responses API 는 검색 도구가 실제로 돌면 본문 블록과 별도로
    `web_search_call` 타입 블록을 응답에 함께 싣는다. 인용(url_citation)이
    없어도 이 블록이 있으면 검색은 실행된 것이다 — 반대로 이 신호가 없으면
    검색이 실제로 일어났다고 추정하지 않는다(0820_06 B4, B5).
    """
    content = getattr(response, "content", None)
    if not isinstance(content, list):
        return False
    return any(
        isinstance(block, dict) and block.get("type") == "web_search_call" for block in content
    )


def extract_usage(response) -> TokenUsage | None:
    """공급자가 응답에 실어 준 토큰 사용량을 꺼낸다 (0820_06 D4).

    langchain-openai 는 지원하는 모델의 응답에 `usage_metadata` 를 담아
    준다. 없으면 추정하지 않고 None 을 돌려준다 — 사용량 미상은 0과 다르다.
    """
    usage = getattr(response, "usage_metadata", None)
    if not usage:
        return None
    input_tokens = usage.get("input_tokens")
    output_tokens = usage.get("output_tokens")
    total_tokens = usage.get("total_tokens")
    if input_tokens is None or output_tokens is None or total_tokens is None:
        return None
    return TokenUsage(
        input_tokens=input_tokens, output_tokens=output_tokens, total_tokens=total_tokens
    )
