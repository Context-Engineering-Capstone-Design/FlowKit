"""체인 테스트.

실제 API 를 부르지 않는다. 가짜 모델을 넣어 프롬프트 조립과 결과 처리만 검증한다.
"""

from __future__ import annotations

import pytest
from langchain_core.callbacks import CallbackManagerForLLMRun
from langchain_core.language_models import BaseChatModel
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_core.outputs import ChatGeneration, ChatResult

from modeling.chains.answer import EmptyAnswerError, build_messages, generate_answer
from modeling.chains.refine import EmptyRefineResultError, refine_blocks
from modeling.chains.title import generate_title
from modeling.config import MAX_TITLE_LENGTH
from modeling.types import AnswerRequest, ChatTurn, RefineTarget


def fake_model(*replies: str) -> GenericFakeChatModel:
    """정해진 답을 순서대로 돌려주는 모델. 호출이 한 번인 경우에만 쓴다."""
    return GenericFakeChatModel(messages=iter(replies))


class EchoModel(BaseChatModel):
    """받은 질문을 그대로 되돌려주는 모델.

    여러 블록을 한꺼번에 정제할 때는 호출이 동시에 일어나므로, 정해진 답을
    순서대로 꺼내는 방식으로는 어느 답이 어느 블록 것인지 확인할 수 없다.
    입력에 따라 답이 정해지는 모델을 써야 블록과 결과가 맞는지 검증할 수 있다.
    """

    @property
    def _llm_type(self) -> str:
        return "echo"

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: object,
    ) -> ChatResult:
        content = str(messages[-1].content)
        return ChatResult(
            generations=[ChatGeneration(message=AIMessage(content=content))]
        )


# ── 블록별 정제 ────────────────────────────────────────────────────────────


def test_refine_keeps_block_id_aligned_with_result():
    """정제 결과가 엉뚱한 블록에 붙으면 사용자가 다른 내용을 승인하게 된다."""
    targets = [
        RefineTarget("block-1", "assistant", "첫 번째 원문"),
        RefineTarget("block-2", "user", "두 번째 원문"),
        RefineTarget("block-3", "assistant", "세 번째 원문"),
    ]

    results = refine_blocks(targets, "핵심만 요약해줘", model=EchoModel())

    assert [r.block_id for r in results] == ["block-1", "block-2", "block-3"]
    for target, result in zip(targets, results, strict=True):
        assert target.content in result.refined_content


def test_refine_alignment_holds_for_many_blocks():
    targets = [RefineTarget(f"b{i}", "assistant", f"원문{i}") for i in range(8)]

    results = refine_blocks(targets, "표로 정리", model=EchoModel())

    assert len(results) == len(targets)
    for target, result in zip(targets, results, strict=True):
        assert target.content in result.refined_content


def test_refine_strips_whitespace():
    model = fake_model("  앞뒤 공백  \n")
    [result] = refine_blocks(
        [RefineTarget("b1", "assistant", "원문")], "요약", model=model
    )
    assert result.refined_content == "앞뒤 공백"


def test_refine_with_no_targets_skips_llm_call():
    assert refine_blocks([], "요약", model=fake_model()) == []


def test_refine_requires_instruction():
    with pytest.raises(ValueError):
        refine_blocks(
            [RefineTarget("b1", "assistant", "원문")], "   ", model=fake_model("x")
        )


def test_refine_rejects_empty_result():
    with pytest.raises(EmptyRefineResultError):
        refine_blocks(
            [RefineTarget("b1", "assistant", "원문")], "요약", model=fake_model("   ")
        )


# ── 제목 생성 ──────────────────────────────────────────────────────────────


def test_title_removes_quotes_and_trailing_period():
    assert generate_title("파이프라이닝 설명해줘", model=fake_model('"파이프라이닝 개요."')) == "파이프라이닝 개요"


def test_title_collapses_newlines():
    """백엔드는 줄바꿈이 든 제목을 거부하므로 여기서 없애야 한다."""
    assert generate_title("질문", model=fake_model("앞줄\n뒷줄")) == "앞줄 뒷줄"


def test_title_is_truncated_to_limit():
    title = generate_title("질문", model=fake_model("가" * 100))
    assert len(title) <= MAX_TITLE_LENGTH


def test_title_requires_prompt():
    with pytest.raises(ValueError):
        generate_title("  ", model=fake_model("제목"))


# ── 답변 생성 ──────────────────────────────────────────────────────────────


def test_messages_follow_conversation_order():
    request = AnswerRequest(
        user_prompt="새 질문",
        message_flow=[
            ChatTurn("user", "이전 질문"),
            ChatTurn("assistant", "이전 답변"),
        ],
        applied_context=[],
    )
    messages = build_messages(request)

    assert isinstance(messages[0], SystemMessage)
    assert isinstance(messages[1], HumanMessage)
    assert isinstance(messages[2], AIMessage)
    assert messages[-1].content == "새 질문"


def test_applied_context_goes_into_system_message():
    request = AnswerRequest(
        user_prompt="질문",
        message_flow=[],
        applied_context=["구조적 해저드는 자원 충돌이다", "해결은 캐시 분리"],
    )
    system = build_messages(request)[0].content

    assert "구조적 해저드는 자원 충돌이다" in system
    assert "해결은 캐시 분리" in system


def test_empty_context_entries_are_ignored():
    """공백만 있는 Context 는 붙이지 않는다.

    시스템 프롬프트 본문에도 '[적용된 Context]' 라는 말이 있으므로, 그 문구가 아니라
    Context 가 실제로 덧붙었는지를 길이로 비교한다.
    """
    base = build_messages(AnswerRequest("질문", [], []))[0].content
    with_blank = build_messages(
        AnswerRequest("질문", [], applied_context=["  ", ""])
    )[0].content

    assert with_blank == base


def test_generate_answer_strips_output():
    request = AnswerRequest("질문", [], [])
    assert generate_answer(request, model=fake_model("  답변  ")).text == "답변"


def test_generate_answer_requires_prompt():
    with pytest.raises(ValueError):
        generate_answer(AnswerRequest("  ", [], []), model=fake_model("답변"))


def test_generate_answer_rejects_empty_response():
    request = AnswerRequest("질문", [], [])
    with pytest.raises(EmptyAnswerError):
        generate_answer(request, model=fake_model("   "))
