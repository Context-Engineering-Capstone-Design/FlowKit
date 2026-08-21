# 0821_02 전송된 Context 스니펫 대화 내 영구 표시

## 목표

드래그 범위 Context 태그(0820_13)는 지금 입력창(하단 채팅 패널)에서만 보이다가 전송 후 사라진다. 전송된 메시지가 어떤 인용을 근거로 했는지 채팅 내역에서 다시 확인할 방법이 없다. 사용자가 보낸 메시지 말풍선에 인용한 스니펫을 영구적으로 표시해, 대화를 나중에 다시 열어도 어떤 부분을 Context로 썼는지 알 수 있게 한다.

## 배경

- 백엔드는 전송 시점에 `AppliedContextLog`/`AppliedContextItem`으로 스니펫 내용을 이미 영구 저장한다(`context_service.save_log`).
- 하지만 전송 응답(`SendMessageResponse.appliedContext`)에는 `blockId`·`versionId`·`orderIndex`만 있고 인용 내용(`content`)이 빠져 있다.
- 채팅 조회 API(`GET /api/chats/{id}`, 브랜치 조회 등)는 이 로그를 아예 읽어오지 않는다.
- 그 결과 태그는 항상 입력창에서만 잠깐 보이다 사라지는 것처럼 동작한다.
- 이 기능은 `기획 문서/요구사항정의서/2.5 Context 편집.md`와 0820_13 결과 문서에는 없던 사양이며, 사용자 확인을 거쳐 REQ-072로 새로 추가한다.

## 범위

### 마일스톤 A · 백엔드 응답에 인용 내용 포함

- [x] A1. `AppliedContextOut`에 `content` 필드를 추가한다.
- [x] A2. `send_message`, `retry_ai_response_job` 응답에서 `content`를 채워 보낸다.
- [x] A3. `MessageBlockOut`에 `appliedContext` 필드를 추가하고, `chat.py`의 `_block_list`가 대상 사용자 블록들의 `AppliedContextLog`/`AppliedContextItem`을 일괄 조회해 채워 넣는다(채팅 상세·브랜치 상세 조회 모두 이 경로를 탄다).

### 마일스톤 B · 프론트엔드 표시

- [x] B1. `MessageBlock` 타입에 `appliedContext` 필드를 추가한다.
- [x] B2. 전송 직후 응답(`res.userBlock`)에 `res.appliedContext`를 합쳐 블록 상태에 반영한다(새로고침 전에도 바로 보이도록).
- [x] B3. `MessageBlockItem`의 사용자 메시지 말풍선 위에 인용 스니펫을 읽기 전용 태그(pill)로 표시한다. 태그 미리보기 잘라내기 로직(`toTagPreview`)은 `lib/textRangeSelection.ts`로 옮겨 `ChatArea`(입력창 태그)와 함께 재사용한다.

### 마일스톤 C · 검증

- [x] C1. 백엔드: 전송 응답과 채팅 재조회 양쪽에서 인용 내용이 채워지는지 테스트로 확인한다.
- [x] C2. 프론트엔드: 전송 직후와 재조회(새로고침) 양쪽에서 태그가 사용자 메시지에 보이는지 컴포넌트 테스트로 확인한다.
- [x] C3. `cd backend && .venv/bin/pytest`, `cd frontend && npx vitest run`, `cd frontend && npx tsc -b && npx oxlint src` 통과.

## 완료 기준

- 사용자가 드래그 범위 태그를 붙여 메시지를 보내면, 그 사용자 메시지 말풍선에 인용한 스니펫이 함께 표시된다.
- 대화를 새로고침하거나 다시 열어도 이 표시가 유지된다.
- 기존 입력창 태그(전송 전 미리보기·제거) 동작은 그대로 유지된다.

## 검증 방법

- `cd backend && .venv/bin/pytest`
- `cd frontend && npx vitest run`
- `cd frontend && npx tsc -b && npx oxlint src`
- 가능하면 브라우저로 실제 전송 후 표시를 확인한다.

## 구현 결과 (2026-08-21)

### 기준 커밋

- `10bf5cb`(`main`)

### 완료 항목

- **A**: `AppliedContextOut`(`backend/app/schemas/conversation.py`)에 `content: str`을 추가했다. `send_message`·`retry_ai_response_job`(`backend/app/routers/conversation.py`) 응답 모두 `content=i.content`로 채운다. `MessageBlockOut`(`backend/app/schemas/chat.py`)에 `applied_context` 필드와 `.of()`의 세 번째 인자를 추가했고, `chat.py`의 `_applied_context_by_block`이 대상 사용자 블록 id들로 `AppliedContextLog`를 `joinedload(items)`로 일괄 조회해 `_block_list`에서 채워 넣는다 — `GET /api/chats/{id}`(채팅 상세)와 브랜치 상세 조회가 모두 이 `_block_list`를 거치므로 별도 구현 없이 함께 적용된다. `side_chat.py`의 블록 가져오기(`MessageBlockOut.of(b)`)는 이번 범위에 넣지 않아 가져온 블록에는 인용 태그가 비어 있다(남은 제한 사항 참고).
- **B**: 프론트 `MessageBlock`·`AppliedContextOut` 타입(`types/api.ts`)에 각각 `appliedContext?`·`content`를 추가했다. `chatStore.ts`의 `sendMessage`는 `res.userBlock`에 `res.appliedContext`를 합쳐 블록 배열에 넣어, 새로고침 전에도 바로 보이게 했다. `MessageBlockItem.tsx`에 `AppliedContextTagList`를 추가해 사용자 메시지 말풍선 위(오른쪽 정렬)에 인용 스니펫을 읽기 전용 pill로 표시한다 — 입력창 태그(`ChatArea.tsx`의 `ContextRangeTagList`)와 같은 색·모양을 쓰되 제거 버튼은 없다. 미리보기 잘라내기 함수 `toTagPreview`는 `ChatArea.tsx`에서 `lib/textRangeSelection.ts`로 옮겨 두 곳이 함께 쓴다. 원문 위치를 다시 강조해 보여주는 호버 미리보기(입력창 태그의 `ContextRangeTagPreview`와 동일한 기능)는 이번 범위에 넣지 않았다 — 백엔드가 저장하는 것은 스니펫 문자열뿐이고 원문 안에서의 오프셋은 저장하지 않으므로, 필요해지면 별도 저장 방식부터 설계해야 한다.
- **C**: 백엔드에 `test_range_context_content_is_included_in_send_response`, `test_range_context_snippet_persists_on_chat_reload`(`backend/tests/test_conversation.py`)를 추가했다. 프론트에 `MessageBlockItem.test.tsx` 2건(사용자 메시지에 태그 표시·AI 답변에는 미표시)과 `chatStore.test.ts` 1건(전송 응답의 인용 내용이 블록에 합쳐지는지)을 추가했다.

### 변경 경로

- 백엔드: `backend/app/routers/chat.py`, `backend/app/routers/conversation.py`, `backend/app/schemas/chat.py`, `backend/app/schemas/conversation.py`, `backend/tests/test_conversation.py`
- 프론트엔드: `frontend/src/components/ChatArea.tsx`, `frontend/src/components/MessageBlockItem.tsx`와 테스트, `frontend/src/lib/textRangeSelection.ts`, `frontend/src/store/chatStore.ts`와 테스트, `frontend/src/types/api.ts`
- 기획 문서: `기획 문서/요구사항정의서/2.5 Context 편집.md`에 REQ-072 추가

### 검증 결과

- `cd backend && .venv/bin/pytest` — 242 passed
- `cd frontend && npx vitest run` — 144 passed, 1 failed(`chatStore.notifications.test.ts`의 검색 재시도 테스트 — 이 작업과 무관하게 동시 진행 중인 다른 세션(0821_01 반응형 작업)의 미완 변경 때문에 실패. 이 문서의 변경 범위 밖이라 손대지 않았다)
- `cd frontend && npx tsc -b` — 통과
- `cd frontend && npx oxlint src` — 기존에도 있던 경고만 남고 새 경고 없음
- 브라우저 수동 검증: 로컬 백엔드(uvicorn)·프론트엔드(Vite) + 기존 Docker Postgres로 실제 로그인 후 확인했다. 답변 표 셀 일부를 드래그해 "채팅에 추가"로 태그를 만들고 전송하자, 보낸 사용자 메시지 위에 인용 태그가 바로 표시됐고 AI도 실제로 그 스니펫을 받아 답했다. 페이지를 새로고침해 대화를 다시 열어도 같은 태그가 그대로 남아 있음을 확인했다(`_block_list`를 통한 영구 조회 경로 확인).

### 남은 제한 사항

- 사이드 채팅으로 블록을 가져오는 경로(`side_chat.py`의 `MessageBlockOut.of(b)`)는 인용 태그를 채우지 않는다 — 가져온 블록에는 원래 있었을 인용 태그가 보이지 않는다.
- 입력창 태그(`ContextRangeTagPreview`)처럼 태그에 호버해 원문 위치를 강조하는 기능은 채팅 내역 표시에는 없다. 저장된 것이 스니펫 문자열뿐이라(원문 안 오프셋 미저장) 이번 범위에서는 넣지 않았다.
- 여러 인용 태그의 React key로 배열 인덱스를 쓴다(서버가 안정적인 항목 id를 내려주지 않음) — 항상 새로 렌더링되는 정적 목록이라 문제는 없지만, 항목 순서가 응답마다 바뀌는 경우는 없다는 전제에 기대고 있다.
