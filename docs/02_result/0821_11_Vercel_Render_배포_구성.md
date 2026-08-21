# Vercel + Render 배포 구성

## 목표

FlowKit을 실제 도메인에서 접속 가능한 서비스로 배포한다. 프론트엔드는 Vercel, 백엔드는 Render, 데이터베이스는 Neon(PostgreSQL), 실시간 알림용 저장소는 Upstash(Redis)를 쓴다. 개발 중 실험이 운영 서비스에 영향을 주지 않도록 개발용 환경과 운영용 환경을 분리한다.

## 왜 이 조합인가

- 백엔드는 실시간 알림(같은 계정의 다른 창에 변화를 알리는 기능)을 20초 넘게 연결을 유지하는 방식으로 구현되어 있고, 파일 업로드도 로컬 디스크에 저장한다. 이런 방식은 Vercel의 서버리스 함수(요청마다 새로 실행되고 파일이 남지 않음)와 맞지 않아서, 상시 실행되는 서버를 쓸 수 있는 Render를 선택했다.
- 프론트엔드는 정적 파일로 빌드되는 일반적인 React 화면이라 Vercel에 그대로 잘 맞는다.
- DB와 Redis는 백엔드 서버와 묶지 않고 별도 서비스(Neon, Upstash)로 뗀다. 서버를 재배포해도 데이터가 안전하고, 무료로 오래 쓸 수 있다.

## 범위

1. 백엔드가 Render에서 바로 기동되도록 실행 설정을 만든다 (시작 명령, 배포 시 DB 구조 자동 갱신, 개발/운영 서비스 분리)
2. 프론트엔드가 Vercel에서 바로 빌드·배포되도록 설정 가이드를 정리한다
3. 배포 환경에서만 필요한 값(CORS 허용 주소 등)의 형식을 확인하고 문서로 남긴다
4. 개발/운영 각 환경에 채워야 할 환경변수 목록과, 그 값을 어디서 구하는지 정리한다

## 범위 밖 (사용자가 직접 처리)

- Render·Vercel·Neon·Upstash 계정 생성과 실제 서비스·DB 생성 (계정 생성은 에이전트가 대신 할 수 없음)
- JWT_SECRET, API_KEY_ENCRYPTION_KEY, GOOGLE_CLIENT_ID 등 실제 비밀값 발급과 입력
- 첨부 파일 로컬 저장 방식의 영속성 한계 개선 — 지금은 그대로 두고 알려진 제한사항으로만 기록한다. Render 기본 웹 서비스는 재배포 시 디스크가 초기화될 수 있어, 재배포할 때마다 이미 올라간 첨부 파일이 사라질 수 있다.

## 완료 기준

- [x] 백엔드: Render가 인식하는 배포 설정 파일 작성 (개발/운영 서비스 분리, 배포 시 DB 구조 자동 갱신 포함)
- [x] 백엔드: 운영 모드(재시작 자동 반영 없이, Render가 주는 포트로) 로컬 기동 확인
- [x] 백엔드: CORS 허용 주소를 배포 환경에서 채울 값 형식 확인
- [x] 프론트엔드: Vercel 설정 가이드 작성 (저장소 내 하위 폴더 지정, 브랜치별 배포, 환경변수)
- [x] 개발/운영 환경변수 체크리스트 문서화 (docs/03_others)
- [x] `dev` 브랜치 생성 및 원격 반영
- [x] Render·Neon·Upstash·Vercel에 실제 리소스를 만들고 값을 채운 뒤 배포
- [x] 배포된 프론트엔드·백엔드가 실제로 통신하는지(CORS) 확인
- [ ] (사용자 검증) 배포된 주소에서 로그인 → 대화 생성 → 메시지 전송 → 실시간 갱신까지 끊김 없이 동작하는지 확인

## 구현 결과 (2026-08-21)

기준 커밋: `6a8c578`

### 계정·리소스 구성

- 모든 배포 플랫폼(Render, Vercel, Upstash 개발용 팀)은 팀 공용 계정 `flowkit0309@gmail.com`으로 통일했다. Upstash는 무료 티어가 워크스페이스당 Redis 1개까지만 허용해서, 개발용은 `flowkit dev` 팀에, 운영용은 `flowkit-prod` 팀에 나눠 만들었다(둘 다 무료 유지).
- Neon: `flowkit-dev`, `flowkit-prod` 프로젝트를 각각 만들었다 (US East 2/Ohio 리전).
- GitHub 저장소(`Context-Engineering-Capstone-Design/FlowKit`)는 Vercel 무료 플랜이 조직 소속 private 저장소를 지원하지 않아 public으로 전환했다. 전환 전 git 히스토리에 `.env` 커밋 이력이 없음을 확인했다.

### 백엔드 (Render)

- [render.yaml](../../render.yaml)에 `flowkit-backend-prod`(main 브랜치), `flowkit-backend-dev`(dev 브랜치) 두 웹 서비스를 정의했다.
- Render 무료 플랜은 `preDeployCommand`를 지원하지 않아, `startCommand`에 `alembic upgrade head &&`를 붙여 기동 시마다 마이그레이션이 적용되도록 바꿨다.
- `rootDir: backend`로는 상위 폴더의 `modeling` 패키지가 설치되지 않아(`ModuleNotFoundError`), `buildCommand`에 `pip install -e ../modeling`을 추가했다.
- 배포 주소: `https://flowkit-backend-prod.onrender.com`, `https://flowkit-backend-dev.onrender.com`. 둘 다 배포 성공(Deploy live) 확인.

### 프론트엔드 (Vercel)

- Root Directory를 `frontend`로 지정해 모노레포에서 프론트엔드만 배포되게 했다.
- 환경변수는 `VITE_API_BASE_URL`을 Production/Preview 환경별로 다른 백엔드 주소(prod/dev)를 가리키도록 분리했고, `VITE_GOOGLE_CLIENT_ID`·`VITE_DEV_LOGIN_ENABLED`는 공통으로 넣었다.
- 운영 배포 주소: `https://flow-kit-three.vercel.app`. 배포 성공, 로그인 화면 정상 렌더링 확인.

### 검증 결과

- Render prod/dev 백엔드 모두 `/openapi.json` 응답 정상(HTTP 200).
- 배포된 프론트엔드(`flow-kit-three.vercel.app`)에서 배포된 백엔드(`flowkit-backend-prod.onrender.com`)로 브라우저 `fetch`를 실행해 CORS 통신이 정상임을 확인(status 200).

## 남은 제한사항 (미검증·외부 의존)

- **dev(Preview) 경로 CORS 미완성**: Vercel은 `dev` 브랜치에 커밋이 실제로 올라가야 Preview 배포 주소가 생긴다. 지금은 그 배포가 없어 정확한 Preview 도메인을 확정하지 못했다. `dev` 브랜치에 처음 커밋을 push해 Preview 배포가 생성되면, 그 주소를 `flowkit-backend-dev`의 `CORS_ORIGINS` 환경변수에 추가해야 한다.
- **실제 사용자 로그인 E2E 미검증**: CORS 통신까지는 확인했지만, Google 로그인 → 대화 생성 → 메시지 전송 → 실시간 갱신까지 이어지는 전체 흐름은 사용자 계정으로 직접 확인이 필요하다.
- **첨부 파일 로컬 저장 방식의 영속성 한계**: 기존에 알려진 제한사항 그대로. Render 재배포 시 첨부 파일이 사라질 수 있다.
- **Render/Vercel 무료 플랜의 콜드 스타트**: 무료 인스턴스는 일정 시간 비활성 시 슬립 상태가 되어, 첫 요청이 50초 이상 걸릴 수 있다.

## 검증 방법

- 로컬에서 운영 모드로 백엔드를 띄워 정상 기동과 API 응답을 확인한다. (완료)
- 배포 후, 브라우저에서 프론트엔드→백엔드 CORS 통신을 직접 확인한다. (완료)
- 사용자가 실제 주소에서 로그인부터 실시간 갱신까지 직접 확인한다. (미완료)
