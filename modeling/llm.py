"""LLM 클라이언트 생성.

체인은 이 함수로 받은 모델을 쓰되, 인자로 다른 모델을 넣을 수도 있다.
테스트에서는 가짜 모델을 넣어 API 키 없이 검증한다.
"""

from __future__ import annotations

import os
from functools import lru_cache

from langchain_core.language_models import BaseChatModel

from modeling.config import DEFAULT_MODEL, REQUEST_TIMEOUT_SECONDS


class MissingApiKeyError(RuntimeError):
    """GOOGLE_API_KEY 가 없을 때. 백엔드는 이 오류를 사용자 안내로 바꿔 보여준다."""


@lru_cache
def get_chat_model(
    temperature: float = 0.3, model: str = DEFAULT_MODEL
) -> BaseChatModel:
    api_key = os.getenv("GOOGLE_API_KEY", "").strip()
    if not api_key:
        raise MissingApiKeyError(
            "GOOGLE_API_KEY 가 설정되지 않았습니다. .env 를 확인해주세요."
        )

    from langchain_google_genai import ChatGoogleGenerativeAI

    return ChatGoogleGenerativeAI(
        model=model,
        google_api_key=api_key,
        temperature=temperature,
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
