# FlowKit 로컬 서버 실행 안내

대상 저장소: `/Users/lyugeonho/Documents/캡스톤/FlowKit`

FlowKit은 PostgreSQL, FastAPI 백엔드, React 프론트엔드로 실행한다. AI 모델링 코드는 별도 서버가 아니라 백엔드가 파이썬 패키지로 불러온다.

## 실행 전 준비

- Python 3.14 이상
- Node.js 20.19 이상 또는 22.12 이상
- PostgreSQL 16 또는 Docker Desktop

비밀값과 API 키는 각 프로젝트의 `.env`에만 넣고 Git에 커밋하지 않는다. 이미 `.env`가 있으면 `.env.example`로 덮어쓰지 않는다.

## 1. PostgreSQL 실행

Homebrew와 Docker 중 하나만 사용한다.

### 방법 A: Homebrew PostgreSQL

처음 한 번만 설치하고 개발용 사용자와 DB를 만든다.

```bash
brew install postgresql@16
brew services start postgresql@16
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"

psql -d postgres -c "CREATE ROLE flowkit LOGIN PASSWORD 'flowkit';"
psql -d postgres -c "CREATE DATABASE flowkit OWNER flowkit;"
```

이미 사용자나 DB를 만들었다면 생성 명령은 다시 실행하지 않는다. 이후에는 다음 명령으로 PostgreSQL만 시작하면 된다.

```bash
brew services start postgresql@16
```

### 방법 B: Docker Compose

Docker Desktop을 실행한 뒤 저장소 루트에서 PostgreSQL과 Redis를 시작한다.

```bash
cd /Users/lyugeonho/Documents/캡스톤/FlowKit
docker compose up -d
docker compose ps
```

`flowkit-postgres`가 `healthy`면 준비된 상태다. Redis는 현재 실행 환경에 포함되어 있지만 서비스 코드에서는 아직 사용하지 않는다.

다음 오류가 나면 Docker Desktop을 먼저 실행하고 엔진 상태를 확인한다.

```text
failed to connect to the docker API ... connect: no such file or directory
```

```bash
open -a Docker
docker info
```

`docker info`가 성공한 뒤 `docker compose up -d`를 다시 실행한다.

## 2. 백엔드 환경 준비

처음 한 번 실행한다.

```bash
cd /Users/lyugeonho/Documents/캡스톤/FlowKit/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install -e ../modeling
test -f .env || cp .env.example .env
```

`backend/.env`에서 다음 값을 확인한다.

| 변수 | 용도 |
| --- | --- |
| `DATABASE_URL` | PostgreSQL 연결 주소 |
| `REDIS_URL` | Redis 연결 주소. 현재 기능에서는 사용하지 않음 |
| `GOOGLE_CLIENT_ID` | Google 로그인 토큰 검증 |
| `JWT_SECRET` | 로그인 토큰 서명. 32자 이상 사용 |
| `API_KEY_ENCRYPTION_KEY` | 사용자가 등록한 Gemini 키 암호화 |

`API_KEY_ENCRYPTION_KEY`가 비어 있으면 백엔드 가상환경에서 새 키를 만든다.

```bash
./.venv/bin/python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

출력값을 `backend/.env`의 `API_KEY_ENCRYPTION_KEY`에 넣는다. 이 값은 암호화된 사용자 키를 다시 읽는 데 필요하므로 임의로 바꾸거나 커밋하지 않는다.

AI 호출에 쓰는 Gemini 키는 서버 공용 환경 변수가 아니다. 백엔드 실행 후 FlowKit 설정 화면에서 사용자별로 등록한다. `modeling/.env`는 필요하지 않다.

## 3. DB 마이그레이션과 백엔드 실행

터미널 1에서 실행한다.

```bash
cd /Users/lyugeonho/Documents/캡스톤/FlowKit/backend
source .venv/bin/activate
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

확인 주소:

| 항목 | 주소 |
| --- | --- |
| 상태 확인 | `http://127.0.0.1:8000/health` |
| API 문서 | `http://127.0.0.1:8000/docs` |

`/health`에서 `{"status":"ok"}`가 나오면 백엔드가 실행된 상태다.

FlowKit은 Supabase 마이그레이션이 아니라 Alembic을 사용한다. `supabase start`, `supabase functions serve`, `supabase db reset`은 실행하지 않는다.

## 4. 프론트엔드 실행

처음 한 번 환경을 준비한다.

```bash
cd /Users/lyugeonho/Documents/캡스톤/FlowKit/frontend
npm install
test -f .env || cp .env.example .env
```

`frontend/.env`에서 다음 값을 확인한다.

```env
VITE_API_BASE_URL=http://127.0.0.1:8000
VITE_GOOGLE_CLIENT_ID=
```

Google 로그인을 사용하려면 `VITE_GOOGLE_CLIENT_ID`와 백엔드의 `GOOGLE_CLIENT_ID`에 같은 OAuth 클라이언트 ID를 넣는다.

터미널 2에서 프론트엔드를 실행한다.

```bash
cd /Users/lyugeonho/Documents/캡스톤/FlowKit/frontend
npm run dev
```

브라우저에서 `http://localhost:5173`을 연다.

## 5. AI 모델링만 단독 검증

프롬프트와 체인만 작업할 때 사용한다. 웹 서비스 실행에는 이 절의 별도 가상환경이 필요하지 않다.

```bash
cd /Users/lyugeonho/Documents/캡스톤/FlowKit/modeling
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
pytest tests/ -q
```

단위 테스트는 실제 Gemini API를 호출하지 않으므로 키 없이 실행된다.

## 권장 실행 순서

1. PostgreSQL을 실행한다.
2. 백엔드에서 `alembic upgrade head`를 적용한다.
3. 백엔드를 실행하고 `/health`를 확인한다.
4. 프론트엔드를 실행한다.
5. 로그인 후 설정 화면에서 Gemini API 키를 등록하고 연결을 확인한다.

## 종료 방법

프론트엔드와 백엔드는 각 터미널에서 `Ctrl+C`로 종료한다.

Docker Compose를 사용했다면 저장소 루트에서 컨테이너만 종료한다.

```bash
cd /Users/lyugeonho/Documents/캡스톤/FlowKit
docker compose down
```

`docker compose down -v`는 PostgreSQL 데이터 볼륨까지 삭제하므로 초기화가 명확히 필요한 경우가 아니면 실행하지 않는다.
