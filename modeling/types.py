"""백엔드와 주고받는 데이터 구조.

백엔드가 이 타입으로 넘기고 받는다. DB 모델을 직접 참조하지 않으므로
모델링 쪽은 백엔드 없이도 단독으로 실행·테스트할 수 있다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

Role = Literal["user", "assistant"]
ReasoningEffort = Literal["low", "medium", "high", "xhigh", "max"]
WebSearchMode = Literal["off", "auto", "always"]


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
class TokenUsage:
    """공급자가 응답에 실어 준 토큰 사용량 (AI-ANSWER-006).

    질문·답변 원문은 담지 않는다. 공급자가 사용량을 안 주면 이 값 자체를
    만들지 않는다 — 0으로 채워 넣지 않는다.
    """

    input_tokens: int
    output_tokens: int
    total_tokens: int


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
    web_search_mode: WebSearchMode = "off"
    model_id: str | None = None
    reasoning_effort: ReasoningEffort = "medium"
    project_instructions: str = ""
    project_memories: list[str] = field(default_factory=list)
    selected_library_resources: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class AnswerResult:
    """답변 생성 결과 (AI-ANSWER-003).

    search_sources 는 웹 검색으로 답한 경우에만 채워진다. 검색을 켰더라도
    모델이 검색을 쓰지 않았으면 비어 있다.

    web_search_invoked 는 공급자가 실제로 검색 도구를 실행했다는 신호
    (AI-SEARCH-003)다. search_sources 가 비어 있어도 실제로는 검색했을 수
    있고, 반대로 이 값이 False 인데 인용만 남는 경우는 없다고 본다. usage
    는 공급자가 사용량을 안 주면 None 이다 — 0으로 추정하지 않는다.
    """

    text: str
    search_sources: list[SearchSource] = field(default_factory=list)
    web_search_invoked: bool = False
    usage: TokenUsage | None = None


@dataclass(frozen=True)
class AnswerChunk:
    """스트리밍 답변 조각 (AI-ANSWER-005).

    type 마다 쓰는 필드가 다르다. text는 delta에 이번에 새로 생긴 글자만
    담는다(누적본이 아니다). sources는 찾은 근거, done은 최종 결과
    (AnswerResult와 동일한 모양), error는 오류 메시지만 채운다.
    """

    type: Literal["text", "sources", "done", "error"]
    delta: str = ""
    sources: list[SearchSource] = field(default_factory=list)
    result: AnswerResult | None = None
    error: str | None = None


@dataclass(frozen=True)
class ConnectionResult:
    """API 키 연결 확인 결과 (AI-CORE-006).

    실패도 정상적인 결과라서 예외가 아니라 값으로 돌려준다.
    """

    success: bool
    reason: str | None = None
