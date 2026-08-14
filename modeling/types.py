"""백엔드와 주고받는 데이터 구조.

백엔드가 이 타입으로 넘기고 받는다. DB 모델을 직접 참조하지 않으므로
모델링 쪽은 백엔드 없이도 단독으로 실행·테스트할 수 있다.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

Role = Literal["user", "assistant"]


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
    """

    user_prompt: str
    message_flow: list[ChatTurn]
    applied_context: list[str]
