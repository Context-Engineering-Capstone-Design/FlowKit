# 0820_10 Temporary Chat

- 상태: 구현 완료
- 선행 조건: [`0820_08_사이드_채팅_트리와_선택적_메인_반영.md`](0820_08_사이드_채팅_트리와_선택적_메인_반영.md)의 구현과 검증을 먼저 완료한다. 이 문서는 그 사이드 채팅 트리 구조를 전제로 구현한다.

## 목표

사이드 채팅 트리에서 필요할 때 Temporary Chat을 만들고, 임시 대화가 상위 대화의 맥락만 참고하도록 한다. Temporary Chat은 작업 중에는 사용할 수 있지만 보존·검색·재사용 대상이 되지 않는다.

## 확정된 구조

```text
메인 대화(부모)
  └─ 사이드 채팅(자식, 일반 또는 Temporary 가능)
       └─ 사이드 채팅(손자, 항상 Temporary)
            └─ ...
```

- 첫 자식 사이드 채팅은 일반 또는 Temporary로 만들 수 있다.
- 자식 사이드 채팅에서 다시 만든 모든 하위 사이드 채팅은 항상 Temporary다.
- Temporary 여부는 대화 노드의 속성으로 관리한다.

## 컨텍스트 규칙

- 컨텍스트는 부모에서 자식 방향으로만 참고한다.
- 자식과 손자의 질문·답변은 부모나 조상 대화의 답변 입력에 자동 반영하지 않는다.
- 손자 Temporary Chat은 루트 메인 대화와 직계 조상 사이드 채팅의 내용을 참고할 수 있다.
- Temporary Chat이 사용한 부모·조상 맥락은 답변 생성 시점의 스냅샷으로만 사용한다.
- Temporary Chat의 결과를 메인에 쓰려면 자동 반영이 아니라 별도의 사용자 명시 동작이 필요하다.

## Temporary 보존·접근 규칙

- 좌측 대화 목록, 전체 검색, 과거 채팅 참고 후보, 메모리에서 제외한다.
- 화면을 닫거나 새로고침한 뒤에는 Temporary Chat을 복원하지 않는다.
- Temporary Chat은 브랜치 생성과 일반 Context 적용의 원본으로 사용하지 않는다.
- 임시 첨부 파일은 임시 저장소만 사용하고, 탭 종료 또는 만료 시 삭제한다.
- Temporary Chat의 첨부 파일은 Library나 일반 대화에서 재사용할 수 없다.
- 실제로 Temporary Chat에 사용한 상위 맥락은 실행 중 추적 가능한 스냅샷으로만 보관하고, Temporary Chat 본문 자체는 영구 대화 이력으로 저장하지 않는다.

## 범위

### 마일스톤 A · Temporary 노드와 수명

- [x] A1. 사이드 채팅 노드에 Temporary 여부와 부모 관계를 저장한다.
- [x] A2. 하위 사이드 채팅 생성 시 Temporary를 강제하는 규칙을 구현한다.
- [x] A3. Temporary Chat을 대화 목록·검색·과거 채팅 참고 조회에서 제외한다.
- [x] A4. 새로고침·탭 종료·만료 뒤 Temporary Chat과 임시 첨부를 정리한다.

### 마일스톤 B · 단방향 컨텍스트

- [x] B1. 자식 답변 생성 시 직계 부모와 조상 대화의 허용된 맥락을 스냅샷으로 조립한다.
- [x] B2. 자식·손자 메시지가 부모·조상 대화의 AI 입력에 포함되지 않도록 검증한다.
- [x] B3. Temporary Chat이 사용한 상위 맥락의 출처와 시점을 실행 범위에서 추적한다.

### 마일스톤 C · 화면과 제한 안내

- [x] C1. 사이드 채팅 생성 화면에서 첫 자식의 일반·Temporary 선택을 제공한다.
- [x] C2. 자동 Temporary가 되는 하위 채팅에는 임시 상태와 보존 제한을 분명히 표시한다.
- [x] C3. Temporary Chat에서 지원하지 않는 검색·재사용·반영 행동은 숨기거나 이유와 함께 비활성화한다.

### 마일스톤 D · 검증

- [ ] D1. 부모에서 자식·손자로의 컨텍스트 참고와 역방향 차단을 백엔드 테스트로 검증한다. (테스트 환경 의존성 없음)
- [ ] D2. 목록·검색·과거 채팅 참고에서 Temporary Chat이 제외되는지 검증한다. (테스트 환경 의존성 없음)
- [ ] D3. 새로고침·종료·만료 뒤 임시 대화와 첨부가 복원되지 않는지 검증한다. (테스트 환경 의존성 없음)
- [ ] D4. 첫 자식 선택과 하위 노드 Temporary 강제 UI를 프론트엔드·브라우저에서 확인한다. (프론트 단위 테스트만 통과)

## 완료 기준

- `0820_08`의 사이드 채팅 트리 위에서 첫 자식을 일반 또는 Temporary로 만들 수 있다.
- 모든 하위 사이드 채팅은 Temporary로 생성된다.
- 부모·조상 맥락만 자식 방향으로 전달되며 역방향 참조는 없다.
- Temporary Chat은 종료 뒤 복원되지 않고, 목록·검색·과거 채팅 참고·메모리·Library에서 제외된다.
- Temporary 첨부는 일반 대화나 Library에서 재사용할 수 없다.

## 구현 결과 (2026-08-20)

### 기준 커밋

- 코드: `c73bbb7` (`feat(chat): Temporary Chat 수명과 컨텍스트를 추가한다`)

### 구현 항목

- `Chat`에 `is_temporary`, `temporary_expires_at`을 추가했다. 첫 자식은 일반 또는 Temporary를 선택하며, 사이드 채팅에서 만드는 모든 하위 채팅은 서버에서 Temporary로 강제한다.
- Temporary Chat은 일반 대화 목록·검색·사이드 트리·같은 계열 Context/메시지 가져오기 후보에서 제외했다. 탭에서는 시계 아이콘과 제한 안내만 표시한다.
- Temporary 탭을 닫으면 즉시 삭제하고, 새로고침 뒤에는 `sessionStorage`에 남은 Temporary id를 정리한다. 서버는 한 시간 만료와 서버 시작 시 정리도 적용한다. 채팅 삭제 경로가 첨부 파일도 함께 삭제한다.
- 답변 생성 시 직계 부모부터 루트까지의 흐름만 부모→자식 방향으로 조립한다. 이 입력은 작업 스냅샷에 고정되고, 부모 맥락의 대화·브랜치 출처와 시각도 함께 기록한다.
- Temporary Chat은 부모 Context 추가, 메시지 가져오기, 형제 브랜치 생성 화면을 숨기고 제한 이유를 표시한다.

### 변경 경로

- 백엔드: `backend/app/models/chat.py`, `backend/app/services/chat_service.py`, `backend/app/services/ai_response_service.py`, `backend/app/routers/side_chat.py`, `backend/app/schemas/chat.py`, `backend/app/main.py`, `backend/alembic/versions/a82010temp_add_temporary_chat.py`
- 프론트엔드: `frontend/src/store/chatStore.ts`, `frontend/src/components/ContextPanel.tsx`, `frontend/src/components/ChatTabBar.tsx`, `frontend/src/api/sideChat.ts`, `frontend/src/types/api.ts`

### 검증 결과

- `frontend`: `pnpm test` — 22개 파일, 111개 테스트 통과
- `frontend`: `pnpm build` — TypeScript 검사와 Vite 프로덕션 빌드 통과
- `backend`: 수정 파일 `py_compile` 통과. 이 작업 환경에는 `pytest`와 백엔드 의존성이 설치되어 있지 않아 실행 테스트는 하지 못했다.
- 브라우저: Vite 로컬 화면 접속은 확인했다. 백엔드가 실행되지 않아 로그인 뒤 첫 자식 선택·하위 Temporary 생성의 실제 클릭 검증은 하지 못했다.

### 남은 제한 사항

- Temporary 대화는 서버 작업·첨부 연결을 위해 만료 전까지 DB에 존재한다. 일반 목록과 재사용 경로에는 노출하지 않으며, 탭 종료·새로고침 정리 또는 최대 한 시간 뒤 삭제한다.
