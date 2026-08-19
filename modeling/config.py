"""모델 설정값."""

from __future__ import annotations

from modeling.types import ModelInfo

# 쓸 수 있는 모델 목록 (AI-CORE-001).
#
# gemini-2.5-flash 는 신규 사용자에게 더 이상 열리지 않아 404 가 난다.
# 목록에 모델을 더할 때는 실제 키로 호출해 보고, 검색·첨부 지원 여부까지
# 확인한 뒤 넣는다. 확인하지 않은 모델을 넣으면 사용자가 고른 뒤에야 실패한다.
MODELS: tuple[ModelInfo, ...] = (
    ModelInfo(
        model_id="gemini-3.6-flash",
        display_name="Gemini 3.6 Flash",
        provider="google",
        supports_web_search=True,
        supports_attachment=True,
        is_default=True,
    ),
)

DEFAULT_MODEL = next(m.model_id for m in MODELS if m.is_default)

# 온도(temperature)는 지정하지 않는다. 이 모델은 샘플링 값을 고정으로 쓰기 때문에
# 넘겨도 무시되고, 호출할 때마다 경고만 남는다. 모델을 바꿔 온도가 필요해지면
# get_chat_model 에 인자를 다시 추가한다.

# 제목은 사이드바 한 줄에 들어가야 한다. 백엔드도 200자를 넘기면 저장을 거부한다.
MAX_TITLE_LENGTH = 40

REQUEST_TIMEOUT_SECONDS = 60

# 연결 확인은 사용자가 버튼을 누르고 기다리는 동작이라 짧게 끊는다 (AI-CORE-006).
CONNECTION_CHECK_TIMEOUT_SECONDS = 15
