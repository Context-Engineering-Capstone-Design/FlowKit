# 0821_07 입력창 안에 Context 태그를 끼워 넣기

- 상태: 구현 완료
- 관련 기능: 하단 입력창, 드래그 범위 Context 태그

## 목표

드래그로 고른 Context 태그를 입력 상자 위쪽 줄이 아니라, 질문 글 사이에 칩으로 넣는다. 전송할 질문 문자열에는 칩 문구를 넣지 않고, 태그는 지금처럼 별도 Context로만 보낸다.

## 기획과의 차이

이번 작업에서 `FE-INPUT-006`을 질문 글 사이 칩 기준으로 고쳤다. 전송 의미(태그는 Context, 질문 글은 본문)는 바꾸지 않았다.

- `기획 문서/FE기능명세서/2.9 입력 보조.md` `FE-INPUT-006`
- `기획 문서/요구사항정의서/2.5 Context 편집.md` REQ-072 변경 이력

## 범위

### 마일스톤 A · 입력 영역

- [x] A1. 질문 입력을 `textarea` 대신 칩을 품을 수 있는 편집 영역으로 바꿨다
- [x] A2. 새 태그는 지금 커서 위치에 넣고, 커서가 입력창 밖이면 맨 뒤에 넣는다
- [x] A3. 칩 `X` 또는 바로 뒤 Backspace로 태그를 제거한다
- [x] A4. 전송 본문에는 칩 문구를 넣지 않는다. 태그만 있고 질문 글이 비면 보내지지 않는다

### 마일스톤 B · 기존 입력 동작 유지

- [x] B1. 한글 조합 중 Enter로 전송하지 않는다
- [x] B2. 이미지 붙여넣기, 자동 높이, placeholder, 입력창 포커스를 유지한다

### 마일스톤 C · 검증

- [x] C1. 태그가 입력 영역 안에 보이고, `X`로 제거되며, 호버 미리보기가 동작한다
- [x] C2. 전송 호출의 질문 문자열에 칩 문구가 없다
- [x] C3. 관련 프론트 테스트와 `npx tsc -b` 통과. `npx oxlint src`는 기존 경고만 있고 새 오류는 없다

## 구현 항목

- 입력창을 칩을 품는 편집 영역으로 바꿨다. 타이핑 중에는 DOM을 다시 그리지 않아 한글 조합이 깨지지 않게 했다 — [ComposerEditor.tsx](../../frontend/src/components/ComposerEditor.tsx)
- 칩을 제외한 질문 글만 읽고, 커서 위치에 칩을 넣는 도우미를 분리했다 — [composerEditor.ts](../../frontend/src/lib/composerEditor.ts)
- 하단 Composer는 위쪽 태그 줄을 없애고 이 편집 영역을 쓴다 — [ChatArea.tsx](../../frontend/src/components/ChatArea.tsx)
- 칩 모양과 빈 입력 안내 문구는 전역 스타일에 두었다 — [index.css](../../frontend/src/index.css)

## 검증 결과

- `npx vitest run src/components/ChatArea.test.tsx src/lib/composerEditor.test.ts`: 15건 통과
- `npx tsc -b`: 통과
- `npx oxlint src`: 이번 파일에서 오류 없음
- 전체 `npx vitest run`에는 Sidebar·chatStore 알림 테스트 2건이 실패했으나, 입력창 칩과 무관한 기존 실패로 보인다

## 완료 기준

- 채팅에 추가한 범위 태그가 질문 글 사이에 칩으로 보인다
- 전송 시 질문 글과 Context 태그가 나뉘어 전달되고, 전송 뒤 입력창이 비워진다

## 남은 제한 사항

- 첨부 파일은 여전히 입력 글 위에 목록으로 둔다
- 탭을 바꾸면 지금도 초안을 버리므로, 칩이 글 어디에 있었는지는 탭별로 기억하지 않는다
- 전체 vitest 2건 실패는 이번 범위에서 고치지 않았다
