# FlowKit 프로젝트 컨텍스트 안내

작성일: 2026-08-21  
대상: FlowKit의 프론트엔드·백엔드·DB·AI 구조를 처음 파악하는 개발자

## 1. FlowKit은 무엇인가

FlowKit은 사용자가 대화 내용의 일부를 직접 골라 **Context**로 사용하고, 그 근거를 바탕으로 AI와 대화·정제·분기를 이어 가는 웹 애플리케이션이다.

핵심은 AI가 이전 대화를 자동으로 전부 기억하는 방식이 아니라, 사용자가 필요한 메시지 블록 또는 드래그한 문장 범위를 선택해 다음 AI 입력에 넣는 방식이다. 선택한 Context는 전송 시점의 스냅샷으로 저장된다. 이후 원본 대화가 바뀌어도 과거 답변이 무엇을 근거로 생성됐는지 추적할 수 있다.

## 2. 전체 구조

```text
사용자 브라우저
  │
  │ React 화면과 상태 관리
  ▼
frontend/ ── HTTP/SSE ──► backend/ ── SQLAlchemy ──► PostgreSQL
                              │
                              │ Python 패키지 호출
                              ▼
                         modeling/ ──► 선택한 AI 모델 API
```

| 구성 | 역할 | 기본 로컬 주소 또는 위치 |
| --- | --- | --- |
| 프론트엔드 | 화면 표시, 사용자 입력, API·SSE 연결 | `http://localhost:5173` |
| 백엔드 | 인증, 업무 규칙, DB 저장, AI 작업 생성 | `http://127.0.0.1:8000` |
| PostgreSQL | 사용자·대화·메시지·작업 등 영구 데이터 저장 | `127.0.0.1:5432` |
| AI 모델링 | 프롬프트 조립과 모델 호출 | 별도 서버 없음 |
| Redis | Docker 실행 환경에는 포함되지만 현재 서비스 코드의 필수 경로는 아님 | `127.0.0.1:6379` |

`frontend`, `backend`, PostgreSQL은 서로 다른 프로세스다. pgAdmin은 백엔드에 연결하는 도구가 아니라 PostgreSQL에 직접 연결해 DB 구조와 데이터를 보여주는 도구다.

## 3. 저장소 구성

```text
FlowKit/
├── frontend/       React + TypeScript + Vite 화면
├── backend/        FastAPI + SQLAlchemy + Alembic API 서버
├── modeling/       AI 프롬프트와 모델 호출 Python 패키지
├── docs/           계획, 완료 결과, 개발 안내 문서
├── 기획 문서/       확정 요구사항과 기능 명세
└── docker-compose.yml
```

`기획 문서/`는 설계 근거다. 구현과 불일치를 발견해도 먼저 차이를 확인하고, 합의 없이 문서를 고치지 않는다.

## 4. 사용자 관점의 한 번의 대화 흐름

### 4.1 로그인과 초기 화면

1. 브라우저가 프론트엔드를 연다.
2. 프론트엔드는 인증 상태를 확인한다.
3. 로그인한 사용자는 좌측 대화·프로젝트, 중앙 채팅, 우측 Context 패널을 본다.
4. 로그인하지 않은 사용자는 로그인 화면을 본다.

### 4.2 메시지 전송과 AI 답변

1. 사용자가 메시지, 모델, 검색 모드, 추론 강도, 첨부파일, Context를 선택한다.
2. 프론트엔드가 `POST /api/chats/{chatId}/branches/{branchId}/messages`를 호출한다.
3. 백엔드는 사용자·AI 메시지 블록과 AI 응답 작업을 DB에 먼저 저장한다.
4. 백엔드는 입력 스냅샷을 고정하고 백그라운드 작업으로 AI 모델을 호출한다.
5. 프론트엔드는 SSE 스트림에 연결해 생성 중인 답변 조각과 상태를 받는다.
6. 완료·실패·취소 상태와 최종 답변은 DB에 저장된다.

따라서 AI 응답 생성은 단순히 "모델에 질문하고 결과를 바로 돌려주는" 요청이 아니다. 화면에 먼저 생성 상태를 보여주고, 작업 ID를 기준으로 재연결·재시도·취소를 처리한다.

## 5. 프론트엔드 구조

경로: `frontend/src/`

| 폴더·파일 | 역할 |
| --- | --- |
| `main.tsx` | React 앱 시작점과 전역 CSS 연결 |
| `App.tsx` | 로그인 화면 또는 3단 작업 화면 선택, 전역 오류·토스트·확인 창 연결 |
| `components/` | Sidebar, ChatArea, ContextPanel, 메시지, 설정·모달 등 화면 부품 |
| `store/` | Zustand 상태. 인증, 채팅·초안·선택 노드, 알림, 설정, 확인 창을 관리 |
| `api/` | Axios 기반 백엔드 요청. 인증·채팅·대화·프로젝트·설정 등 기능별 분리 |
| `hooks/` | 긴 대화 목차 배치, 대화 목록 페이지네이션 같은 재사용 UI 로직 |
| `lib/` | 스트리밍 Markdown, 첨부파일 사전 검사, 오류 보고, 텍스트 범위 선택 등 |
| `types/api.ts` | 프론트엔드가 주고받는 API 데이터 타입 |

프론트엔드는 DB에 직접 접근하지 않는다. 모든 데이터 읽기·변경은 `api/`를 거쳐 백엔드 API로 요청한다.

## 6. 백엔드 구조

경로: `backend/app/`

```text
main.py
  └─ routers/       URL 요청을 기능별로 받는다
       └─ services/ 업무 규칙과 DB 처리
            ├─ models/  PostgreSQL 테이블 정의
            ├─ schemas/ API 요청·응답 형식 검증
            └─ db.py    DB 연결과 세션
```

| 위치 | 역할 |
| --- | --- |
| `main.py` | FastAPI 앱, CORS, 예외 처리, 라우터 등록, `/health` |
| `routers/` | URL·권한·요청 형식을 받고 서비스를 호출 |
| `services/` | 채팅, 메시지, Context, AI 응답, 첨부파일, 프로젝트, 인증의 실제 규칙 |
| `models/` | SQLAlchemy 테이블과 관계 정의 |
| `schemas/` | Pydantic 요청·응답 형식. API 계약 역할 |
| `deps.py` | 현재 사용자와 DB 세션 같은 공통 의존성 |
| `settings.py` | 환경 변수 읽기 |
| `core/security.py` | 토큰·보안 공통 기능 |
| `alembic/` | PostgreSQL 테이블 구조 변경 이력 |
| `tests/` | API·서비스 단위 테스트 |

새 기능은 보통 `router → service → model/schema → frontend api/store/component` 흐름으로 영향을 준다.

## 7. API 지도

실행 중인 백엔드의 API 명세는 `http://127.0.0.1:8000/docs`에서 가장 정확하게 볼 수 있다. 아래는 기능별 큰 분류다.

| 주소 시작점 | 담당 기능 |
| --- | --- |
| `/api/auth` | Google 로그인, 개발 로그인, 토큰 갱신, 내 프로필, 로그아웃 |
| `/api/chats` | 대화 생성·조회·삭제·제목 변경·분기·대화 노드 |
| `/api/chats/{chatId}/branches/{branchId}/messages` | 메시지 전송과 AI 응답 작업 시작 |
| `/api/chats/.../ai-response-jobs` | 답변 스트림, 재시도, 취소, 실행 정보, 전달 시간 |
| `/api/chats/.../blocks` | 메시지 블록 생성·수정·버전·정제·평가 |
| `/api/chats/.../refine-jobs` | 여러 블록의 AI 정제 작업과 승인·거절 |
| `/api/chats/{chatId}/attachments` | 첨부 업로드·조회·삭제·파일 내려받기 |
| `/api/projects` | 프로젝트, 메모리, 라이브러리 자료, 대화 소속 변경 |
| `/api/settings` | 사용자별 AI API 키, 연결 검사, 서비스 피드백 |
| `/api/models` | 선택 가능한 AI 모델 목록 |
| `/api/client-errors` | 클라이언트 오류 기록 |

API를 눈으로 확인할 때는 `/docs`의 `GET` 요청부터 본다. `POST`, `PATCH`, `DELETE`는 실제 데이터를 만들거나 바꾸므로 테스트 DB가 아닌 현재 로컬 DB에서는 주의한다.

## 8. DB 구조

DB는 PostgreSQL이며, 테이블 정의는 `backend/app/models/`, 실제 DB 변경 이력은 `backend/alembic/versions/`에 있다. pgAdmin에서는 다음 중심 흐름부터 보면 된다.

```text
users
 ├─ auth_sessions                 로그인 세션
 ├─ user_api_keys                 사용자별 암호화된 AI API 키
 ├─ projects
 │   ├─ project_memories          프로젝트 지시·메모리
 │   └─ project_library_resources 프로젝트 자료
 ├─ chats
 │   ├─ branches                  각 채팅의 Main 흐름 및 호환용 분기
 │   │   ├─ message_blocks        사용자·AI 메시지 단위
 │   │   │   ├─ message_block_versions  메시지 수정·재생성 버전
 │   │   │   ├─ message_attachments      첨부 연결
 │   │   │   └─ applied_context_logs     전송 시 선택한 Context 기록
 │   │   ├─ ai_response_jobs      생성·재시도·취소 가능한 AI 작업
 │   │   └─ block_refine_jobs     블록 정제 작업
 │   └─ chat_read_states          사용자별 읽음 상태
 └─ attachments                   업로드 파일 메타데이터
```

### 8.1 꼭 알아둘 테이블

| 테이블 | 저장하는 것 | 관계 |
| --- | --- | --- |
| `users` | 로그인 사용자 | 거의 모든 사용자 데이터의 출발점 |
| `projects` | 여러 대화를 묶는 프로젝트 | 한 사용자에 여러 프로젝트, 프로젝트에 여러 채팅 |
| `chats` | 화면에서 여는 대화 노드 | 사용자 소유, 프로젝트에 선택적으로 소속, 부모 채팅을 참조할 수 있음 |
| `branches` | 채팅 안의 실제 메시지 흐름 | 채팅당 Main 흐름이 있으며 이전 분기 구조와의 호환 정보도 보유 |
| `message_blocks` | 사용자 메시지 또는 AI 답변 | 채팅·브랜치·현재 버전을 가리킴 |
| `message_block_versions` | 한 블록의 수정·재생성 이력 | 하나의 메시지 블록에 여러 버전 |
| `applied_context_logs` / `items` | 메시지 전송 때 사용한 Context 스냅샷 | 사용자의 메시지 블록과 선택된 원본 블록·버전을 연결 |
| `ai_response_jobs` | AI 생성 작업 상태와 입력 스냅샷 | 사용자·채팅·브랜치·입력/출력 블록을 연결 |
| `attachments` / `message_attachments` | 업로드 파일과 어떤 메시지에 붙었는지 | 파일 메타데이터와 메시지의 연결을 분리 |
| `block_refine_jobs` / `targets` / `results` | 블록 정제 후보와 승인 결과 | 정제 요청, 대상, 결과를 분리 |

### 8.2 대화 노드와 Branch의 현재 위치

새 화면의 대화 구조는 `chats` 테이블의 부모·출발 노드 정보를 사용한다. 과거 `branches` 기반 분기 데이터와 일부 API는 한 릴리스 동안 읽기 호환을 위해 남아 있다. 따라서 DB에서 `branches`가 보인다고 해서 화면의 모든 노드가 여전히 독립된 Branch만으로 구성된 것은 아니다.

## 9. Context가 저장되고 쓰이는 방식

Context는 FlowKit의 핵심 데이터 흐름이다.

1. 사용자가 이전 메시지 블록 또는 메시지 내부의 문장 범위를 선택한다.
2. 프론트엔드가 선택한 블록 ID·버전 ID 또는 범위 정보를 메시지 전송 API에 보낸다.
3. 백엔드가 그 시점의 내용으로 Context 스냅샷을 만든다.
4. `applied_context_logs`와 `applied_context_items`에 무엇을 선택했는지 저장한다.
5. 같은 스냅샷을 `ai_response_jobs.input_snapshot`에 넣어 AI 입력을 재현할 수 있게 한다.
6. AI 모델에는 기본 대화 흐름 대신 선택된 Context를 포함한 입력이 전달된다.
7. 전송된 Context 스니펫은 사용자 메시지와 함께 다시 표시된다.

중요한 규칙은 **Context를 선택하면 이전 대화 전체를 자동으로 합치지 않는다**는 것이다. 사용자가 선택한 근거가 AI 입력의 기준이 된다.

## 10. AI 모델링 구조

경로: `modeling/`

| 위치 | 역할 |
| --- | --- |
| `prompts/` | 제목, 정제, 답변에 쓰는 프롬프트 문안 |
| `chains/title.py` | 첫 질문을 짧은 대화 제목으로 생성 |
| `chains/refine.py` | 선택한 메시지 블록을 AI로 정제 |
| `chains/answer.py` | Context·대화·첨부·검색 정보를 합쳐 답변 생성 |
| `attachments.py` | 이미지, PDF, 텍스트 첨부를 모델 입력용으로 준비 |
| `models.py` / `config.py` | 선택 가능한 모델과 기본 옵션 정의 |
| `llm.py` | 사용자 API 키를 받아 모델 클라이언트 생성 |
| `types.py` | 백엔드와 모델링 사이의 데이터 형식 |

모델링은 DB 모델을 직접 읽지 않는다. 백엔드가 DB에서 필요한 대화·Context·첨부 정보를 읽어 모델링 함수에 전달하고, 결과를 다시 DB에 저장한다. 이 분리 덕분에 프롬프트·체인 테스트는 웹 서버나 DB 없이 단독으로 할 수 있다.

AI API 키는 서버 공용 키가 아니라 사용자별 설정값이다. 백엔드는 암호화해 저장한 키를 요청 처리 중에만 복호화해 모델링 함수에 전달한다. 키, 프롬프트 원문, 첨부파일 원문, AI 응답 원문은 오류 로그에 남기지 않는다.

## 11. 첨부파일 흐름

```text
사용자 파일 선택
  → 프론트엔드 형식·크기 사전 검사
  → 업로드 API
  → 로컬 첨부 저장소에 원본 저장
  → attachments 테이블에 메타데이터 저장
  → 메시지 전송 시 message_attachments로 연결
  → AI 입력용 변환 또는 검증
```

허용 형식은 PNG, JPEG, WebP, PDF, TXT, Markdown이며 MIME 타입과 확장자가 맞아야 한다. 파일 하나는 최대 10 MiB, 메시지 하나에는 최대 5개다. 원본 파일은 DB가 아닌 로컬 첨부 저장소에 두고, DB에는 파일 정보와 연결 관계를 저장한다.

## 12. 인증과 환경 변수

| 위치 | 주요 값 | 주의사항 |
| --- | --- | --- |
| `backend/.env` | DB 주소, JWT 비밀값, Google OAuth ID, API 키 암호화 키 | Git에 커밋하지 않음 |
| `frontend/.env` | 백엔드 기본 주소, 공개 Google OAuth ID, 개발 로그인 표시 여부 | `VITE_` 값은 브라우저에 노출될 수 있으므로 비밀값 금지 |
| `backend/.env.example` | 필요한 환경 변수 예시 | 실제 비밀값을 넣는 파일이 아님 |

Google 로그인은 백엔드에서 토큰을 검증하고 자체 토큰을 발급한다. 개발 로그인 API는 기본적으로 꺼져 있고, 켜더라도 루프백 주소 요청만 받도록 제한돼 있다. 배포 환경에서는 사용하지 않는다.

## 13. 로컬 실행과 확인 순서

상세 명령은 [0819_01_FlowKit_로컬_서버_실행_안내.md](0819_01_FlowKit_로컬_서버_실행_안내.md)를 따른다. 큰 순서는 다음과 같다.

1. PostgreSQL을 실행한다.
2. 백엔드 가상환경에서 Alembic 마이그레이션을 적용한다.
3. 백엔드를 `8000` 포트로 실행하고 `/health`를 확인한다.
4. 프론트엔드를 실행하고 `5173` 포트로 연다.
5. 필요한 경우 설정 화면에서 사용자별 AI API 키를 등록한다.

| 확인 목적 | 도구·주소 |
| --- | --- |
| 백엔드가 살아 있는지 | `http://127.0.0.1:8000/health` |
| API 목록과 요청·응답 형식 | `http://127.0.0.1:8000/docs` |
| DB 테이블·관계·데이터 | pgAdmin에서 PostgreSQL `5432` 포트 연결 |
| DB 변경 이력 | `backend/alembic/versions/` |
| 프론트 화면 | `http://localhost:5173` |

pgAdmin에서 처음에는 `users → chats → branches → message_blocks → message_block_versions` 흐름을 펼쳐 보면 대화 데이터의 큰 관계를 빠르게 파악할 수 있다.

## 14. 기능을 수정할 때의 출발점

| 바꾸려는 기능 | 먼저 볼 위치 |
| --- | --- |
| 화면 배치·버튼·표시 | `frontend/src/components/` |
| 화면 상태·전송 흐름 | `frontend/src/store/chatStore.ts` |
| 프론트 API 호출 | `frontend/src/api/` |
| API URL·요청 검증 | `backend/app/routers/`, `backend/app/schemas/` |
| DB 저장 규칙 | `backend/app/services/`, `backend/app/models/` |
| 새 DB 컬럼·테이블 | Alembic 마이그레이션 + `models/` |
| AI 입력·프롬프트·모델 호출 | `modeling/prompts/`, `modeling/chains/`, `modeling/llm.py` |
| 테스트 | 기능과 같은 이름의 `backend/tests/`, `frontend/src/**/*.test.ts(x)`, `modeling/tests/` |

DB 모델만 바꾸고 Alembic 마이그레이션을 만들지 않으면 기존 DB에는 반영되지 않는다. 반대로 프론트 타입만 바꾸고 백엔드 schema를 바꾸지 않으면 API 계약이 어긋난다. 기능 변경 시에는 이 두 연결을 함께 확인한다.

## 15. 현재 확인 시 유의할 점

- 이 문서는 2026-08-21의 현재 코드·실행 중 OpenAPI 명세를 기준으로 한다.
- 작업 트리에 커밋되지 않은 프론트엔드 변경이 있어, 해당 변경의 세부 동작은 확정 구현으로 기록하지 않았다.
- 대화 노드 전환 뒤에도 기존 Branch 구조와 API 일부는 한 릴리스 동안 호환 목적으로 남아 있다.
- 실제 DB 데이터는 개발 중인 사용자·대화·첨부파일을 포함할 수 있다. pgAdmin에서 먼저 조회(`SELECT`, 테이블 보기)만 하고, 수정·삭제 쿼리는 목적을 확인한 뒤 실행한다.
- `docker compose down -v`, Alembic downgrade, pgAdmin의 삭제 기능은 데이터를 되돌리기 어렵게 만들 수 있으므로 일반 확인 목적에는 사용하지 않는다.

## 16. 관련 문서

- [로컬 서버 실행 안내](0819_01_FlowKit_로컬_서버_실행_안내.md)
- [통합 대화 노드 구현과 전환](../02_result/0820_20_통합_대화_노드_구현과_전환.md)
- [전송된 Context 스니펫 대화 내 영구 표시](../02_result/0821_02_전송된_Context_스니펫_대화내_영구_표시.md)
- [모델링 패키지 안내](../../modeling/README.md)
