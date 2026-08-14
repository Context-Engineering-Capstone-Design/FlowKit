from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.message import BlockResponse


class SendMessageRequest(BaseModel):
    user_prompt: str = Field(..., alias="userPrompt")
    # 비어 있으면 일반 대화처럼 이전 흐름만 참고한다.
    context_block_ids: list[uuid.UUID] = Field(
        default_factory=list, alias="contextBlockIds"
    )

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

    model_config = ConfigDict(populate_by_name=True)
