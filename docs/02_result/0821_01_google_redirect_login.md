# Google 현재 탭 로그인 전환

## 기준 커밋

`5e04284` — `feat(auth): redirect Google login in current tab`

## 구현 결과

- Google 로그인 버튼을 `popup`에서 `redirect` 방식으로 전환했다. 버튼 클릭 뒤 계정 선택은 현재 탭에서 열린다.
- Google이 백엔드 `/api/auth/google/redirect`로 POST한 ID 토큰을 검증한다.
- 백엔드는 서비스 토큰을 URL에 넣지 않는다. 5분짜리 일회성 코드를 프론트엔드로 돌려보내고, 프론트엔드는 `/api/auth/google/exchange`에서 코드와 서비스 토큰을 교환한다.
- 코드 재사용·만료는 `GOOGLE_LOGIN_EXCHANGE_INVALID`로 거부한다.
- 교환 코드 테이블을 만드는 Alembic 리비전 `a82111googlelogin`을 추가했고, 로컬 DB에 적용했다.

## 변경 경로

- `backend/app/routers/auth.py`
- `backend/app/services/auth_service.py`
- `backend/app/models/user.py`
- `backend/alembic/versions/a82111_google_redirect_login.py`
- `frontend/src/lib/googleSignIn.ts`
- `frontend/src/App.tsx`
- `frontend/src/store/authStore.ts`

## 검증 결과

- `backend/.venv/bin/pytest tests/test_auth.py -q` — 26 passed
- `frontend/npm run build` — 통과
- `backend/.venv/bin/alembic heads` — `a82111googlelogin (head)`
- `backend/.venv/bin/alembic upgrade head` — 로컬 PostgreSQL 적용 완료

## 배포 전 설정

Google Cloud Console의 OAuth 클라이언트 **승인된 리디렉션 URI**에 아래 주소를 추가해야 한다.

`https://flowkit-backend-prod.onrender.com/api/auth/google/redirect`

그리고 배포 환경변수를 설정한다.

| 서비스 | 환경변수 | 값 |
| --- | --- | --- |
| Vercel 운영 | `VITE_GOOGLE_LOGIN_URI` | `https://flowkit-backend-prod.onrender.com/api/auth/google/redirect` |
| Render 운영 | `FRONTEND_BASE_URL` | `https://flow-kit-three.vercel.app` |

개발·Preview 환경은 해당 백엔드와 프론트엔드의 실제 주소로 각각 맞춰야 한다.

## 남은 제한 사항

실제 Google 계정 선택과 복귀는 위 Google Cloud Console 및 Vercel·Render 환경변수 설정 후에만 운영 URL에서 검증할 수 있다.
