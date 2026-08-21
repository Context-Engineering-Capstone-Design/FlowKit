# Project 학습 대화 QA

## 목표

학습 주제 Project와 그 안의 대화를 만들고, 목록·이동·새로고침 상태를 검증한다.

## 범위

- Project 생성
- Project 안에서 학습 대화 생성
- 최근 대화와 Project 목록의 상태 유지

## 완료 기준

- 생성한 Project와 대화가 새로고침 뒤에도 올바른 위치에 보인다.
- 재현 가능한 오류는 수정하고 관련 테스트와 브라우저에서 다시 확인한다.

## 검증 방법

- 로컬 개발 로그인 뒤 외부 브라우저로 동작을 실행한다.
- 콘솔 오류와 API 응답 상태를 읽기 전용으로 확인한다.

## 구현 결과

- 학습용 Project `트랜스포머 학습 QA`를 만들고, Self-Attention 학습 지침을 저장했다.
- Project 안에서 Multi-Head Attention 학습 대화를 만들었다.
- 새로고침 뒤에도 Project 이름·지침과 대화가 Project 하위 목록에 유지됐다.

## 검증 결과

- Project 생성 `POST /api/projects` — `201 Created`
- Project 저장 `PATCH /api/projects/{id}` — `200 OK`
- Project 대화 생성 `POST /api/chats` — `201 Created`
- 외부 브라우저에서 Project를 다시 펼쳐 대화 제목이 남아 있는 것을 확인했다.

## 남은 제한 사항

- OpenAI API 키가 없어 해당 대화의 AI 답변 성공 경로는 검증하지 못했다. 실패 상태 표시만 확인했다.
