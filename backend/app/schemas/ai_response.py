from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.input_assist import SearchSourceOut
from app.schemas.message import BlockResponse
from app.schemas.notification import ActionMeta


class RegenerateResponse(BlockResponse):
    search_sources: list[SearchSourceOut] = Field(..., serialization_alias="searchSources")
    ai_response_job_id: uuid.UUID = Field(..., serialization_alias="aiResponseJobId")
    job_status: str = Field(..., serialization_alias="jobStatus")
    action_meta: ActionMeta = Field(..., serialization_alias="actionMeta")

    model_config = ConfigDict(populate_by_name=True)
