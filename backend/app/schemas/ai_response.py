from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.message import BlockResponse
from app.schemas.notification import ActionMeta


class RegenerateResponse(BlockResponse):
    """search_sources 는 BlockResponse 가 이미 새 버전 기준으로 담고 있다."""

    ai_response_job_id: uuid.UUID = Field(..., serialization_alias="aiResponseJobId")
    job_status: str = Field(..., serialization_alias="jobStatus")
    action_meta: ActionMeta = Field(..., serialization_alias="actionMeta")

    model_config = ConfigDict(populate_by_name=True)
