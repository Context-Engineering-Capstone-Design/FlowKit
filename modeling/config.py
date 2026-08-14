"""모델 설정값."""

from __future__ import annotations

# 정제·제목 생성은 빠르고 저렴한 모델로 충분하다.
DEFAULT_MODEL = "gemini-2.5-flash"

# 정제는 원문을 재구성하는 작업이라 창의성보다 일관성이 중요하다.
REFINE_TEMPERATURE = 0.2
TITLE_TEMPERATURE = 0.3
ANSWER_TEMPERATURE = 0.7

# 제목은 사이드바 한 줄에 들어가야 한다. 백엔드도 200자를 넘기면 저장을 거부한다.
MAX_TITLE_LENGTH = 40

REQUEST_TIMEOUT_SECONDS = 60
