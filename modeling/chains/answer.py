"""답변 생성 체인 (BE-AIRESP-001)."""

from __future__ import annotations

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_core.output_parsers import StrOutputParser

from modeling.llm import get_chat_model
from modeling.prompts import answer as prompt
from modeling.types import AnswerRequest


def build_messages(request: AnswerRequest) -> list[BaseMessage]:
    """모델에 넣을 메시지를 만든다.

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

    messages.append(HumanMessage(content=request.user_prompt))
    return messages


def generate_answer(
    request: AnswerRequest, model: BaseChatModel | None = None
) -> str:
    if not request.user_prompt.strip():
        raise ValueError("질문이 비어 있습니다.")

    llm = model or get_chat_model()
    chain = llm | StrOutputParser()
    return chain.invoke(build_messages(request)).strip()
