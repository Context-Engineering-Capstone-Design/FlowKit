"""모델 설정값."""

from __future__ import annotations

from modeling.types import ModelInfo

# 쓸 수 있는 모델 목록 (AI-CORE-001).
#
# 목록에 모델을 더할 때는 실제 키로 호출해 보고, 검색·첨부 지원 여부까지
# 확인한 뒤 넣는다. 확인하지 않은 모델을 넣으면 사용자가 고른 뒤에야 실패한다.
MODELS: tuple[ModelInfo, ...] = (
    ModelInfo(
        model_id="gpt-5.6-terra",
        display_name="Terra",
        provider="openai",
        supports_web_search=True,
        supports_attachment=True,
        is_default=True,
        description="일반 채팅에 쓰는 균형 잡힌 기본 모델",
        tags=("기본", "균형"),
    ),
    ModelInfo(
        model_id="gpt-5.6-sol",
        display_name="Sol",
        provider="openai",
        supports_web_search=True,
        supports_attachment=True,
        is_default=False,
        description="복잡한 질문에 강한 고품질 모델",
        tags=("고품질",),
    ),
    ModelInfo(
        model_id="gpt-5.6-luna",
        display_name="Luna",
        provider="openai",
        supports_web_search=True,
        supports_attachment=True,
        is_default=False,
        description="가볍고 빠르게 답하는 저비용 모델",
        tags=("빠름", "저비용"),
    ),
)

DEFAULT_MODEL = next(m.model_id for m in MODELS if m.is_default)

# 온도(temperature)는 지정하지 않는다. 추론 모델은 온도 값을 무시하거나
# 1 고정으로만 허용해, 넘기면 거부되거나 조용히 무시된다.
#
# 추론 단계(reasoning effort)는 사용자가 아직 고를 수 없으므로 기본값으로
# 고정한다. 값을 고르는 화면과 요청 경로는 별도 마일스톤에서 붙인다.
DEFAULT_REASONING_EFFORT = "medium"

# 제목은 사이드바 한 줄에 들어가야 한다. 백엔드도 200자를 넘기면 저장을 거부한다.
MAX_TITLE_LENGTH = 40

REQUEST_TIMEOUT_SECONDS = 60

# 연결 확인은 사용자가 버튼을 누르고 기다리는 동작이라 짧게 끊는다 (AI-CORE-006).
CONNECTION_CHECK_TIMEOUT_SECONDS = 15
