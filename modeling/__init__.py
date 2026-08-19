"""FlowKit AI 모델링 패키지.

백엔드가 이 패키지를 직접 import 해서 쓴다. 별도 서버로 뜨지 않는다.
"""

from modeling.attachments import (
    AttachmentNotReadableError,
    AttachmentNotSupportedError,
)
from modeling.chains.answer import generate_answer
from modeling.chains.refine import refine_blocks
from modeling.chains.title import generate_title
from modeling.llm import (
    MissingApiKeyError,
    WebSearchNotSupportedError,
    check_connection,
    configure,
)
from modeling.models import UnsupportedModelError, available_models, resolve_model
from modeling.types import (
    AnswerRequest,
    AnswerResult,
    Attachment,
    ChatTurn,
    ConnectionResult,
    ModelInfo,
    RefineResult,
    RefineTarget,
    SearchSource,
)

__all__ = [
    "generate_answer",
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
    "AnswerRequest",
    "AnswerResult",
    "Attachment",
    "ChatTurn",
    "ConnectionResult",
    "ModelInfo",
    "RefineTarget",
    "RefineResult",
    "SearchSource",
]
