"""모델 목록 조회와 선택값 확정 ."""

from __future__ import annotations

from modeling.config import MODELS
from modeling.types import ModelInfo


class UnsupportedModelError(ValueError):
    """목록에 없는 모델을 골랐을 때. 백엔드는 이 오류를 사용자 안내로 바꾼다."""


def available_models() -> list[ModelInfo]:
    """고를 수 있는 모델 목록 ."""
    return list(MODELS)


def default_model() -> ModelInfo:
    return next(m for m in MODELS if m.is_default)


def resolve_model(model_id: str | None = None) -> ModelInfo:
    """모델 선택값을 확정한다 .

    없는 모델을 골랐을 때 조용히 기본 모델로 넘어가지 않는다. 사용자는 고른
    모델로 답을 받았다고 믿는데 실제로는 다른 모델이 답하기 때문이다.
    """
    if model_id is None or not model_id.strip():
        return default_model()

    wanted = model_id.strip()
    for model in MODELS:
        if model.model_id == wanted:
            return model
    raise UnsupportedModelError(f"지원하지 않는 모델입니다: {wanted}")
