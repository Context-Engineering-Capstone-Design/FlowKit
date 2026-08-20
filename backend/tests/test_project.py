from __future__ import annotations

import uuid

from app.models import Chat, ProjectLibraryResource
from app.routers import auth as auth_router
from app.services.google_auth import GoogleUser


def _auth(client, monkeypatch):
    monkeypatch.setattr(auth_router, "verify_google_id_token", lambda _token: GoogleUser("project-user", "project@example.com", "Project 사용자", None))
    token = client.post("/api/auth/google", json={"idToken": "dummy"}).json()["accessToken"]
    return {"Authorization": f"Bearer {token}"}


def test_project_moves_whole_side_chat_tree_and_preserves_them_when_deleted(client, db_session, monkeypatch):
    auth_headers = _auth(client, monkeypatch)
    created = client.post("/api/projects", json={"name": "졸업 작품", "instructions": "한국어로 답해"}, headers=auth_headers)
    assert created.status_code == 201
    project_id = created.json()["projectId"]
    main = client.post("/api/chats", headers=auth_headers).json()
    chat_id, branch_id = main["chatMeta"]["chatId"], main["branchMeta"]["branchId"]
    side = client.post(f"/api/chats/{chat_id}/branches/{branch_id}/side-chats", json={}, headers=auth_headers)
    assert side.status_code == 201
    side_id = side.json()["chatMeta"]["chatId"]
    moved = client.patch(f"/api/projects/chats/{chat_id}", json={"projectId": project_id}, headers=auth_headers)
    assert moved.status_code == 200
    assert db_session.get(Chat, uuid.UUID(chat_id)).project_id == uuid.UUID(project_id)
    assert db_session.get(Chat, uuid.UUID(side_id)).project_id == uuid.UUID(project_id)
    memory = client.post(f"/api/projects/{project_id}/memories", json={"content": "용어: 프로젝트"}, headers=auth_headers)
    assert memory.status_code == 201
    resource = client.post(f"/api/projects/{project_id}/library-resources", json={"title": "기획", "content": "선택해서만 전달"}, headers=auth_headers)
    assert resource.status_code == 201
    assert client.delete(f"/api/projects/{project_id}", headers=auth_headers).json()["deleteSuccess"] is True
    assert db_session.get(Chat, uuid.UUID(chat_id)).project_id is None
    assert db_session.get(Chat, uuid.UUID(side_id)).project_id is None
    assert db_session.get(ProjectLibraryResource, uuid.UUID(resource.json()["resourceId"])) is None


def test_can_create_chat_inside_project(client, db_session, monkeypatch):
    auth_headers = _auth(client, monkeypatch)
    project_id = client.post("/api/projects", json={"name": "폴더"}, headers=auth_headers).json()["projectId"]
    created = client.post("/api/chats", json={"projectId": project_id}, headers=auth_headers)
    assert created.status_code == 201
    assert created.json()["chatMeta"]["projectId"] == project_id
    assert db_session.get(Chat, uuid.UUID(created.json()["chatMeta"]["chatId"])).project_id == uuid.UUID(project_id)


def test_project_data_only_enters_ai_snapshot_when_chat_belongs_and_resource_selected(client, db_session, monkeypatch):
    auth_headers = _auth(client, monkeypatch)
    from app.services import ai_response_service
    from app.models import AiResponseJob
    from modeling.types import AnswerChunk, AnswerResult
    monkeypatch.setattr(ai_response_service, "run_jobs_synchronously", True)
    import modeling
    monkeypatch.setattr(modeling, "generate_answer_stream", lambda *_args, **_kwargs: iter([AnswerChunk(type="done", result=AnswerResult(text="답변"))]))
    assert client.put("/api/settings/api-keys/openai", json={"apiKey": "test-api-key-1234567890"}, headers=auth_headers).status_code == 200
    project_id = client.post("/api/projects", json={"name": "P", "instructions": "프로젝트 지침"}, headers=auth_headers).json()["projectId"]
    client.post(f"/api/projects/{project_id}/memories", json={"content": "프로젝트 메모"}, headers=auth_headers)
    resource_id = client.post(f"/api/projects/{project_id}/library-resources", json={"title": "R", "content": "선택 자료"}, headers=auth_headers).json()["resourceId"]
    chat = client.post("/api/chats", headers=auth_headers).json()
    chat_id, branch_id = chat["chatMeta"]["chatId"], chat["branchMeta"]["branchId"]
    client.patch(f"/api/projects/chats/{chat_id}", json={"projectId": project_id}, headers=auth_headers)
    response = client.post(f"/api/chats/{chat_id}/branches/{branch_id}/messages", json={"userPrompt": "질문", "libraryResourceIds": [resource_id]}, headers=auth_headers)
    assert response.status_code == 201
    job = db_session.query(AiResponseJob).one()
    assert job.input_snapshot["projectInstructions"] == "프로젝트 지침"
    assert job.input_snapshot["projectMemories"] == ["프로젝트 메모"]
    assert job.input_snapshot["selectedLibraryResources"][0]["content"] == "선택 자료"
