"""블록별 정제 체인 (AI-REFINE-001~004)."""

from __future__ import annotations

from langchain_core.language_models import BaseChatModel
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate

from modeling.llm import get_chat_model, resolve_api_key
from modeling.models import resolve_model
from modeling.prompts import refine as prompt
from modeling.types import RefineResult, RefineTarget

_ROLE_LABEL = {"user": "사용자 질문", "assistant": "AI 답변"}


def build_refine_chain(model: BaseChatModel):
    template = ChatPromptTemplate.from_messages(
        [("system", prompt.SYSTEM), ("human", prompt.HUMAN)]
    )
    return template | model | StrOutputParser()


def refine_blocks(
    targets: list[RefineTarget],
    instruction: str,
    model: BaseChatModel | None = None,
    api_key: str | None = None,
    model_id: str | None = None,
) -> list[RefineResult]:
    """선택된 블록을 하나씩 정제한다 (AI-REFINE-002).

    한 번의 호출로 여러 블록을 처리하면 응답에서 블록 경계를 다시 갈라야 하고,
    그 과정에서 결과가 밀리거나 누락되면 엉뚱한 블록에 반영된다. 블록마다 따로
    호출해 blockId 와 결과가 어긋날 여지를 없앤다.
    """
    if not targets:
        return []
    if not instruction.strip():
        raise ValueError("편집 지시가 비어 있습니다.")

    if model is None:
        model = get_chat_model(resolve_api_key(api_key), resolve_model(model_id).model_id)

    chain = build_refine_chain(model)
    inputs = [
        {
            "instruction": instruction.strip(),
            "role": _ROLE_LABEL.get(t.role, t.role),
            "content": t.content,
        }
        for t in targets
    ]

    outputs = chain.batch(inputs)
    return [
        RefineResult(block_id=t.block_id, refined_content=out.strip())
        for t, out in zip(targets, outputs, strict=True)
    ]
