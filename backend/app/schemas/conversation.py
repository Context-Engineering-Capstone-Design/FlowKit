from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.input_assist import AttachmentOut, SearchSourceOut
from app.schemas.message import AppliedContextOut, BlockResponse, ContextRangeIn
from app.schemas.notification import ActionMeta


class SendMessageRequest(BaseModel):
    user_prompt: str = Field(..., alias="userPrompt")
    # 비어 있으면 일반 대화처럼 이전 흐름만 참고한다.
    context_block_ids: list[uuid.UUID] = Field(
        default_factory=list, alias="contextBlockIds"
    )
    context_ranges: list[ContextRangeIn] = Field(
        default_factory=list, alias="contextRanges"
    )
    selected_model_id: str | None = Field(None, alias="selectedModelId")
    web_search_mode: Literal["off", "auto", "always"] = Field("off", alias="webSearchMode")
    attachment_ids: list[uuid.UUID] = Field(default_factory=list, alias="attachmentIds")
    reasoning_effort: Literal["low", "medium", "high", "xhigh", "max"] = Field("medium", alias="reasoningEffort")
    library_resource_ids: list[uuid.UUID] = Field(default_factory=list, alias="libraryResourceIds")

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
    web_search_mode: Literal["off", "auto", "always"] = Field(..., serialization_alias="webSearchMode")
    reasoning_effort: Literal["low", "medium", "high", "xhigh", "max"] = Field(..., serialization_alias="reasoningEffort")
    attachments: list[AttachmentOut]
    search_sources: list[SearchSourceOut] = Field(..., serialization_alias="searchSources")
    ai_response_job_id: uuid.UUID = Field(..., serialization_alias="aiResponseJobId")
    job_status: str = Field(..., serialization_alias="jobStatus")
    action_meta: ActionMeta = Field(..., serialization_alias="actionMeta")

    model_config = ConfigDict(populate_by_name=True)


class FeedbackRequest(BaseModel):
    rating: Literal["like", "dislike"] | None


class FeedbackResponse(BaseModel):
    ai_message_block_id: uuid.UUID = Field(..., serialization_alias="aiMessageBlockId")
    rating: Literal["like", "dislike"] | None
    updated_at: datetime | None = Field(None, serialization_alias="updatedAt")

    model_config = ConfigDict(populate_by_name=True)


class FeedbackMutationResponse(FeedbackResponse):
    action_meta: ActionMeta = Field(..., serialization_alias="actionMeta")
