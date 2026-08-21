# FlowKit DB 테이블 구조 안내

작성일: 2026-08-21  
대상: pgAdmin으로 FlowKit PostgreSQL 구조를 처음 확인하는 개발자

## 1. 이 문서의 기준과 보는 법

이 문서는 `backend/app/models/`의 SQLAlchemy 모델과 Alembic 마이그레이션을 기준으로 작성했다. 작성 시점 로컬 DB의 Alembic 버전은 `a82021merge (head)`다.

- DB 종류: PostgreSQL
- 스키마: 기본 `public`
- 기본 키: 대부분 UUID `id`
- 시간 열: `TimestampMixin`을 쓰는 테이블에는 `created_at`, `updated_at`이 공통으로 있다.
- `FK`는 다른 테이블의 행을 가리키는 외래 키(Foreign Key)다.
- `CASCADE`는 부모 행을 지우면 연결된 자식 행도 함께 삭제한다는 뜻이다.
- 이 문서의 예시 SQL은 조회 전용이다. pgAdmin에서 실행 전 대상 DB가 로컬 개발 DB인지 먼저 확인한다.

## 2. 전체 관계 한눈에 보기

### 2.1 사용자·프로젝트·대화

```text
users
 ├─ auth_sessions
 ├─ user_api_keys
 ├─ projects
 │   ├─ project_memories
 │   └─ project_library_resources
 ├─ chats
 │   ├─ chat_read_states
 │   └─ branches
 │       ├─ message_blocks
 │       │   ├─ message_block_versions
 │       │   ├─ message_attachments ── attachments
 │       │   ├─ applied_context_logs ── applied_context_items
 │       │   └─ ai_response_feedbacks
 │       ├─ ai_response_jobs
 │       └─ block_refine_jobs
 └─ service_feedbacks
```

### 2.2 대화 노드·메시지·AI 작업

```text
chats ───── 1:N ────► branches ───── 1:N ────► message_blocks
  │                                                │
  │ self FK: 부모·출발 지점                         ├─ 1:N → message_block_versions
  │                                                ├─ 1:N → message_attachments
  └─ project_id → projects                         ├─ 1:N → applied_context_logs
                                                   └─ AI 입력·출력 → ai_response_jobs

ai_response_jobs ── 1:N ──► ai_execution_events
                 └─ 1:1 ──► ai_delivery_timings
```

## 3. pgAdmin에서 확인하는 순서

왼쪽 트리에서 아래 순서로 펼친다.

```text
Servers
  → FlowKit local
    → Databases
      → flowkit
        → Schemas
          → public
            → Tables
```

테이블 이름을 우클릭해 다음 기능을 쓴다.

| 목적 | pgAdmin 메뉴 |
| --- | --- |
| 열·외래 키·제약 확인 | `Properties` → `Columns`, `Constraints` |
| 실제 데이터 일부 보기 | `View/Edit Data` → `All Rows` 또는 `First 100 Rows` |
| 관계 그림 보기 | `Tools` → `ERD Tool`에서 필요한 테이블 추가 |
| 조회 SQL 실행 | `Tools` → `Query Tool` |

처음에는 `users → chats → branches → message_blocks → message_block_versions` 순서로 보면 된다. 사용자가 보낸 한 문장과 AI 답변 한 개가 어떻게 저장되는지 가장 빨리 이해할 수 있다.

## 4. 공통 규칙

### 4.1 ID와 시간

대부분의 테이블은 UUID `id`를 기본 키로 사용한다. `TimestampMixin`이 적용된 테이블에는 다음 열이 자동으로 있다.

| 열 | 의미 |
| --- | --- |
| `created_at` | 행이 처음 만들어진 시각 |
| `updated_at` | 마지막으로 수정된 시각 |

`applied_context_items`, `branch_source_context_items`, `error_logs`, `client_error_logs`처럼 공통 믹스인을 쓰지 않는 테이블은 이 규칙의 예외다.

### 4.2 메시지 원문은 버전에 저장한다

`message_blocks`에는 메시지의 위치·역할·현재 버전만 있고, 실제 본문은 `message_block_versions.content`에 저장한다. 메시지를 수정하거나 AI 답변을 재생성해도 기존 버전을 덮어쓰지 않고 새 버전을 만든 뒤 `current_version_id`만 바꾼다.

### 4.3 삭제 관계

대화·프로젝트·사용자를 삭제하면 관련 데이터 다수가 `CASCADE`로 함께 삭제된다. 반면 AI 응답 작업의 결과 블록·결과 버전처럼 기록이 일부 남아도 되는 관계는 `SET NULL`을 사용한다. pgAdmin에서 행을 직접 삭제하면 이 연쇄 삭제가 일어날 수 있으므로, 일반 확인 목적에는 `DELETE`를 실행하지 않는다.

## 5. 사용자와 인증

### `users`

서비스의 모든 데이터 소유자를 나타낸다.

| 열 | 타입·연결 | 의미 |
| --- | --- | --- |
| `id` | UUID PK | 사용자 식별자 |
| `google_user_id` | 문자열, 고유 | Google 계정 식별자 |
| `email` | 문자열, 고유 | 로그인 이메일 |
| `name` | 문자열 | 표시 이름 |
| `profile_image` | 텍스트, 선택 | 프로필 이미지 주소 |
| `memo` | 텍스트, 선택 | 사용자 메모 |
| `created_at`, `updated_at` | 시간 | 생성·수정 시각 |

### `auth_sessions`

로그인 유지와 refresh token 회전을 위한 세션이다. 토큰 원문 대신 해시만 저장한다.

| 열 | 타입·연결 | 의미 |
| --- | --- | --- |
| `id` | UUID PK | 세션 식별자 |
| `user_id` | FK → `users.id` | 세션 소유자 |
| `refresh_token_hash` | 문자열, 고유 | refresh token 해시 |
| `expires_at` | 시간 | 세션 만료 시각 |
| `revoked_at` | 시간, 선택 | 로그아웃·폐기 시각 |
| `device_info` | 문자열, 선택 | 접속 기기 정보 |

### `user_api_keys`

사용자가 설정 화면에 등록한 AI 공급자 키의 상태를 저장한다.

| 열 | 타입·연결 | 의미 |
| --- | --- | --- |
| `id` | UUID PK | 키 레코드 식별자 |
| `user_id` | FK → `users.id` | 키 소유자 |
| `provider` | 문자열 | AI 공급자 이름 |
| `encrypted_api_key` | 텍스트 | 암호화된 키. 직접 열람·공유 금지 |
| `last4` | 문자열 4자 | 화면 표시용 끝 네 글자 |
| `connection_status` | enum | `unchecked`, `connected`, `failed` |
| `connection_message` | 문자열, 선택 | 연결 검사 결과 메시지 |
| `last_checked_at` | 시간, 선택 | 마지막 연결 검사 시각 |

제약: 같은 사용자와 공급자 조합은 하나만 가능하다. (`user_id`, `provider` 고유)

## 6. 프로젝트와 장기 Context

### `projects`

여러 대화를 한 작업 단위로 묶는다.

| 열 | 타입·연결 | 의미 |
| --- | --- | --- |
| `id` | UUID PK | 프로젝트 식별자 |
| `owner_id` | FK → `users.id` | 소유자 |
| `name` | 문자열 | 프로젝트 이름 |
| `instructions` | 텍스트 | 프로젝트 공통 지시문 |

### `project_memories`

프로젝트가 기억해야 할 메모를 순서대로 저장한다.

| 열 | 타입·연결 | 의미 |
| --- | --- | --- |
| `id` | UUID PK | 메모 식별자 |
| `project_id` | FK → `projects.id` | 소속 프로젝트 |
| `content` | 텍스트 | 메모 본문 |
| `order_index` | 정수 | 프롬프트에 넣을 순서 |

### `project_library_resources`

프로젝트에서 재사용할 자료의 제목·본문·원본 주소를 저장한다.

| 열 | 타입·연결 | 의미 |
| --- | --- | --- |
| `id` | UUID PK | 자료 식별자 |
| `project_id` | FK → `projects.id` | 소속 프로젝트 |
| `title` | 문자열 | 자료 제목 |
| `content` | 텍스트 | 자료 본문 |
| `source_url` | 문자열, 선택 | 원본 URL |
| `order_index` | 정수 | 목록 순서 |

### `project_library_selections`

특정 메시지를 전송할 때 어떤 라이브러리 자료를 선택했는지의 스냅샷이다. 원본 자료가 나중에 바뀌어도 전송 당시 `content`를 유지한다.

| 열 | 타입·연결 | 의미 |
| --- | --- | --- |
| `id` | UUID PK | 선택 기록 식별자 |
| `project_id` | FK → `projects.id` | 소속 프로젝트 |
| `resource_id` | FK → `project_library_resources.id` | 원본 자료 |
| `message_block_id` | FK → `message_blocks.id` | 자료를 사용한 사용자 메시지 |
| `content` | 텍스트 | 전송 시점 자료 본문 |
| `order_index` | 정수 | AI 입력 순서 |

제약: 한 메시지가 같은 자료를 두 번 선택할 수 없다. (`message_block_id`, `resource_id` 고유)

## 7. 대화 구조

### `chats`

화면에 표시되는 대화 노드다. 최상위 대화와 사이드 대화, 분기에서 생성된 새 노드를 함께 표현한다.

| 열 | 타입·연결 | 의미 |
| --- | --- | --- |
| `id` | UUID PK | 대화 식별자 |
| `owner_id` | FK → `users.id` | 소유자 |
| `title` | 문자열 | 대화 제목. 기본값 `새 대화` |
| `project_id` | FK → `projects.id`, 선택 | 소속 프로젝트. 없으면 프로젝트 밖 대화 |
| `last_activity_at` | 시간 | 최근 활동 기준 정렬 시각 |
| `kind` | enum | `MAIN` 또는 `SIDE` |
| `parent_chat_id` | FK → `chats.id`, 선택 | 좌측 트리에서의 구조적 부모 |
| `parent_branch_id` | FK → `branches.id`, 선택 | 부모에서 갈라진 브랜치 북마크 |
| `parent_message_block_id` | FK → `message_blocks.id`, 선택 | 부모에서 갈라진 메시지 지점 |
| `root_chat_id` | FK → `chats.id`, 선택 | 자동 참고의 루트 대화 |
| `root_branch_id` | FK → `branches.id`, 선택 | 자동 참고의 루트 흐름 |
| `forked_from_chat_id` | FK → `chats.id`, 선택 | 통합 노드의 원본 대화 |
| `forked_from_message_block_id` | FK → `message_blocks.id`, 선택 | 통합 노드의 출발 메시지 |
| `legacy_branch_id` | FK → `branches.id`, 선택·고유 | 기존 `branchId` 링크를 읽기 호환하기 위한 키 |
| `is_temporary` | 불리언 | 임시 사이드 대화인지 여부 |
| `temporary_expires_at` | 시간, 선택 | 임시 대화 만료 시각 |

### `branches`

채팅 안에서 메시지가 쌓이는 실제 흐름이다. 현재 화면의 새 대화 노드는 `chats` 중심으로 표현하지만, 기존 분기 구조와 API 호환을 위해 `branches`는 계속 남아 있다.

| 열 | 타입·연결 | 의미 |
| --- | --- | --- |
| `id` | UUID PK | 브랜치 식별자 |
| `chat_id` | FK → `chats.id` | 소속 채팅 |
| `name` | 문자열 | 브랜치 이름 |
| `branch_type` | enum | `MAIN` 또는 `CHILD` |
| `parent_branch_id` | FK → `branches.id`, 선택 | 원본 브랜치 |
| `base_message_block_id` | FK → `message_blocks.id`, 선택 | 부모에서 상속받는 마지막 메시지 |

`CHILD` 브랜치는 조상 메시지를 전부 복사하지 않고, 부모 브랜치와 출발 메시지를 따라가며 필요한 흐름을 구성하는 참조형 구조다.

### `chat_read_states`

사용자가 어떤 대화를 마지막으로 본 시각을 저장한다.

| 열 | 타입·연결 | 의미 |
| --- | --- | --- |
| `id` | UUID PK | 읽음 상태 식별자 |
| `user_id` | FK → `users.id` | 사용자 |
| `chat_id` | FK → `chats.id` | 대화 |
| `last_seen_at` | 시간 | 마지막 확인 시각 |

제약: 한 사용자와 대화 조합에는 행이 하나다. (`user_id`, `chat_id` 고유)

### `branch_source_contexts`, `branch_source_context_items`

과거 Branch 기반 분기가 어떤 원본 Context에서 출발했는지 보관한다.

| 테이블 | 주요 열 | 의미 |
| --- | --- | --- |
| `branch_source_contexts` | `branch_id` FK·고유, `source_branch_id` FK 선택 | 브랜치 하나의 출발 Context 묶음 |
| `branch_source_context_items` | `source_context_id` FK, `source_message_block_id` FK, `order_index` | 묶음 안의 원본 메시지와 순서 |

AI 요약본을 저장하는 테이블이 아니라 원본 메시지 블록을 가리키는 참조 기록이다.

## 8. 메시지와 버전

### `message_blocks`

대화 안의 한 번의 사용자 메시지 또는 AI 답변을 나타낸다.

| 열 | 타입·연결 | 의미 |
| --- | --- | --- |
| `id` | UUID PK | 메시지 블록 식별자 |
| `chat_id` | FK → `chats.id` | 소속 대화 |
| `branch_id` | FK → `branches.id` | 소속 흐름 |
| `role` | enum | `user` 또는 `assistant` |
| `order_index` | 정수 | 브랜치 안에서의 순서 |
| `current_version_id` | FK → `message_block_versions.id`, 선택 | 화면에 보일 현재 본문 버전 |
| `generation_status` | enum | `generating`, `complete`, `cancelled`, `failed` |

제약: 같은 브랜치에서 같은 `order_index`는 하나뿐이다. (`branch_id`, `order_index` 고유)

### `message_block_versions`

메시지 본문과 수정·정제·재생성 이력을 저장한다.

| 열 | 타입·연결 | 의미 |
| --- | --- | --- |
| `id` | UUID PK | 버전 식별자 |
| `block_id` | FK → `message_blocks.id` | 원본 메시지 블록 |
| `version_no` | 정수 | 블록 안의 버전 번호 |
| `content` | 텍스트 | 실제 메시지 본문 |
| `source_type` | enum | `original`, `user_edit`, `ai_refine`, `ai_regenerate` |
| `search_sources` | JSON, 선택 | 웹 검색 근거 목록. 검색하지 않았거나 없으면 비어 있음 |

제약: 같은 블록에서 같은 버전 번호는 하나뿐이다. (`block_id`, `version_no` 고유)

## 9. Context 기록

### `applied_context_logs`

사용자가 메시지를 전송할 때 확정한 Context의 상위 기록이다. 전송 전 입력창에서만 보이는 선택 상태는 DB에 저장하지 않는다.

| 열 | 타입·연결 | 의미 |
| --- | --- | --- |
| `id` | UUID PK | Context 기록 식별자 |
| `chat_id` | FK → `chats.id` | 전송한 대화 |
| `branch_id` | FK → `branches.id` | 전송한 흐름 |
| `user_message_block_id` | FK → `message_blocks.id` | Context를 사용해 보낸 사용자 메시지 |

### `applied_context_items`

한 전송에 선택한 각각의 원본 메시지·버전·스니펫을 저장한다.

| 열 | 타입·연결 | 의미 |
| --- | --- | --- |
| `id` | UUID PK | 항목 식별자 |
| `log_id` | FK → `applied_context_logs.id` | 상위 Context 기록 |
| `source_block_id` | FK → `message_blocks.id` | 선택 원본 메시지 |
| `version_id` | FK → `message_block_versions.id` | 실제 입력에 사용한 원본 버전 |
| `content` | 텍스트 | 선택된 문장 또는 메시지 스냅샷 |
| `order_index` | 정수 | AI 입력 순서 |

이 구조 덕분에 원본 메시지가 나중에 수정돼도, 과거 AI 답변에 사용한 Context를 재현할 수 있다.

## 10. 첨부파일

### `attachments`

실제 파일의 메타데이터와 저장 상태를 보관한다. 파일 원본은 DB가 아니라 로컬 첨부 저장소에 있다.

| 열 | 타입·연결 | 의미 |
| --- | --- | --- |
| `id` | UUID PK | 첨부 식별자 |
| `user_id` | FK → `users.id` | 업로드 사용자 |
| `chat_id` | FK → `chats.id` | 업로드 대상 대화 |
| `file_name` | 문자열 | 원본 파일명 |
| `mime_type` | 문자열 | MIME 타입 |
| `file_size` | 정수 | 바이트 단위 크기 |
| `storage_key` | 문자열, 고유 | 로컬 저장소 내부 경로 키 |
| `status` | enum | `temporary`, `attached`, `expired` |
| `expires_at` | 시간, 선택 | 임시 업로드 만료 시각 |

### `message_attachments`

파일과 메시지 블록을 연결하고 파일 표시 순서를 정한다.

| 열 | 타입·연결 | 의미 |
| --- | --- | --- |
| `id` | UUID PK | 연결 식별자 |
| `message_block_id` | FK → `message_blocks.id` | 파일을 사용한 메시지 |
| `attachment_id` | FK → `attachments.id`, 고유 | 연결한 첨부파일 |
| `order_index` | 정수 | 메시지 안 표시 순서 |

제약: 첨부파일 하나는 한 메시지 블록에만 연결되며, 같은 메시지에서 같은 파일·순서를 중복할 수 없다.

## 11. AI 응답 생성과 관측

### `ai_response_jobs`

AI 답변의 생성·재생성·재시도·취소를 관리하는 중심 테이블이다.

| 열 | 타입·연결 | 의미 |
| --- | --- | --- |
| `id` | UUID PK | 작업 ID. 스트리밍·재시도의 기준 |
| `user_id` | FK → `users.id` | 요청 사용자 |
| `chat_id`, `branch_id` | FK → 대화·브랜치 | 작업이 속한 흐름 |
| `user_message_block_id` | FK → `message_blocks.id` | 질문 블록 |
| `assistant_message_block_id` | FK → `message_blocks.id`, 선택 | 생성 중이거나 생성한 답변 블록 |
| `result_version_id` | FK → `message_block_versions.id`, 선택 | 최종 답변 버전 |
| `source_job_id` | FK → `ai_response_jobs.id`, 선택 | 재생성·재시도의 원본 작업 |
| `job_type` | enum | `generate`, `regenerate` |
| `status` | enum | `requested`, `generating`, `completed`, `failed`, `cancelled` |
| `input_snapshot` | JSON | 모델·검색·Context·대화 흐름 등을 고정한 입력 |
| `error_code`, `error_message` | 문자열, 선택 | 실패 원인 |
| `generation_started_at` | 시간, 선택 | 실제 생성 시작 시각 |
| `first_chunk_at` | 시간, 선택 | 첫 스트리밍 조각 시각 |
| `finished_at` | 시간, 선택 | 완료·실패·취소 시각 |
| `usage_summary` | JSON, 선택 | 토큰·비용 안전 요약. 본문은 저장하지 않음 |

### `ai_execution_events`

AI 작업이 Context·첨부·웹 검색을 실제로 어떻게 사용했는지의 안전한 실행 기록이다.

| 열 | 타입·연결 | 의미 |
| --- | --- | --- |
| `id` | UUID PK | 이벤트 식별자 |
| `job_id` | FK → `ai_response_jobs.id` | AI 작업 |
| `kind` | enum | `context_read`, `attachment_read`, `web_search` |
| `status` | enum | `completed`, `unknown` |
| `started_at`, `completed_at` | 시간 | 실행 구간 |
| `summary` | JSON | 개수·형식·시간 등 안전 요약. 질문·답변 원문은 제외 |

### `ai_delivery_timings`

브라우저가 측정한 화면 전달 시간을 작업마다 하나씩 저장한다.

| 열 | 타입·연결 | 의미 |
| --- | --- | --- |
| `id` | UUID PK | 시간 기록 식별자 |
| `job_id` | FK → `ai_response_jobs.id`, 고유 | AI 작업 |
| `clicked_at` | 시간, 선택 | 전송 클릭 시각 |
| `block_shown_at` | 시간, 선택 | 빈 답변 블록 표시 시각 |
| `stream_connected_at` | 시간, 선택 | SSE 연결 시각 |
| `first_chunk_shown_at` | 시간, 선택 | 첫 조각 표시 시각 |
| `done_at` | 시간, 선택 | 완료 표시 시각 |
| `reconnect_count` | 정수 | 재연결 횟수 |
| `final_outcome` | 문자열 | 최종 결과 |

## 12. 블록 정제와 답변 평가

### `block_refine_jobs`

여러 메시지 블록을 AI로 정제해 달라는 요청의 상위 작업이다.

| 열 | 타입·연결 | 의미 |
| --- | --- | --- |
| `id` | UUID PK | 정제 작업 식별자 |
| `chat_id`, `branch_id` | FK → 대화·브랜치 | 대상 흐름 |
| `instruction_text` | 텍스트 | 정제 지시문 |
| `status` | enum | `requested`, `completed`, `failed` |

### `block_refine_targets`

정제 요청 시점에 고정한 각 대상 메시지의 원본 버전·본문이다.

| 열 | 타입·연결 | 의미 |
| --- | --- | --- |
| `id` | UUID PK | 대상 식별자 |
| `job_id` | FK → `block_refine_jobs.id` | 정제 작업 |
| `block_id` | FK → `message_blocks.id` | 원본 메시지 블록 |
| `base_version_id` | FK → `message_block_versions.id` | 정제 기준 버전 |
| `base_content` | 텍스트 | 정제 당시 원문 스냅샷 |
| `role` | enum | `user` 또는 `assistant` |
| `order_index` | 정수 | 대상 순서 |

### `block_refine_results`

AI가 제안한 정제 결과와 사용자의 승인·거절 상태다.

| 열 | 타입·연결 | 의미 |
| --- | --- | --- |
| `id` | UUID PK | 결과 식별자 |
| `job_id` | FK → `block_refine_jobs.id` | 정제 작업 |
| `block_id` | FK → `message_blocks.id` | 수정할 메시지 |
| `base_version_id` | FK → `message_block_versions.id` | 기준 버전 |
| `refined_content` | 텍스트 | AI가 제안한 본문 |
| `status` | enum | `pending`, `approved`, `rejected` |
| `approved_version_id` | FK → `message_block_versions.id`, 선택 | 승인 후 만들어진 새 버전 |

### `ai_response_feedbacks`

사용자가 AI 답변을 좋아요·싫어요로 평가한 기록이다.

| 열 | 타입·연결 | 의미 |
| --- | --- | --- |
| `id` | UUID PK | 평가 식별자 |
| `user_id` | FK → `users.id` | 평가 사용자 |
| `message_block_id` | FK → `message_blocks.id` | 평가한 AI 답변 |
| `rating` | enum | `like`, `dislike` |

제약: 한 사용자는 같은 답변에 평가를 하나만 남긴다. (`user_id`, `message_block_id` 고유)

## 13. 오류와 서비스 피드백

### `error_logs`

서버가 처리한 오류를 요청 추적 ID 기준으로 기록한다.

| 열 | 의미 |
| --- | --- |
| `trace_id` | PK. HTTP 응답의 `X-Trace-Id`와 연결 가능 |
| `user_id` | 사용자. 사용자 삭제 뒤에는 `NULL` |
| `request_path`, `method` | 오류가 난 API 주소와 HTTP 메서드 |
| `error_code`, `message`, `exception_type`, `status_code` | 오류 분류와 안전한 설명 |
| `created_at` | 오류 기록 시각 |

### `client_error_logs`

브라우저가 전송한 화면 오류 기록이다.

| 열 | 의미 |
| --- | --- |
| `id`, `trace_id`, `user_id` | 오류·요청·사용자 연결 정보 |
| `client_error_type`, `message` | 브라우저 오류 종류와 설명 |
| `page_context`, `user_agent` | 화면 문맥과 브라우저 정보 |
| `created_at` | 기록 시각 |

### `service_feedbacks`

사용자가 서비스에 남긴 피드백이다.

| 열 | 의미 |
| --- | --- |
| `id`, `user_id` | 피드백과 작성자 |
| `feedback_type` | `error`, `usability`, `context`, `branch`, `other` |
| `content` | 피드백 본문 |
| `context_info` | 선택적 화면 문맥 JSON |

오류·피드백 로그에는 원시 API 키, 첨부 원문, 프롬프트 원문, AI 응답 원문을 넣지 않는 것이 원칙이다.

## 14. 조회 전용 SQL 예시

아래 SQL은 데이터를 바꾸지 않는다. UUID는 실제 값으로 바꿔야 한다.

### 최근 대화와 소유자 보기

```sql
SELECT
  c.id,
  c.title,
  c.kind,
  c.last_activity_at,
  u.email
FROM chats AS c
JOIN users AS u ON u.id = c.owner_id
ORDER BY c.last_activity_at DESC
LIMIT 20;
```

### 한 대화의 현재 메시지 흐름 보기

```sql
SELECT
  b.name AS branch_name,
  mb.order_index,
  mb.role,
  mb.generation_status,
  mbv.version_no,
  mbv.content
FROM message_blocks AS mb
JOIN branches AS b ON b.id = mb.branch_id
LEFT JOIN message_block_versions AS mbv
  ON mbv.id = mb.current_version_id
WHERE mb.chat_id = '대화_UUID'
ORDER BY b.name, mb.order_index;
```

### 특정 사용자 메시지에 사용된 Context 보기

```sql
SELECT
  aci.order_index,
  aci.content AS applied_context,
  source_block.role AS source_role,
  source_version.version_no AS source_version_no
FROM applied_context_logs AS acl
JOIN applied_context_items AS aci ON aci.log_id = acl.id
JOIN message_blocks AS source_block ON source_block.id = aci.source_block_id
JOIN message_block_versions AS source_version ON source_version.id = aci.version_id
WHERE acl.user_message_block_id = '사용자_메시지_UUID'
ORDER BY aci.order_index;
```

### 최근 AI 작업 상태 보기

```sql
SELECT
  id,
  job_type,
  status,
  created_at,
  generation_started_at,
  first_chunk_at,
  finished_at,
  error_code
FROM ai_response_jobs
ORDER BY created_at DESC
LIMIT 20;
```

## 15. 테이블을 직접 수정하기 전 주의사항

- 테이블 구조 변경은 pgAdmin에서 직접 하지 않고, `backend/alembic/versions/`에 마이그레이션을 만든다.
- DB 모델을 바꾸면 `backend/app/models/`와 Alembic 마이그레이션을 함께 검토한다.
- `message_blocks`의 현재 본문은 `message_block_versions`에 있다. 블록 테이블만 보고 본문이 없다고 판단하면 안 된다.
- `ai_response_jobs.input_snapshot`, Context·정제·프로젝트 자료에는 사용자 대화 내용이 포함될 수 있다. 화면 공유와 외부 전달 시 가린다.
- `user_api_keys.encrypted_api_key`는 암호화되어 있어도 노출하면 안 된다.
- 대화·사용자·프로젝트 삭제는 관련 테이블을 연쇄 삭제할 수 있다. 데이터 구조 학습에는 `SELECT`와 pgAdmin의 `Properties`만 사용한다.

## 16. 관련 코드와 문서

- [DB 모델](../../backend/app/models/)
- [Alembic 마이그레이션](../../backend/alembic/versions/)
- [DB 연결 설정](../../backend/app/db.py)
- [FlowKit 프로젝트 컨텍스트 안내](0821_03_FlowKit_프로젝트_컨텍스트_안내.md)
- [로컬 서버 실행 안내](0819_01_FlowKit_로컬_서버_실행_안내.md)
