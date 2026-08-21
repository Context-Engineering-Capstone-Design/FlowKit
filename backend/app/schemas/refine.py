from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.notification import ActionMeta


class RunRefineRequest(BaseModel):
    selected_block_ids: list[uuid.UUID] = Field(..., alias="selectedBlockIds")
    instruction_text: str = Field(..., alias="instructionText")

    model_config = ConfigDict(populate_by_name=True)


class RefineResultOut(BaseModel):
    """원본과 정제본을 함께 준다. 화면이 나란히 비교해 보여준다 ."""

    result_id: uuid.UUID = Field(..., serialization_alias="resultId")
    block_id: uuid.UUID = Field(..., serialization_alias="blockId")
    base_version_id: uuid.UUID = Field(..., serialization_alias="baseVersionId")
    base_content: str = Field(..., serialization_alias="baseContent")
    refined_content: str = Field(..., serialization_alias="refinedContent")
    status: str
    approved_version_id: uuid.UUID | None = Field(
        None, serialization_alias="approvedVersionId"
    )
    order_index: int = Field(..., serialization_alias="orderIndex")
    updated_at: datetime = Field(..., serialization_alias="updatedAt")

    model_config = ConfigDict(populate_by_name=True)


class RefineJobResponse(BaseModel):
    refine_job_id: uuid.UUID = Field(..., serialization_alias="refineJobId")
    status: str
    instruction_text: str = Field(..., serialization_alias="instructionText")
    results: list[RefineResultOut]

    model_config = ConfigDict(populate_by_name=True)


class RefineJobMutationResponse(RefineJobResponse):
    action_meta: ActionMeta = Field(..., serialization_alias="actionMeta")


class RefineResultMutationOut(RefineResultOut):
    action_meta: ActionMeta = Field(..., serialization_alias="actionMeta")


class BulkRefineFailure(BaseModel):
    """내부 예외 대신 리소스와 안전한 오류 코드·문구를 제공한다."""

    resource_id: uuid.UUID = Field(..., serialization_alias="resourceId")
    error_code: str = Field(..., serialization_alias="errorCode")
    message: str
    # 기존 화면 계약을 유지하는 호환 필드다.
    result_id: uuid.UUID = Field(..., serialization_alias="resultId")
    reason: str

    model_config = ConfigDict(populate_by_name=True)


class BulkRefineResponse(BaseModel):
    """일부만 실패할 수 있어 성공·실패를 나눠 돌려준다 ."""

    processed: list[RefineResultOut]
    failed: list[BulkRefineFailure]
    action_meta: ActionMeta = Field(..., serialization_alias="actionMeta")

    model_config = ConfigDict(populate_by_name=True)


class CleanupResponse(BaseModel):
    refine_job_id: uuid.UUID = Field(..., serialization_alias="refineJobId")
    cleaned_count: int = Field(..., serialization_alias="cleanedCount")
    action_meta: ActionMeta = Field(..., serialization_alias="actionMeta")

    model_config = ConfigDict(populate_by_name=True)
