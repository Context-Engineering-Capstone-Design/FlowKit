"""사이드 채팅 트리 라우터 (0820_08 A2, A3)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter

from app.deps import CurrentUser, DbSession
from app.models import ChatKind
from app.routers import chat as chat_router
from app.schemas.chat import (
    BranchMeta,
    ChatMeta,
    CreateSideChatRequest,
    CreateSideChatResponse,
    ImportBlocksRequest,
    ImportBlocksResponse,
    MessageBlockOut,
    SideChatSummary,
    SideChatTreeResponse,
)
from app.schemas.notification import ActionMeta
from app.services import branch_service, chat_service, side_chat_service

router = APIRouter(prefix="/api/chats", tags=["SideChat"])


@router.post(
    "/{chat_id}/branches/{branch_id}/side-chats",
    response_model=CreateSideChatResponse,
    status_code=201,
)
def create_side_chat(
    chat_id: uuid.UUID,
    branch_id: uuid.UUID,
    payload: CreateSideChatRequest,
    user: CurrentUser,
    db: DbSession,
) -> CreateSideChatResponse:
    """0820_08 A1, A3: 메인·사이드 채팅 어디에서든 자식 사이드 채팅을 만든다."""
    parent_chat = chat_service.get_owned_chat(db, user, chat_id)
    parent_branch = branch_service.get_branch_in_chat(db, parent_chat, branch_id)
    chat, main_branch = chat_service.create_side_chat(
        db,
        user,
        parent_chat,
        parent_branch,
        payload.anchor_message_block_id,
        payload.title,
    )
    return CreateSideChatResponse(
        chat_meta=ChatMeta.of(chat),
        branch_meta=BranchMeta.of(main_branch),
        message_blocks=[],
        branch_list=chat_router._branch_list(db, chat, main_branch.id),
        action_meta=ActionMeta(
            action_type="side_chat_create",
            success_code="SIDE_CHAT_CREATED",
            message="사이드 채팅을 만들었습니다.",
            affected_resource_id=chat.id,
        ),
    )


@router.get("/{chat_id}/side-chats", response_model=list[SideChatSummary])
def list_side_chats(
    chat_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> list[SideChatSummary]:
    """0820_08 A2: chat_id 바로 아래의 자식 사이드 채팅 목록."""
    chat = chat_service.get_owned_chat(db, user, chat_id)
    return [
        SideChatSummary.of(c) for c in chat_service.list_side_chat_children(db, chat)
    ]


@router.get("/{chat_id}/side-chat-tree", response_model=SideChatTreeResponse)
def get_side_chat_tree(
    chat_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> SideChatTreeResponse:
    """0820_08 A2, B3: 루트 메인 채팅 아래 전체 사이드 채팅 트리를 평탄화해 돌려준다.

    좌측 관리 패널은 각 노드의 parentChatId 를 따라가며 Git 브랜치 그래프처럼 그린다.
    """
    chat = chat_service.get_owned_chat(db, user, chat_id)
    if chat.kind is ChatKind.MAIN:
        root = chat
    elif chat.root_chat_id is not None:
        root = chat_service.get_owned_chat(db, user, chat.root_chat_id)
    else:
        root = None

    if root is None:
        return SideChatTreeResponse(root_chat_id=None, chats=[])

    descendants = chat_service.list_side_chat_tree(db, root)
    return SideChatTreeResponse(
        root_chat_id=root.id,
        chats=[SideChatSummary.of(root)]
        + [SideChatSummary.of(c) for c in descendants],
    )


@router.post(
    "/{chat_id}/branches/{branch_id}/import-blocks",
    response_model=ImportBlocksResponse,
    status_code=201,
)
def import_blocks(
    chat_id: uuid.UUID,
    branch_id: uuid.UUID,
    payload: ImportBlocksRequest,
    user: CurrentUser,
    db: DbSession,
) -> ImportBlocksResponse:
    """0820_08 C2: 같은 사이드 채팅 트리에 속한 메시지를 이 브랜치로 복사해 가져온다."""
    chat = chat_service.get_owned_chat(db, user, chat_id)
    branch = branch_service.get_branch_in_chat(db, chat, branch_id)
    created = side_chat_service.import_blocks_as_messages(
        db, chat, branch, payload.block_ids
    )
    return ImportBlocksResponse(
        imported_blocks=[MessageBlockOut.of(b) for b in created],
        action_meta=ActionMeta(
            action_type="side_chat_import_blocks",
            success_code="SIDE_CHAT_BLOCKS_IMPORTED",
            message="선택한 메시지를 가져왔습니다.",
            affected_resource_id=chat.id,
        ),
    )
