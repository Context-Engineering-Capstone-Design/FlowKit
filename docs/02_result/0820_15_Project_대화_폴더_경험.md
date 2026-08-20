# 0820_15 Project 대화 폴더 경험

## 목표

Project를 대화 폴더로 제공한다. 좌측 패널에서 Project별 대화를 열고, Project 안에서 새 대화를 만들며, 대화를 Project 사이 또는 Project 밖으로 옮긴다.

## 범위

- Project별 대화 목록과 Project 밖 대화를 좌측 패널에 구분해 표시한다.
- Project 행에서 새 대화 생성, 대화 행에서 Project 이동을 지원한다.
- Project 삭제 시 대화는 삭제하지 않고 Project 밖 대화로 보존한다.
- 전송 전 Project Library 자료를 선택해 AI 입력에 넣는다.

## 완료 기준

- [x] Project별 대화 폴더와 Project 밖 대화가 표시된다.
- [x] Project 안에서 생성한 대화가 해당 Project에 속한다.
- [x] 대화를 다른 Project 또는 Project 밖으로 이동할 수 있다.
- [x] Project 삭제 뒤 대화가 보존된다.
- [x] Library 자료 선택이 전송 요청에 포함된다.
- [x] 관련 테스트·타입 검사·빌드가 통과한다.

## 구현 결과 (2026-08-20)

- 기준 커밋: `8328237`
- 좌측 패널에서 Project 폴더를 펼쳐 소속 대화를 열고, 폴더의 `+` 버튼으로 해당 Project에 바로 새 대화를 만든다. Project 밖 대화는 기존 최근 대화 구역에만 표시한다.
- Project 폴더 안 대화의 선택 상자로 다른 Project 또는 `밖`으로 옮길 수 있다. 메인 대화를 옮기면 기존 규칙대로 그 사이드 채팅 트리도 함께 움직인다.
- Project 삭제는 설정·메모리·Library 자료만 삭제하고, 소속 대화는 Project 밖으로 보존한다.
- Project 대화의 입력창에서 책 아이콘을 눌러 Library 자료를 선택하면 해당 자료만 AI 전송 요청에 포함한다.

## 검증

- `backend/.venv/bin/pytest tests/test_project.py tests/test_chat.py -q` — 34 passed
- `frontend/npx vitest run src/components/Sidebar.test.tsx` — 8 passed
- `frontend/npx tsc --noEmit && npm run build` — 통과

## 제한 사항

- 실제 브라우저 검증은 이번 범위에서 하지 못했다. 자동 테스트와 프로덕션 빌드로 확인했다.
