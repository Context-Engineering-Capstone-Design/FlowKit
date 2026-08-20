# 0820_14 사이드바 Project 목록

## 목표

좌측 사이드바에서 사용자의 Project 목록과 각 Project에 속한 대화 수를 확인하고, 항목을 눌러 해당 Project 관리 창을 바로 연다.

## 범위

- 기존 `GET /api/projects`를 사용해 사이드바에 Project 목록을 표시한다.
- 선택한 Project를 `ProjectManager`에서 바로 열 수 있게 한다.
- 관리 창을 닫은 뒤 목록을 다시 불러와 생성·이름 변경·삭제 결과를 반영한다.
- 로딩·불러오기 실패·Project 없음 상태를 안전하게 표시한다.

## 완료 기준

- [ ] 사이드바에 Project 이름과 대화 수가 표시된다.
- [ ] Project를 누르면 해당 Project의 관리 창이 열린다.
- [ ] 관리 창을 닫으면 사이드바 목록이 최신 상태로 갱신된다.
- [ ] 관련 컴포넌트 테스트와 프론트엔드 타입 검사·린트·빌드가 통과한다.

## 검증 방법

- `Sidebar` 테스트에서 목록 표시, 선택, 실패 상태를 확인한다.
- `cd frontend && npx vitest run src/components/Sidebar.test.tsx`
- `cd frontend && npx tsc --noEmit && npm run lint && npm run build`
