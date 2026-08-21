# FlowKit AI 모델링

Context 정제, 채팅 제목 생성, 답변 생성을 담당한다. 별도 서버로 뜨지 않고 백엔드가 파이썬 패키지로 가져다 쓴다.

## 단독으로 작업하기

백엔드나 DB 없이 프롬프트와 체인만 다룰 때 쓴다.

```bash
cd modeling
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
pytest tests/ -q
```

테스트는 실제 API를 부르지 않으므로 API 키 없이 돌아간다.

실제 모델로 확인하려면 키가 필요하다. `modeling/.env`를 자동으로 읽지는
않으므로 별도 `.env` 파일은 필요하지 않다. 셸 환경 변수로 넘기거나 함수의
`api_key` 인자로 직접 전달한다.

```bash
export OPENAI_API_KEY=...
```

## 백엔드에서 쓰기

백엔드 가상환경에 이 패키지를 설치하면 import된다.

```bash
cd backend && source .venv/bin/activate
pip install -e ../modeling
```

**의존성을 바꿨으면 백엔드 환경에도 다시 설치해야 한다.** 두 환경이 따로라 여기서만 올리면 단독 테스트는 통과하는데 서버에서는 실패한다.

백엔드는 `modeling/.env`나 서버 공용 `OPENAI_API_KEY`를 사용하지 않는다.
설정 화면에 등록된 현재 사용자의 키를 복호화해 각 함수의 `api_key` 인자로
전달한다. 백엔드에는 사용자 키 암호화를 위한 `API_KEY_ENCRYPTION_KEY`가 필요하다.

## 구조

```
modeling/
├── types.py      백엔드와 주고받는 데이터 구조
├── config.py     모델명, 온도, 길이 제한
├── llm.py        모델 생성 (API 키 확인)
├── prompts/      프롬프트 문안
└── chains/       실제 동작
```

DB 모델을 참조하지 않고 위 데이터 구조로만 주고받는다. 그래서 백엔드 없이도 단독 실행이 된다.

## 모델

쓸 수 있는 모델은 `config.py` 의 `MODELS` 에 정의한다. 현재는 Sol(`gpt-5.6-sol`) · Terra(`gpt-5.6-terra`) · Luna(`gpt-5.6-luna`, 기본) 세 가지다.

목록에 모델을 더할 때는 실제 키로 호출해 보고 검색·첨부 지원 여부까지 확인한 뒤 넣는다. 확인하지 않은 모델을 넣으면 사용자가 고른 뒤에야 실패한다.

이 모델들은 추론 모델이라 온도(temperature)를 지정하지 않는다. 넘기면 거부되거나 조용히 무시된다. 추론 단계(reasoning effort)는 `config.py` 의 `DEFAULT_REASONING_EFFORT` 로 고정해 둔다. 사용자가 단계를 고르는 화면은 아직 없다.

사용 가능한 모델은 아래로 확인한다.

```python
from openai import OpenAI
client = OpenAI(api_key="...")
for m in client.models.list():
    print(m.id)
```

## 하는 일

| 기능 | 함수 | 관련 명세 |
| --- | --- | --- |
| 블록별 정제 | `refine_blocks(targets, instruction, api_key=..., model_id=...)` |  |
| 채팅 제목 생성 | `generate_title(user_prompt, api_key=...)` |  |
| 답변 생성 | `generate_answer(request, api_key=...)` |  |
| 모델 목록 조회 | `available_models()` |  |
| 모델 선택값 확정 | `resolve_model(model_id)` |  |
| API 키 연결 확인 | `check_connection(api_key)` |  |

### API 키는 요청마다 받는다

사용자가 자기 키를 등록해 쓰는 구조라, 키를 모듈 전체가 공유하는 값으로 두지 않는다. 호출할 때마다 `api_key` 로 넘긴다.

`configure()`는 단독 호출부와의 호환을 위한 예비 함수다. 백엔드는 사용하지 않는다.

### 답변 생성은 결과 객체를 돌려준다

`generate_answer` 는 글자가 아니라 `AnswerResult` 를 돌려준다. 본문은 `.text`, 웹 검색 근거는 `.search_sources` 다. 검색을 켜도 모델이 검색을 쓰지 않으면 근거는 비어 있고, 그것을 실패로 보지 않는다.

### 첨부는 종류에 따라 다르게 넣는다

이미지는 글자로 바꾸지 않고 그대로 싣는다. PDF 와 텍스트 파일은 글자를 뽑아 질문 앞에 파일 이름과 함께 붙인다. 글자를 뽑지 못하면 조용히 넘기지 않고 오류를 낸다. 넘기면 사용자는 첨부가 반영된 줄 알고 답을 받기 때문이다.

### 정제는 블록마다 따로 호출한다

여러 블록을 한 번에 보내고 결과를 나눠 받으면, 응답에서 블록 경계를 다시 갈라야 한다. 이때 순서가 밀리거나 하나가 빠지면 **엉뚱한 블록에 다른 내용이 반영된다.** 사용자는 A 블록을 승인했는데 B 내용이 들어가는 셈이라 눈치채기도 어렵다.

블록마다 따로 호출하면 이 문제가 아예 생기지 않는다. 호출 수는 늘지만 동시에 처리하므로 체감 속도 차이는 크지 않다.

### 제목은 여기서 다듬는다

백엔드는 줄바꿈이 섞이거나 너무 긴 제목을 거부한다. 모델이 따옴표를 붙이거나 여러 줄로 답하는 경우가 있어, 저장 전에 이쪽에서 정리한다.

## 프롬프트를 고칠 때

`prompts/`의 문안만 바꾸면 되고 체인 코드는 건드리지 않아도 된다. 바꾼 뒤에는 `pytest tests/ -q`로 조립이 깨지지 않았는지 확인한다.

테스트는 모델 응답 내용이 아니라 **입력이 제대로 조립되는지, 결과가 올바른 블록에 붙는지**를 본다. 답변 품질은 실제 키로 직접 확인해야 한다.
