"""LLM 클라이언트 생성 (AI-CORE-003, AI-CORE-004, AI-CORE-006).

체인은 이 함수로 받은 모델을 쓰되, 인자로 다른 모델을 넣을 수도 있다.
테스트에서는 가짜 모델을 넣어 API 키 없이 검증한다.
"""

from __future__ import annotations

import os
from functools import lru_cache

from langchain_core.language_models import BaseChatModel

from modeling.config import (
    CONNECTION_CHECK_TIMEOUT_SECONDS,
    REQUEST_TIMEOUT_SECONDS,
)
from modeling.models import resolve_model
from modeling.types import ConnectionResult

# 모델에 내장된 Google 검색 도구 (AI-SEARCH-001). 별도 검색 서비스를 부르지 않는다.
_SEARCH_TOOL = {"google_search": {}}


class MissingApiKeyError(RuntimeError):
    """이번 요청에 쓸 API 키가 없을 때. 백엔드는 REQ-062 안내로 바꿔 보여준다."""


class WebSearchNotSupportedError(ValueError):
    """검색을 지원하지 않는 모델로 검색을 켜서 요청했을 때."""


# 사용자가 키를 등록하기 전까지 쓰는 예비 키다. 백엔드가 서버 시작 시 넣는다.
# 요청에 키가 실려 오면 그 키가 우선이며, 이 값은 보지 않는다.
_fallback_api_key: str | None = None


def configure(api_key: str) -> None:
    """사용자 키가 없을 때 쓸 예비 키를 지정한다.

    백엔드는 .env 를 자기 설정 객체로 읽기 때문에 그 값이 프로세스 환경변수에는
    들어가지 않는다. 사용자별 키 저장소가 붙으면 이 함수는 필요 없어진다.
    """
    global _fallback_api_key
    _fallback_api_key = api_key.strip() or None
    get_chat_model.cache_clear()


def resolve_api_key(api_key: str | None = None) -> str:
    """이번 요청에 쓸 키를 정한다 (AI-CORE-004).

    요청에 실려 온 사용자 키를 먼저 쓴다. 없으면 예비 키를, 그것도 없으면
    환경변수를 본다. 셋 다 없으면 모델을 부르지 않고 오류를 낸다.
    """
    for candidate in (api_key, _fallback_api_key, os.getenv("GOOGLE_API_KEY")):
        if candidate and candidate.strip():
            return candidate.strip()
    raise MissingApiKeyError("API 키가 등록되지 않았습니다. API 키를 등록해주세요.")


@lru_cache(maxsize=32)
def get_chat_model(
    api_key: str,
    model_id: str | None = None,
    web_search_enabled: bool = False,
) -> BaseChatModel:
    """모델 클라이언트를 만든다 (AI-CORE-003).

    키·모델·옵션을 모두 재사용 기준으로 삼는다. 모델 이름만 기준으로 삼으면
    검색을 켠 클라이언트가 검색을 끈 요청에도 쓰이고, 한 사용자의 키가 다른
    사용자 요청에 쓰인다.
    """
    model = resolve_model(model_id)
    if web_search_enabled and not model.supports_web_search:
        raise WebSearchNotSupportedError(
            f"{model.display_name} 모델은 웹 검색을 지원하지 않습니다."
        )

    from langchain_google_genai import ChatGoogleGenerativeAI

    client: BaseChatModel = ChatGoogleGenerativeAI(
        model=model.model_id,
        google_api_key=api_key,
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    if web_search_enabled:
        client = client.bind_tools([_SEARCH_TOOL])
    return client


def check_connection(
    api_key: str | None = None, model_id: str | None = None
) -> ConnectionResult:
    """등록한 키로 모델을 부를 수 있는지 확인한다 (AI-CORE-006).

    연결 확인은 실패가 정상적인 결과다. 예외를 던지지 않고 값으로 돌려준다.
    대화 내용은 넣지 않고, 가장 짧은 요청 하나만 보낸다.
    """
    try:
        key = resolve_api_key(api_key)
    except MissingApiKeyError as exc:
        return ConnectionResult(success=False, reason=str(exc))

    try:
        from langchain_google_genai import ChatGoogleGenerativeAI

        client = ChatGoogleGenerativeAI(
            model=resolve_model(model_id).model_id,
            google_api_key=key,
            timeout=CONNECTION_CHECK_TIMEOUT_SECONDS,
            max_output_tokens=1,
        )
        client.invoke("ping")
    except Exception as exc:
        return ConnectionResult(success=False, reason=_short_reason(exc))
    return ConnectionResult(success=True)


def _short_reason(exc: Exception) -> str:
    """실패 사유를 한 줄로 줄인다.

    Provider 오류 본문에는 요청 정보가 길게 붙는다. 그대로 화면에 내보내면
    사용자가 읽을 수 없고, 키 일부가 섞여 나올 수도 있다.
    """
    text = " ".join(str(exc).split())
    return text[:200] if text else exc.__class__.__name__
