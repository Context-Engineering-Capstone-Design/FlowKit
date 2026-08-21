# Context 편집 패널을 독립된 우측 패널로 분리

## 배경 (지금 무엇이 문제인가)

대화 화면 오른쪽 위의 "Context 편집" 버튼을 누르면, 지금 보고 있던 대화 내용이 사라지고 그 자리에 Context 편집 패널이 통째로 대신 나타난다. 화면 맨 위 탭 줄에는 "Context 편집"이 실제 대화 탭들(예: "새 대화", 사이드 채팅 탭)과 완전히 똑같은 모양으로 한 자리 끼어든다.

기대하는 동작은 이것과 반대다.

- **기대하는 동작**: Context 편집 버튼을 누르면 Context 편집 패널이 독립된 "우측 패널"로 뜬다. 원래 보고 있던 대화(들)는 그 우측 패널 쪽에서 다시 돌아갈 수 있는 탭으로 붙어 있어야 한다.
- **실제 동작**: 대화 화면을 감싸던 틀이 그대로 바깥쪽을 차지한 채, Context 편집 패널이 그 안쪽에 끼어 들어가는 형태로 나타난다. 두 화면의 포함 관계가 기대와 반대로 되어 있다.

## 원인 (코드상 왜 이렇게 되어 있는가)

- [ChatPane.tsx:25](../../frontend/src/components/ChatPane.tsx) 에서 Context 편집이 켜지면, 대화 화면([ChatArea.tsx](../../frontend/src/components/ChatArea.tsx))이 있던 같은 자리에서 [ContextPanel.tsx](../../frontend/src/components/ContextPanel.tsx)로 통째로 바꿔치기한다. 즉 Context 편집 패널이 대화 화면의 틀([ChatPane.tsx](../../frontend/src/components/ChatPane.tsx)) 안쪽 자식으로 들어가는 구조다.
- [ChatTabBar.tsx:55-59](../../frontend/src/components/ChatTabBar.tsx) 는 Context 편집이 켜지면 실제 대화 탭 목록 맨 뒤에 "Context 편집"이라는 탭 하나를 똑같은 모양으로 추가한다. 실제 대화가 아닌데도 겉보기로 구분이 안 된다.
- [ContextPanel.tsx:20](../../frontend/src/components/ContextPanel.tsx) 자체 주석도 "대화 패널 안 Context 편집 탭"이라 밝히고 있어, 지금 구조는 실수가 아니라 의도된 설계였다.
- 이 설계는 [0821_06 결과 문서](../02_result/0821_06_대화_패널_2분할과_탭_통합.md)에서 "Context 편집을 같은 패널의 Context 편집 탭으로 표시한다"로 이미 기록되어 있다. **이번 작업은 그 결정을 뒤집는 것**이다. 구현 담당자는 이 문서를 참고해, 뒤집는 이유(사용자가 직접 확인한 문제)를 결과 문서에도 남겨야 과거 기록과 앞뒤가 맞는다.

## 목표

Context 편집을 열었을 때 화면의 포함 관계를 뒤집는다. 대화 화면 틀은 그대로 유지하고, 그 틀 위(또는 옆)에 Context 편집 패널이 독립된 우측 패널로 뜨도록 만든다. 원래 보던 대화(탭이 여러 개면 그 전체)는 Context 편집 패널이 열린 동안에도 그쪽에서 탭으로 다시 접근할 수 있어야 한다.

## 범위

1. `ContextPanel`이 열렸을 때, `ChatPaneBody`(대화 화면 틀) 안쪽 자식으로 끼어드는 지금 구조를 바꿔, `ContextPanel`이 대화 틀 바깥(형제 요소 또는 더 위 단계)에서 독립적으로 뜨도록 렌더링 순서를 바꾼다.
2. [ChatTabBar.tsx](../../frontend/src/components/ChatTabBar.tsx)에서 "Context 편집"을 실제 대화 탭과 같은 줄·같은 모양으로 끼워 넣는 지금 방식을 없앤다.
3. Context 편집 패널이 열려 있는 동안에도 원래 대화(들)로 돌아갈 수 있는 탭 형태의 진입점을, Context 편집 패널 쪽 화면 구조에 마련한다.
4. 메인 패널과 우측 사이드 패널([Workspace, App.tsx:73](../../frontend/src/App.tsx)) 양쪽 모두 각자 독립된 `ChatPane`이므로, 두 곳 모두에서 같은 방식으로 동작하는지 각각 확인한다.

## 범위 밖

- Context 편집 패널 안의 기능(블록 선택, 정제 요청·미리보기 등)은 이번 작업과 무관하며 손대지 않는다.
- 하나의 대화 패널에서 Context 편집 패널을 동시에 여러 개(여러 탭으로) 여는 기능은 다루지 않는다. 지금처럼 대화 패널당 Context 편집은 한 번에 하나만 연다는 전제를 유지한다.
- 좁은 화면(반응형) 레이아웃의 세부 조정은 이번 작업 범위 밖이다. 구조 전환은 데스크톱 폭 기준으로 맞추고, 좁은 화면 확인은 이후 별도로 진행한다.

## 완료 기준

- [ ] Context 편집 버튼을 누르면 대화 화면 틀이 사라지지 않고, Context 편집 패널이 별도 영역(우측 패널)으로 뜬다.
- [ ] 대화 탭 목록에 더 이상 "Context 편집"이 일반 대화 탭과 같은 자리·같은 모양으로 섞여 나오지 않는다.
- [ ] Context 편집 패널이 열려 있는 동안, 원래 대화(탭이 여러 개면 전체)로 되돌아갈 수 있는 탭이 Context 편집 패널 쪽 화면에 보인다.
- [ ] 메인 패널과 우측 사이드 패널 양쪽에서 각각 Context 편집을 열고 닫아도 서로 상태가 섞이지 않는다.
- [ ] 관련 자동 테스트([ChatArea.test.tsx](../../frontend/src/components/ChatArea.test.tsx), [ChatTabBar.test.tsx](../../frontend/src/components/ChatTabBar.test.tsx), [ContextPanel.test.tsx](../../frontend/src/components/ContextPanel.test.tsx))를 바뀐 구조에 맞게 갱신하고 통과시킨다.

## 검증 방법

- 로컬 개발 서버(`localhost:5173`)에서 대화를 연 뒤 Context 편집 버튼을 눌러, 패널이 뜨는 방식과 원래 대화로 돌아가는 탭이 기대한 자리에 나오는지 브라우저로 직접 확인한다.
- 우측 사이드 패널이 열려 있는 상태에서도 같은 과정을 반복해, 메인·사이드 양쪽에서 동일하게 동작하는지 확인한다.
- 위에 적은 세 파일의 자동 테스트를 갱신한 뒤 실행해 통과를 확인한다.
