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

- [ ] A1. `AppliedContextOut`에 `content` 필드를 추가한다.
- [ ] A2. `send_message`, `retry_ai_response_job` 응답에서 `content`를 채워 보낸다.
- [ ] A3. `MessageBlockOut`에 `appliedContext` 필드를 추가하고, `chat.py`의 `_block_list`가 대상 사용자 블록들의 `AppliedContextLog`/`AppliedContextItem`을 일괄 조회해 채워 넣는다(채팅 상세·브랜치 상세 조회 모두 이 경로를 탄다).

### 마일스톤 B · 프론트엔드 표시

- [ ] B1. `MessageBlock` 타입에 `appliedContext` 필드를 추가한다.
- [ ] B2. 전송 직후 응답(`res.userBlock`)에 `res.appliedContext`를 합쳐 블록 상태에 반영한다(새로고침 전에도 바로 보이도록).
- [ ] B3. `MessageBlockItem`의 사용자 메시지 말풍선 위에 인용 스니펫을 읽기 전용 태그(pill)로 표시한다. 태그 미리보기 잘라내기 로직(`toTagPreview`)은 `lib/textRangeSelection.ts`로 옮겨 `ChatArea`(입력창 태그)와 함께 재사용한다.

### 마일스톤 C · 검증

- [ ] C1. 백엔드: 전송 응답과 채팅 재조회 양쪽에서 인용 내용이 채워지는지 테스트로 확인한다.
- [ ] C2. 프론트엔드: 전송 직후와 재조회(새로고침) 양쪽에서 태그가 사용자 메시지에 보이는지 컴포넌트 테스트로 확인한다.
- [ ] C3. `cd backend && .venv/bin/pytest`, `cd frontend && npx vitest run`, `cd frontend && npx tsc -b && npx oxlint src` 통과.

## 완료 기준

- 사용자가 드래그 범위 태그를 붙여 메시지를 보내면, 그 사용자 메시지 말풍선에 인용한 스니펫이 함께 표시된다.
- 대화를 새로고침하거나 다시 열어도 이 표시가 유지된다.
- 기존 입력창 태그(전송 전 미리보기·제거) 동작은 그대로 유지된다.

## 검증 방법

- `cd backend && .venv/bin/pytest`
- `cd frontend && npx vitest run`
- `cd frontend && npx tsc -b && npx oxlint src`
- 가능하면 브라우저로 실제 전송 후 표시를 확인한다.
