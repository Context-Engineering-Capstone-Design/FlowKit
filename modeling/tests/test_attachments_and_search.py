"""첨부 입력과 웹 검색 테스트 .

실제 API 를 부르지 않는다.
"""

from __future__ import annotations

import base64

import pytest
from langchain_core.messages import AIMessage

from modeling.attachments import (
    AttachmentNotReadableError,
    AttachmentNotSupportedError,
)
from modeling.chains.answer import build_messages, extract_sources, extract_usage, web_search_invoked
from modeling.types import Attachment, AnswerRequest


def text_file(name: str, body: str, file_type: str = "text/plain") -> Attachment:
    return Attachment(name, name, file_type, body.encode("utf-8"))


def image_file(name: str = "사진.png") -> Attachment:
    return Attachment(name, name, "image/png", b"\x89PNG fake bytes")


# ── 첨부 없는 요청 ──────────────────────────────────────────────────────────


def test_request_without_attachments_is_unchanged():
    """첨부를 도입해도 첨부 없이 묻는 기존 흐름이 달라지면 안 된다 ."""
    plain = build_messages(AnswerRequest("질문", [], []))
    assert plain[-1].content == "질문"


# ── 이미지 첨부 ─────────────────────────────────────────────────────────────


def test_image_is_sent_as_is_not_as_text():
    """이미지를 글자로 바꾸면 모델이 그림을 볼 수 없다 ."""
    request = AnswerRequest("이 사진 설명해줘", [], [], attachments=[image_file()])
    content = build_messages(request)[-1].content

    assert isinstance(content, list)
    blocks = {b["type"] for b in content}
    assert blocks == {"text", "image_url"}

    url = next(b for b in content if b["type"] == "image_url")["image_url"]["url"]
    assert url.startswith("data:image/png;base64,")
    assert base64.b64decode(url.split(",", 1)[1]) == image_file().content


def test_question_text_stays_with_the_image():
    """질문과 이미지가 한 메시지에 있어야 '이 사진에서'가 이어진다."""
    request = AnswerRequest("이 사진 설명해줘", [], [], attachments=[image_file()])
    content = build_messages(request)[-1].content
    assert next(b for b in content if b["type"] == "text")["text"] == "이 사진 설명해줘"


def test_empty_image_is_rejected():
    empty = Attachment("a", "빈그림.png", "image/png", b"")
    with pytest.raises(AttachmentNotReadableError):
        build_messages(AnswerRequest("질문", [], [], attachments=[empty]))


# ── 문서 첨부 ───────────────────────────────────────────────────────────────


def test_document_text_is_prepended_with_file_name():
    """어느 파일에서 나온 내용인지 알 수 있어야 한다 ."""
    request = AnswerRequest(
        "요약해줘", [], [], attachments=[text_file("보고서.txt", "본문 내용")]
    )
    content = build_messages(request)[-1].content

    assert isinstance(content, str)
    assert "보고서.txt" in content
    assert "본문 내용" in content
    assert content.endswith("요약해줘")


def test_multiple_documents_are_separated_by_file():
    request = AnswerRequest(
        "비교해줘",
        [],
        [],
        attachments=[text_file("가.txt", "가 내용"), text_file("나.txt", "나 내용")],
    )
    content = build_messages(request)[-1].content
    assert content.index("가.txt") < content.index("나.txt") < content.index("비교해줘")


def test_empty_document_is_rejected_not_skipped():
    """빈 파일을 조용히 넘기면 사용자는 첨부가 반영된 줄 안다."""
    with pytest.raises(AttachmentNotReadableError):
        build_messages(AnswerRequest("질문", [], [], attachments=[text_file("빈.txt", "  ")]))


def test_unsupported_file_type_is_rejected():
    binary = Attachment("a", "프로그램.exe", "application/octet-stream", b"\x00\x01")
    with pytest.raises(AttachmentNotSupportedError):
        build_messages(AnswerRequest("질문", [], [], attachments=[binary]))


def test_undecodable_text_is_rejected():
    """깨진 글자를 모델에 넘기면 엉뚱한 답이 나온다."""
    broken = Attachment("a", "깨진.txt", "text/plain", b"\xff\xfe\xff\xfe")
    with pytest.raises(AttachmentNotReadableError):
        build_messages(AnswerRequest("질문", [], [], attachments=[broken]))


def test_image_and_document_can_be_mixed():
    request = AnswerRequest(
        "정리해줘",
        [],
        [],
        attachments=[text_file("메모.txt", "메모 내용"), image_file()],
    )
    content = build_messages(request)[-1].content

    assert isinstance(content, list)
    text = next(b for b in content if b["type"] == "text")["text"]
    assert "메모 내용" in text and text.endswith("정리해줘")
    assert any(b["type"] == "image_url" for b in content)


# ── 검색 근거 ───────────────────────────────────────────────────────────────


def test_search_sources_are_extracted():
    """OpenAI Responses API 는 본문 블록의 annotations 에 인용을 싣는다."""
    response = AIMessage(
        content=[
            {
                "type": "text",
                "text": "답변",
                "annotations": [
                    {
                        "type": "url_citation",
                        "title": "파이프라이닝 정리",
                        "url": "https://example.com/a",
                    },
                    {
                        "type": "url_citation",
                        "title": None,
                        "url": "https://example.com/b",
                    },
                ],
            }
        ],
    )
    sources = extract_sources(response)

    assert [s.url for s in sources] == ["https://example.com/a", "https://example.com/b"]
    assert sources[0].title == "파이프라이닝 정리"
    assert sources[1].title == "https://example.com/b"  # 제목이 없으면 주소로 채운다


def test_duplicate_urls_are_deduplicated():
    """같은 자료가 여러 번 인용될 수 있다."""
    response = AIMessage(
        content=[
            {
                "type": "text",
                "text": "답변",
                "annotations": [
                    {"type": "url_citation", "title": "정리", "url": "https://example.com/a"},
                    {"type": "url_citation", "title": "정리", "url": "https://example.com/a"},
                ],
            }
        ],
    )
    assert len(extract_sources(response)) == 1


def test_missing_annotations_is_not_a_failure():
    """검색을 켜도 모델이 검색을 쓰지 않을 수 있다 ."""
    assert extract_sources(AIMessage(content="답변")) == []


def test_annotation_without_url_is_skipped():
    response = AIMessage(
        content=[{"type": "text", "text": "답변", "annotations": [{"type": "url_citation"}]}],
    )
    assert extract_sources(response) == []


# ── 웹 검색 실제 실행 신호 (, 0820_06 B4·B5) ──────────────────────


def test_web_search_invoked_true_when_provider_reports_a_search_call():
    response = AIMessage(
        content=[
            {"type": "web_search_call", "status": "completed"},
            {"type": "text", "text": "답변", "annotations": []},
        ],
    )
    assert web_search_invoked(response) is True


def test_web_search_invoked_false_without_provider_signal():
    """인용이 없고 공급자 신호도 없으면 실제 실행 여부를 확정하지 않는다."""
    assert web_search_invoked(AIMessage(content="답변")) is False
    assert web_search_invoked(AIMessage(content=[{"type": "text", "text": "답변"}])) is False


# ── 토큰 사용량 (0820_06 D4) ─────────────────────────────────────────────────


def test_extract_usage_reads_provider_usage_metadata():
    response = AIMessage(content="답변")
    response.usage_metadata = {"input_tokens": 120, "output_tokens": 40, "total_tokens": 160}
    usage = extract_usage(response)
    assert (usage.input_tokens, usage.output_tokens, usage.total_tokens) == (120, 40, 160)


def test_extract_usage_is_none_without_provider_usage():
    """공급자가 사용량을 안 주면 0으로 채우지 않고 None을 돌려준다."""
    assert extract_usage(AIMessage(content="답변")) is None
