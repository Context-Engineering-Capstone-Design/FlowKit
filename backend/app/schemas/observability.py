from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

ClientErrorType = Literal[
    "window_error",
    "unhandled_rejection",
    "react_render_error",
    "api_response_error",
]
LimitedContextText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
]
ClientErrorMessage = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2_000)
]


class ClientErrorContext(BaseModel):
    """오류 원문 대신 화면과 리소스 식별 정보만 받는다."""

    page: LimitedContextText | None = None
    feature: LimitedContextText | None = None
    chat_id: LimitedContextText | None = Field(None, alias="chatId")
    branch_id: LimitedContextText | None = Field(None, alias="branchId")
    resource_id: LimitedContextText | None = Field(None, alias="resourceId")

    model_config = ConfigDict(populate_by_name=True, extra="ignore")


class ClientErrorRequest(BaseModel):
    client_error_type: ClientErrorType = Field(..., alias="clientErrorType")
    message: ClientErrorMessage
    page_context: ClientErrorContext | None = Field(None, alias="pageContext")

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class ClientErrorResponse(BaseModel):
    log_id: uuid.UUID = Field(..., serialization_alias="logId")
    received_at: datetime = Field(..., serialization_alias="receivedAt")

    model_config = ConfigDict(populate_by_name=True)
