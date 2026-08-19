from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict, Field


class ActionMeta(BaseModel):
    """화면이 작업 결과를 같은 방식으로 알릴 때 쓰는 성공 메타데이터."""

    action_type: str = Field(..., serialization_alias="actionType")
    success_code: str = Field(..., serialization_alias="successCode")
    message: str
    affected_resource_id: uuid.UUID | None = Field(
        None, serialization_alias="affectedResourceId"
    )

    model_config = ConfigDict(populate_by_name=True)
