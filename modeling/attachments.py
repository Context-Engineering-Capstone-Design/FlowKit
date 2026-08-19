"""첨부 파일을 모델 입력으로 바꾼다 (AI-ATTACH-001, 002, 003).

이미지는 글자로 바꾸지 않고 그대로 싣는다. 문서는 글자를 뽑아 질문 앞에 붙인다.
"""

from __future__ import annotations

import base64
import io

from modeling.types import Attachment


class AttachmentNotReadableError(ValueError):
    """첨부에서 글자를 뽑지 못했을 때.

    조용히 넘기지 않는다. 넘기면 사용자는 첨부가 반영된 줄 알고 답을 받는다.
    """


class AttachmentNotSupportedError(ValueError):
    """첨부 입력을 지원하지 않는 모델로 첨부를 보냈을 때."""


_TEXT_TYPES = ("text/", "application/json", "application/xml")


def split(attachments: list[Attachment]) -> tuple[list[Attachment], list[Attachment]]:
    """이미지와 문서를 가른다. 처리 방식이 서로 다르기 때문이다."""
    images = [a for a in attachments if a.file_type.startswith("image/")]
    documents = [a for a in attachments if not a.file_type.startswith("image/")]
    return images, documents


def image_blocks(images: list[Attachment]) -> list[dict]:
    """이미지를 모델이 읽는 형태로 바꾼다 (AI-ATTACH-001)."""
    blocks = []
    for image in images:
        if not image.content:
            raise AttachmentNotReadableError(f"이미지를 읽을 수 없습니다: {image.file_name}")
        encoded = base64.b64encode(image.content).decode("ascii")
        blocks.append(
            {
                "type": "image_url",
                "image_url": {"url": f"data:{image.file_type};base64,{encoded}"},
            }
        )
    return blocks


def document_text(documents: list[Attachment]) -> str:
    """문서에서 글자를 뽑아 하나로 합친다 (AI-ATTACH-002).

    어느 파일에서 나온 내용인지 알 수 있게 파일 이름을 함께 넣는다.
    """
    chunks = []
    for doc in documents:
        text = _extract(doc).strip()
        if not text:
            raise AttachmentNotReadableError(
                f"파일에서 글자를 찾지 못했습니다: {doc.file_name}"
            )
        chunks.append(f"[첨부 · {doc.file_name}]\n{text}")
    return "\n\n".join(chunks)


def _extract(doc: Attachment) -> str:
    if doc.file_type == "application/pdf":
        return _extract_pdf(doc)
    if doc.file_type.startswith(_TEXT_TYPES):
        return _decode(doc)
    raise AttachmentNotSupportedError(
        f"지원하지 않는 파일 형식입니다: {doc.file_name} ({doc.file_type})"
    )


def _extract_pdf(doc: Attachment) -> str:
    try:
        from pypdf import PdfReader
    except ImportError as exc:  # pragma: no cover - 설치 누락은 환경 문제다
        raise AttachmentNotReadableError(
            "PDF 를 읽으려면 pypdf 가 필요합니다."
        ) from exc

    try:
        reader = PdfReader(io.BytesIO(doc.content))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    except AttachmentNotReadableError:
        raise
    except Exception as exc:
        raise AttachmentNotReadableError(
            f"PDF 를 읽을 수 없습니다: {doc.file_name}"
        ) from exc


def _decode(doc: Attachment) -> str:
    """글자 파일을 문자열로 바꾼다.

    사용자가 올리는 파일의 인코딩은 제각각이라, UTF-8 로 못 읽으면 한 번 더
    시도한다. 그래도 안 되면 깨진 글자를 모델에 넘기지 않고 오류를 낸다.
    """
    for encoding in ("utf-8", "cp949"):
        try:
            return doc.content.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise AttachmentNotReadableError(f"파일의 문자 인코딩을 알 수 없습니다: {doc.file_name}")
