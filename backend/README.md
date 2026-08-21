# FlowKit Backend

FastAPI + PostgreSQL(SQLAlchemy) 기반 백엔드.

## 실행

### PostgreSQL

Homebrew(권장, Docker 불필요) 또는 `docker compose up -d` 중 하나를 쓴다.

```bash
brew install postgresql@16
brew services start postgresql@16
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"   # 셸 프로필에 추가 권장

# 최초 1회: .env 의 DATABASE_URL 과 맞는 role/db 생성
psql -d postgres -c "CREATE ROLE flowkit LOGIN PASSWORD 'flowkit';"
psql -d postgres -c "CREATE DATABASE flowkit OWNER flowkit;"
```

### 백엔드

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env

alembic upgrade head          # 초기 마이그레이션은 커밋되어 있음
uvicorn app.main:app --reload --port 8000
# http://127.0.0.1:8000/docs
```

스키마를 바꾼 뒤에는 `alembic revision --autogenerate -m "설명"` 으로 리비전을 만든다.

## 테스트

```bash
pytest tests/ -q
```

모델 스모크 테스트는 SQLite 인메모리로 동작하므로 DB 없이 실행된다.

## 데이터 모델

MVP 범위 13개 테이블. 첨부·BYOK·피드백·에러로그는 후순위로 제외했다.

| 영역 | 테이블 |
| --- | --- |
| 인증 | `users`, `auth_sessions` |
| 대화 | `chats`, `branches`, `branch_source_contexts`, `branch_source_context_items` |
| 메시지 | `message_blocks`, `message_block_versions` |
| 정제 | `block_refine_jobs`, `block_refine_targets`, `block_refine_results` |
| Context 적용 | `applied_context_logs`, `applied_context_items` |

### 핵심 설계 결정

**참조형 브랜치** — 브랜치 생성 시 메시지를 복사하지 않는다. `parent_branch_id`와
`base_message_block_id`(분기점)만 기록하고, 조회 시 조상 브랜치를 타고 올라가며 분기점까지의
블록을 이어붙여 전체 흐름을 구성한다. 원본 대화가 항상 보존된다.

**버전 이력 불변** — 정제본 승인이나 사용자 수정은 기존 버전을 덮어쓰지 않고
`message_block_versions`에 새 행을 추가한 뒤 `message_blocks.current_version_id` 포인터만
옮긴다. 되돌리기는 포인터를 이전 버전으로 되돌리는 것이며, 이력은 삭제하지 않는다
.

**정제 기준 스냅샷** — `block_refine_targets`가 정제 실행 시점의 활성 버전과 본문을 고정한다.
이후 원본이 바뀌어도 정제 기준은 흔들리지 않는다.

### 마이그레이션 주의점

`branches.base_message_block_id`와 `message_blocks.current_version_id`는 순환 참조라
모델에서 `use_alter=True`로 선언했다. 그런데 **`use_alter`는 `metadata.create_all()`에서만
자동 처리되고 Alembic의 `op.create_table()`에서는 무시된다.** autogenerate 결과를 그대로 쓰면
두 제약이 조용히 누락되므로, 초기 마이그레이션 `upgrade()` 끝에 `op.create_foreign_key()`를
명시해 두었다. 이후 순환 FK를 추가할 때도 같은 처리가 필요하다.

또한 Alembic은 PostgreSQL ENUM 타입을 downgrade 시 정리하지 않아 재적용이
`type already exists`로 실패한다. `downgrade()` 끝에서 `DROP TYPE`을 명시한다.
