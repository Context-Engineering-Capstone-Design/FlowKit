from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.message import BlockResponse
from app.schemas.input_assist import AttachmentOut, SearchSourceOut


class SendMessageRequest(BaseModel):
    user_prompt: str = Field(..., alias="userPrompt")
    # 비어 있으면 일반 대화처럼 이전 흐름만 참고한다.
    context_block_ids: list[uuid.UUID] = Field(
        default_factory=list, alias="contextBlockIds"
    )
    selected_model_id: str | None = Field(None, alias="selectedModelId")
    web_search_enabled: bool = Field(False, alias="webSearchEnabled")
    attachment_ids: list[uuid.UUID] = Field(default_factory=list, alias="attachmentIds")

    model_config = ConfigDict(populate_by_name=True)


class AppliedContextOut(BaseModel):
    block_id: uuid.UUID = Field(..., serialization_alias="blockId")
    version_id: uuid.UUID = Field(..., serialization_alias="versionId")
    order_index: int = Field(..., serialization_alias="orderIndex")

    model_config = ConfigDict(populate_by_name=True)


class SendMessageResponse(BaseModel):
    user_block: BlockResponse = Field(..., serialization_alias="userBlock")
    assistant_block: BlockResponse = Field(..., serialization_alias="assistantBlock")
    applied_context: list[AppliedContextOut] = Field(
        ..., serialization_alias="appliedContext"
    )
    chat_title: str = Field(..., serialization_alias="chatTitle")
    title_generated: bool = Field(..., serialization_alias="titleGenerated")
    selected_model: str = Field(..., serialization_alias="selectedModel")
    web_search_enabled: bool = Field(..., serialization_alias="webSearchEnabled")
    attachments: list[AttachmentOut]
    search_sources: list[SearchSourceOut] = Field(..., serialization_alias="searchSources")

    model_config = ConfigDict(populate_by_name=True)


class FeedbackRequest(BaseModel):
    rating: Literal["like", "dislike"] | None


class FeedbackResponse(BaseModel):
    ai_message_block_id: uuid.UUID = Field(..., serialization_alias="aiMessageBlockId")
    rating: Literal["like", "dislike"] | None
    updated_at: datetime | None = Field(None, serialization_alias="updatedAt")

    model_config = ConfigDict(populate_by_name=True)
