"""FlowKit AI 모델링 패키지.

백엔드가 이 패키지를 직접 import 해서 쓴다. 별도 서버로 뜨지 않는다.
"""

from modeling.attachments import (
    AttachmentNotReadableError,
    AttachmentNotSupportedError,
)
from modeling.chains.answer import EmptyAnswerError, generate_answer, generate_answer_stream
from modeling.chains.refine import EmptyRefineResultError, refine_blocks
from modeling.chains.title import generate_title
from modeling.llm import (
    MissingApiKeyError,
    WebSearchNotSupportedError,
    check_connection,
    configure,
)
from modeling.models import UnsupportedModelError, available_models, resolve_model
from modeling.types import (
    AnswerChunk,
    AnswerRequest,
    AnswerResult,
    Attachment,
    ChatTurn,
    ConnectionResult,
    ModelInfo,
    RefineResult,
    RefineTarget,
    SearchSource,
    ReasoningEffort,
    TokenUsage,
)

__all__ = [
    "generate_answer",
    "generate_answer_stream",
    "refine_blocks",
    "generate_title",
    "available_models",
    "resolve_model",
    "check_connection",
    "configure",
    "MissingApiKeyError",
    "UnsupportedModelError",
    "WebSearchNotSupportedError",
    "AttachmentNotReadableError",
    "AttachmentNotSupportedError",
    "EmptyAnswerError",
    "EmptyRefineResultError",
    "AnswerChunk",
    "AnswerRequest",
    "AnswerResult",
    "Attachment",
    "ChatTurn",
    "ConnectionResult",
    "ModelInfo",
    "RefineTarget",
    "RefineResult",
    "SearchSource",
    "ReasoningEffort",
    "TokenUsage",
]
