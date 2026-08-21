# 0821_09 수정 모드 Context 태그 인라인 편집

- 상태: 구현 완료
- 기준 커밋: `a519b3f`
- 관련 기능: 메시지 수정, 인라인 Context 태그, 버전별 인용 기록

## 목표

메시지 수정 화면을 새 질문 입력창(`ComposerEditor`)과 같은 방식으로 전환하여, 수정 중에도 Context 태그를 인라인 칩으로 확인·추가·삭제할 수 있게 하고, 수정 결과 및 버전별 인용 기록을 서버에 저장·동기화한다.

## 확정 결정 사항 (A안 적용)

- 인용 기록(`AppliedContextLog`)을 메시지 블록 단위가 아닌 **메시지 블록 버전(`message_block_version_id`) 단위**로 저장하도록 DB 구조를 변경했다.
- 사용자가 버전을 이동하면 해당 버전 저장 당시의 인용 태그 목록이 그대로 복원되어 표시된다.
- 인용 태그가 읽기 전용이라는 기존 설계 제약을 해제하고 수정 모드에서 태그의 추가·삭제를 지원한다.

## 구현 항목

### 백엔드

- **Alembic 마이그레이션 (`a82109_context_log_by_version.py`)**: `applied_context_logs` 테이블의 외래키를 `user_message_block_id`에서 `message_block_version_id`로 전환. 기존 데이터는 각 블록의 현재 버전 ID로 마이그레이션.
- **수정 요청 스키마 (`EditBlockRequest`)**: `context_ranges: list[ContextRangeIn]` 필드를 추가하여 수정 시 변경된 태그 목록 수신.
- **수정 처리 서비스 (`message_service.save_edit`)**: 새 버전을 생성한 후 전달받은 `context_ranges`를 스니펫 유효성 검증(원문의 부분 문자열 검증)을 거쳐 새 버전에 연결된 `AppliedContextLog`로 저장.
- **응답 스키마 (`BlockResponse` / `BlockMutationResponse`)**: `appliedContext` 필드를 포함하여 수정 및 버전 변경 직후 화면 상태를 즉시 동기화.
- **버전별 조회 (`chat.py`, `context_service.py`)**: `_applied_context_by_block` 및 `applied_items_for_version`을 통해 현재 활성 버전 기준의 인용 태그 목록을 조회.

### 프론트엔드

- **수정 폼 컴포넌트 ([MessageEditForm.tsx](../../frontend/src/components/MessageEditForm.tsx))**: 순수 `textarea` 대신 [ComposerEditor.tsx](../../frontend/src/components/ComposerEditor.tsx)를 사용하여 태그가 텍스트와 한 줄 흐름(인라인 칩)으로 표시되고 X 버튼으로 제거 가능하도록 구현.
- **수정 상태 관리 ([chatStore.ts](../../frontend/src/store/chatStore.ts))**:
  - 수정 세션 전용 태그 상태인 `editingContextTags` 추가.
  - `startEdit` 시 블록의 `appliedContext`를 `editingContextTags`로 변환하여 로드.
  - 수정 모드가 열린 상태에서 다른 메시지를 드래그하여 "채팅에 추가" 시 `editingContextTags`에 추가.
  - `editBlock` 시 `editingContextTags`를 `contextRanges`로 변환하여 서버에 전달하고 성공 시 상태 갱신.
  - `cancelEdit` 시 수정 중이던 태그와 초안 초기화.
- **메시지 블록 렌더링 ([MessageBlockItem.tsx](../../frontend/src/components/MessageBlockItem.tsx))**: 수정 모드에서 `MessageEditForm`에 `editingContextTags`와 핸들러를 연결하여 렌더링.

## 검증 결과

- 백엔드 테스트: `backend/.venv/bin/pytest backend/tests -q` (254건 통과)
  - `test_edit_saves_context_ranges_per_version`: 수정 시 태그 저장 및 버전 복원 검증
  - `test_edit_rejects_forged_context_range`: 위조된 스니펫 거부 검증
- 프론트엔드 테스트: `frontend npm test -- --run` (172건 통과)
  - `MessageBlockItem.test.tsx`: 수정 모드에서 인라인 칩 표시, 태그 삭제, 취소 및 저장 동작 검증
  - `chatStore.test.ts`: `startEdit`, `addContextRangeTag`, `editBlock`, `cancelEdit`, `setActiveVersion` 연동 검증
- 타입스크립트 컴파일: `frontend npx tsc -b` (오류 없음)
- 린트 점검: `frontend npx oxlint src` (오류 없음)

## 완료 기준 달성 여부

- [x] 수정 모드에서 태그가 텍스트와 같은 줄 흐름으로 보인다.
- [x] 수정 모드에서 태그를 X로 지울 수 있다.
- [x] 수정 모드가 열린 동안 다른 메시지에서 드래그 → "채팅에 추가"를 누르면 수정 중인 메시지에 태그가 붙는다.
- [x] 저장하면 새 태그 목록이 서버에 저장되고, 화면도 그 결과로 갱신된다.
- [x] 취소하면 태그 변경이 버려지고 원래 태그로 되돌아온다.
- [x] 버전을 오갈 때(A안 기준) 그 버전 저장 당시의 태그가 보인다.
- [x] 백엔드: 새 스니펫도 기존과 같은 방식으로 "원문의 실제 부분 문자열인지" 검증한다(위조 방지).

## 남은 제한 사항

- "브랜치로 저장"(`createBranchAt`)은 기존 동작대로 수정 중인 텍스트를 반영하지 않고 원본 블록 기준으로 새 브랜치를 생성한다.
