# 0820_14 사이드바 Project 목록

## 목표

좌측 사이드바에서 사용자의 Project 목록과 각 Project에 속한 대화 수를 확인하고, 항목을 눌러 해당 Project 관리 창을 바로 연다.

## 범위

- 기존 `GET /api/projects`를 사용해 사이드바에 Project 목록을 표시한다.
- 선택한 Project를 `ProjectManager`에서 바로 열 수 있게 한다.
- 관리 창을 닫은 뒤 목록을 다시 불러와 생성·이름 변경·삭제 결과를 반영한다.
- 로딩·불러오기 실패·Project 없음 상태를 안전하게 표시한다.

## 완료 기준

- [x] 사이드바에 Project 이름과 대화 수가 표시된다.
- [x] Project를 누르면 해당 Project의 관리 창이 열린다.
- [x] 관리 창을 닫으면 사이드바 목록이 최신 상태로 갱신된다.
- [x] 관련 컴포넌트 테스트와 프론트엔드 타입 검사·린트·빌드가 통과한다.

## 검증 방법

- `Sidebar` 테스트에서 목록 표시, 선택, 실패 상태를 확인한다.
- `cd frontend && npx vitest run src/components/Sidebar.test.tsx`
- `cd frontend && npx tsc --noEmit && npm run lint && npm run build`

## 구현 결과 (2026-08-20)

- 기준 커밋: `e14bcad`
- 좌측 패널 상단에 Project 이름과 소속 대화 수를 표시했다. 로딩·목록 없음·불러오기 실패 상태도 함께 표시한다.
- Project 항목을 누르면 기존 관리 창이 해당 Project를 바로 선택한 상태로 열린다. 관리 창을 닫으면 목록을 다시 불러와 변경 내용을 반영한다.
- `Sidebar` 컴포넌트 테스트 8건 통과.
- `npx tsc --noEmit`, `npm run lint`, `npm run build` 통과. 기존 React effect/ref 관련 린트 경고는 남아 있으나 오류는 없다.

## 제한 사항

- 브라우저 직접 확인은 하지 못했다. 브라우저 환경에서 `127.0.0.1:5173` 연결이 거부됐으며, 자동 테스트와 빌드로 검증했다.
