"""채팅 제목 생성 체인 (BE-CHAT-004)."""

from __future__ import annotations

from langchain_core.language_models import BaseChatModel
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate

from modeling.config import MAX_TITLE_LENGTH
from modeling.llm import get_chat_model
from modeling.prompts import title as prompt


def build_title_chain(model: BaseChatModel | None = None):
    llm = model or get_chat_model()
    template = ChatPromptTemplate.from_messages(
        [("system", prompt.SYSTEM), ("human", prompt.HUMAN)]
    ).partial(max_length=str(MAX_TITLE_LENGTH))
    return template | llm | StrOutputParser()


def generate_title(user_prompt: str, model: BaseChatModel | None = None) -> str:
    """첫 사용자 질문으로 대화 제목을 짓는다.

    백엔드는 줄바꿈이 섞이거나 너무 긴 제목을 거부하므로 여기서 미리 다듬는다.
    """
    if not user_prompt.strip():
        raise ValueError("제목을 지을 질문이 비어 있습니다.")

    raw = build_title_chain(model).invoke({"prompt": user_prompt.strip()})
    return _clean(raw)


def _clean(raw: str) -> str:
    text = " ".join(raw.split())
    text = text.strip().strip('"').strip("'").rstrip(".")
    if len(text) > MAX_TITLE_LENGTH:
        text = text[:MAX_TITLE_LENGTH].rstrip()
    return text
