from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.models import FeedbackType
from app.schemas.notification import ActionMeta

FeedbackContent = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2_000)
]
FeedbackContextText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
]


class FeedbackContextInfo(BaseModel):
    """피드백에 붙일 수 있는 화면·채팅·브랜치 식별 정보."""

    page: FeedbackContextText | None = None
    chat_id: FeedbackContextText | None = Field(None, alias="chatId")
    branch_id: FeedbackContextText | None = Field(None, alias="branchId")

    model_config = ConfigDict(populate_by_name=True, extra="ignore")


class FeedbackRequest(BaseModel):
    feedback_type: FeedbackType = Field(..., alias="feedbackType")
    content: FeedbackContent
    context_info: FeedbackContextInfo | None = Field(None, alias="contextInfo")

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class FeedbackResponse(BaseModel):
    feedback_id: uuid.UUID = Field(..., serialization_alias="feedbackId")
    submitted_at: datetime = Field(..., serialization_alias="submittedAt")
    action_meta: ActionMeta = Field(..., serialization_alias="actionMeta")

    model_config = ConfigDict(populate_by_name=True)
