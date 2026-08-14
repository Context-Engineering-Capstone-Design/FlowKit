"""모델 설정값."""

from __future__ import annotations

# 정제·제목 생성은 빠르고 저렴한 모델로 충분하다.
# gemini-2.5-flash 는 신규 사용자에게 더 이상 열리지 않아 404 가 난다.
DEFAULT_MODEL = "gemini-3.6-flash"

# 온도(temperature)는 지정하지 않는다. 이 모델은 샘플링 값을 고정으로 쓰기 때문에
# 넘겨도 무시되고, 호출할 때마다 경고만 남는다. 모델을 바꿔 온도가 필요해지면
# get_chat_model 에 인자를 다시 추가한다.

# 제목은 사이드바 한 줄에 들어가야 한다. 백엔드도 200자를 넘기면 저장을 거부한다.
MAX_TITLE_LENGTH = 40

REQUEST_TIMEOUT_SECONDS = 60
