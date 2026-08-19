from __future__ import annotations
import uuid
from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field
class FeedbackRequest(BaseModel):
    feedback_type: str = Field(..., alias="feedbackType")
    content: str
    context_info: dict | None = Field(None, alias="contextInfo")
    model_config = ConfigDict(populate_by_name=True)
class FeedbackResponse(BaseModel):
    feedback_id: uuid.UUID = Field(..., serialization_alias="feedbackId")
    submitted_at: datetime = Field(..., serialization_alias="submittedAt")
    model_config = ConfigDict(populate_by_name=True)
