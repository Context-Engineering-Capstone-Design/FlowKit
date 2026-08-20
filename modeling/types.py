"""백엔드와 주고받는 데이터 구조.

백엔드가 이 타입으로 넘기고 받는다. DB 모델을 직접 참조하지 않으므로
모델링 쪽은 백엔드 없이도 단독으로 실행·테스트할 수 있다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

Role = Literal["user", "assistant"]
ReasoningEffort = Literal["low", "medium", "high", "xhigh", "max"]


@dataclass(frozen=True)
class ModelInfo:
    """고를 수 있는 모델 하나 (AI-CORE-001).

    지원 여부를 함께 담는다. 검색이나 첨부를 지원하지 않는 모델을 골랐을 때
    호출을 보내고 나서 실패하는 대신, 보내기 전에 막기 위해서다.
    """

    model_id: str
    display_name: str
    provider: str
    supports_web_search: bool
    supports_attachment: bool
    is_default: bool = False
    description: str = ""
    tags: tuple[str, ...] = ()


@dataclass(frozen=True)
class Attachment:
    """질문에 딸려 온 파일 하나 (AI-ATTACH-001, 002).

    content 는 파일 원본 바이트다. 이미지는 그대로 모델에 싣고, 문서는 글자를
    뽑아 질문에 붙인다. 어느 쪽인지는 file_type 으로 가른다.
    """

    attachment_id: str
    file_name: str
    file_type: str
    content: bytes


@dataclass(frozen=True)
class SearchSource:
    """웹 검색으로 답할 때 모델이 참고한 자료 (AI-SEARCH-002)."""

    title: str
    url: str


@dataclass(frozen=True)
class RefineTarget:
    """정제할 블록 하나. content 는 실행 시점의 활성 버전 본문이다."""

    block_id: str
    role: Role
    content: str


@dataclass(frozen=True)
class RefineResult:
    block_id: str
    refined_content: str


@dataclass(frozen=True)
class ChatTurn:
    role: Role
    content: str


@dataclass(frozen=True)
class AnswerRequest:
    """답변 생성 입력.

    applied_context 는 사용자가 선택·정제해 적용한 Context 다. 비어 있으면
    일반 대화처럼 message_flow 만 참고한다.

    뒤쪽 네 항목은 나중에 더한 것이라 기본값이 있다. 첨부와 검색을 쓰지 않는
    기존 호출은 그대로 둔다(AI-ATTACH-003).
    """

    user_prompt: str
    message_flow: list[ChatTurn]
    applied_context: list[str]
    attachments: list[Attachment] = field(default_factory=list)
    web_search_enabled: bool = False
    model_id: str | None = None
    reasoning_effort: ReasoningEffort = "medium"


@dataclass(frozen=True)
class AnswerResult:
    """답변 생성 결과 (AI-ANSWER-003).

    search_sources 는 웹 검색으로 답한 경우에만 채워진다. 검색을 켰더라도
    모델이 검색을 쓰지 않았으면 비어 있다.
    """

    text: str
    search_sources: list[SearchSource] = field(default_factory=list)


@dataclass(frozen=True)
class ConnectionResult:
    """API 키 연결 확인 결과 (AI-CORE-006).

    실패도 정상적인 결과라서 예외가 아니라 값으로 돌려준다.
    """

    success: bool
    reason: str | None = None
