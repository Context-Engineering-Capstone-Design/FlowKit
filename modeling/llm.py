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


_api_key: str | None = None


def configure(api_key: str) -> None:
    """쓸 API 키를 지정한다.

    백엔드는 .env 를 자기 설정 객체로 읽기 때문에, 그 값이 프로세스 환경변수에는
    들어가지 않는다. 지정하지 않으면 환경변수를 찾으므로 단독 실행도 그대로 된다.
    """
    global _api_key
    _api_key = api_key.strip() or None
    get_chat_model.cache_clear()


@lru_cache
def get_chat_model(model: str = DEFAULT_MODEL) -> BaseChatModel:
    api_key = _api_key or os.getenv("GOOGLE_API_KEY", "").strip()
    if not api_key:
        raise MissingApiKeyError(
            "GOOGLE_API_KEY 가 설정되지 않았습니다. .env 를 확인해주세요."
        )

    from langchain_google_genai import ChatGoogleGenerativeAI

    return ChatGoogleGenerativeAI(
        model=model,
        google_api_key=api_key,
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
