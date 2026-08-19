from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.message import BlockResponse


class RegenerateResponse(BlockResponse):
    ai_response_job_id: uuid.UUID = Field(..., serialization_alias="aiResponseJobId")
    job_status: str = Field(..., serialization_alias="jobStatus")

    model_config = ConfigDict(populate_by_name=True)
