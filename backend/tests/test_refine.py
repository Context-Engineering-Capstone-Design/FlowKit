"""블록별 정제 테스트 (2.6 블록별 정제).

AI 호출은 가짜로 대체하고, 정제 결과가 올바른 블록에 반영되는지와 버전 이력이
보존되는지를 검증한다.
"""

from __future__ import annotations

import pytest

from app.routers import auth as auth_router
from app.services.google_auth import GoogleUser

USER = GoogleUser("sub-refine", "refine@example.com", "정제테스터", None)


@pytest.fixture
def auth(client, monkeypatch) -> dict:
    monkeypatch.setattr(auth_router, "verify_google_id_token", lambda _t: USER)
    res = client.post("/api/auth/google", json={"idToken": "dummy"})
    headers = {"Authorization": f"Bearer {res.json()['accessToken']}"}
    saved = client.put(
        "/api/settings/api-keys/openai",
        json={"apiKey": "test-api-key-1234567890"},
        headers=headers,
    )
    assert saved.status_code == 200, saved.text
    return headers


@pytest.fixture
def fake_ai(monkeypatch):
    """원문 앞에 표식을 붙여 돌려주는 가짜 AI."""
    import modeling
    from modeling.types import RefineResult

    def _refine(targets, instruction, **_kwargs):
        return [
            RefineResult(block_id=t.block_id, refined_content=f"[정제] {t.content}")
            for t in targets
        ]

    monkeypatch.setattr(modeling, "refine_blocks", _refine)
    return _refine


@pytest.fixture
def chat(client, auth) -> dict:
    return client.post("/api/chats", headers=auth).json()


@pytest.fixture
def blocks(client, auth, chat) -> list[dict]:
    url = f"/api/chats/{chat['chatMeta']['chatId']}/branches/{chat['branchMeta']['branchId']}/blocks"
    out = []
    for i in range(3):
        res = client.post(
            url,
            json={"role": "user" if i % 2 == 0 else "assistant", "content": f"원본{i}"},
            headers=auth,
        )
        out.append(res.json())
    return out


def jobs_url(chat: dict) -> str:
    return (
        f"/api/chats/{chat['chatMeta']['chatId']}"
        f"/branches/{chat['branchMeta']['branchId']}/refine-jobs"
    )


def run_refine(client, auth, chat, blocks, instruction="핵심만 요약해줘") -> dict:
    res = client.post(
        jobs_url(chat),
        json={
            "selectedBlockIds": [b["blockId"] for b in blocks],
            "instructionText": instruction,
        },
        headers=auth,
    )
    assert res.status_code == 201, res.text
    return res.json()


# ── BE-REFINE-001~003: 실행과 결과 저장 ───────────────────────────────────


def test_refine_creates_one_pending_result_per_block(
    client, auth, chat, blocks, fake_ai
):
    job = run_refine(client, auth, chat, blocks)

    assert job["status"] == "completed"
    assert len(job["results"]) == len(blocks)
    assert {r["status"] for r in job["results"]} == {"pending"}
    assert job["actionMeta"] == {
        "actionType": "refine_run",
        "successCode": "REFINE_COMPLETED",
        "message": "선택한 메시지의 정제 결과를 만들었습니다.",
        "affectedResourceId": job["refineJobId"],
    }


def test_each_result_matches_its_own_block(client, auth, chat, blocks, fake_ai):
    """결과가 밀리면 사용자가 승인한 것과 다른 내용이 반영된다."""
    job = run_refine(client, auth, chat, blocks)

    by_block = {r["blockId"]: r for r in job["results"]}
    for block in blocks:
        result = by_block[block["blockId"]]
        assert result["baseContent"] == block["content"]
        assert result["refinedContent"] == f"[정제] {block['content']}"


def test_results_keep_original_order(client, auth, chat, blocks, fake_ai):
    job = run_refine(client, auth, chat, list(reversed(blocks)))
    assert [r["orderIndex"] for r in job["results"]] == [0, 1, 2]


def test_refine_does_not_change_original_until_approved(
    client, auth, chat, blocks, fake_ai
):
    run_refine(client, auth, chat, blocks)

    detail = client.get(f"/api/chats/{chat['chatMeta']['chatId']}", headers=auth)
    assert [b["content"] for b in detail.json()["messageBlocks"]] == [
        "원본0",
        "원본1",
        "원본2",
    ]


@pytest.mark.parametrize("instruction", ["", "   "])
def test_refine_requires_instruction(client, auth, chat, blocks, fake_ai, instruction):
    res = client.post(
        jobs_url(chat),
        json={
            "selectedBlockIds": [blocks[0]["blockId"]],
            "instructionText": instruction,
        },
        headers=auth,
    )
    assert res.status_code == 400
    assert res.json()["errorCode"] == "VALIDATION_ERROR"


def test_refine_requires_selection(client, auth, chat, fake_ai):
    res = client.post(
        jobs_url(chat),
        json={"selectedBlockIds": [], "instructionText": "요약"},
        headers=auth,
    )
    assert res.status_code == 400


def test_refine_rejects_block_outside_branch(client, auth, chat, blocks, fake_ai):
    res = client.post(
        jobs_url(chat),
        json={
            "selectedBlockIds": ["00000000-0000-0000-0000-000000000000"],
            "instructionText": "요약",
        },
        headers=auth,
    )
    assert res.status_code == 400
    assert res.json()["errorCode"] == "VALIDATION_ERROR"


def test_refine_rejects_inherited_block(client, auth, chat, blocks, fake_ai):
    """A3: 하위 브랜치가 이어받은(조상 브랜치 소유) 블록은 정제 대상에서 뺀다 (BE-REFINE-005, BE-MSG-004)."""
    chat_id = chat["chatMeta"]["chatId"]
    branch_res = client.post(
        f"/api/chats/{chat_id}/branches",
        json={
            "branchName": "하위 브랜치",
            "baseBranchId": chat["branchMeta"]["branchId"],
            "baseMessageBlockId": blocks[-1]["blockId"],
            "contextBlockIds": [],
        },
        headers=auth,
    )
    assert branch_res.status_code == 201, branch_res.text
    new_branch_id = branch_res.json()["branchId"]

    url = f"/api/chats/{chat_id}/branches/{new_branch_id}/refine-jobs"
    res = client.post(
        url,
        json={"selectedBlockIds": [blocks[0]["blockId"]], "instructionText": "요약"},
        headers=auth,
    )
    assert res.status_code == 400, res.text
    assert res.json()["errorCode"] == "VALIDATION_ERROR"

    # 원본(Main) 브랜치의 내용은 그대로 남아 있어야 한다
    detail = client.get(f"/api/chats/{chat_id}", headers=auth)
    assert detail.json()["messageBlocks"][0]["content"] == "원본0"


def test_ai_failure_marks_job_failed(client, auth, chat, blocks, monkeypatch):
    import modeling

    def _boom(targets, instruction, **_kwargs):
        raise RuntimeError("모델 호출 실패")

    monkeypatch.setattr(modeling, "refine_blocks", _boom)

    res = client.post(
        jobs_url(chat),
        json={"selectedBlockIds": [blocks[0]["blockId"]], "instructionText": "요약"},
        headers=auth,
    )
    assert res.status_code == 502
    assert res.json()["errorCode"] == "AI_REFINE_FAILED"


def test_mismatched_ai_result_is_rejected(client, auth, chat, blocks, monkeypatch):
    """블록 하나가 빠진 응답을 그대로 저장하면 엉뚱한 곳에 반영된다."""
    import modeling
    from modeling.types import RefineResult

    def _partial(targets, instruction, **_kwargs):
        return [
            RefineResult(block_id=targets[0].block_id, refined_content="일부만")
        ]

    monkeypatch.setattr(modeling, "refine_blocks", _partial)

    res = client.post(
        jobs_url(chat),
        json={
            "selectedBlockIds": [b["blockId"] for b in blocks],
            "instructionText": "요약",
        },
        headers=auth,
    )
    assert res.status_code == 502


# ── BE-REFINE-005: 승인 ───────────────────────────────────────────────────


def test_approve_applies_refined_content_and_keeps_history(
    client, auth, chat, blocks, fake_ai
):
    """승인은 새 버전을 쌓고 원본은 이력에 남긴다 (REQ-041, REQ-042)."""
    job = run_refine(client, auth, chat, blocks)
    target = job["results"][0]

    approved = client.post(
        f"{jobs_url(chat)}/{job['refineJobId']}/results/{target['resultId']}/approve",
        headers=auth,
    ).json()

    assert approved["status"] == "approved"
    assert approved["approvedVersionId"]
    assert approved["actionMeta"]["successCode"] == "REFINE_RESULT_APPROVED"

    detail = client.get(f"/api/chats/{chat['chatMeta']['chatId']}", headers=auth)
    contents = [b["content"] for b in detail.json()["messageBlocks"]]
    assert contents == ["[정제] 원본0", "원본1", "원본2"]

    block_url = (
        f"/api/chats/{chat['chatMeta']['chatId']}"
        f"/branches/{chat['branchMeta']['branchId']}/blocks/{target['blockId']}"
    )
    versions = client.get(f"{block_url}/versions", headers=auth).json()
    assert [v["content"] for v in versions] == ["원본0", "[정제] 원본0"]
    assert versions[-1]["sourceType"] == "ai_refine"


def test_approved_result_can_be_rolled_back_by_version(
    client, auth, chat, blocks, fake_ai
):
    """승인 취소 UI 대신 버전 이동으로 되돌린다 (REQ-034)."""
    job = run_refine(client, auth, chat, blocks)
    target = job["results"][0]
    client.post(
        f"{jobs_url(chat)}/{job['refineJobId']}/results/{target['resultId']}/approve",
        headers=auth,
    )

    block_url = (
        f"/api/chats/{chat['chatMeta']['chatId']}"
        f"/branches/{chat['branchMeta']['branchId']}/blocks/{target['blockId']}"
    )
    versions = client.get(f"{block_url}/versions", headers=auth).json()
    restored = client.patch(
        f"{block_url}/version",
        json={"targetVersionId": versions[0]["versionId"]},
        headers=auth,
    ).json()

    assert restored["content"] == "원본0"


def test_double_approve_is_rejected(client, auth, chat, blocks, fake_ai):
    job = run_refine(client, auth, chat, blocks)
    target = job["results"][0]
    url = f"{jobs_url(chat)}/{job['refineJobId']}/results/{target['resultId']}/approve"

    assert client.post(url, headers=auth).status_code == 200
    res = client.post(url, headers=auth)
    assert res.status_code == 409
    assert res.json()["errorCode"] == "REFINE_RESULT_NOT_PENDING"


# ── BE-REFINE-006: 거절 ───────────────────────────────────────────────────


def test_reject_leaves_original_untouched(client, auth, chat, blocks, fake_ai):
    job = run_refine(client, auth, chat, blocks)
    target = job["results"][0]

    rejected = client.post(
        f"{jobs_url(chat)}/{job['refineJobId']}/results/{target['resultId']}/reject",
        headers=auth,
    ).json()

    assert rejected["status"] == "rejected"
    assert rejected["approvedVersionId"] is None
    assert rejected["actionMeta"]["successCode"] == "REFINE_RESULT_REJECTED"

    detail = client.get(f"/api/chats/{chat['chatMeta']['chatId']}", headers=auth)
    assert detail.json()["messageBlocks"][0]["content"] == "원본0"


def test_rejected_result_cannot_be_approved(client, auth, chat, blocks, fake_ai):
    job = run_refine(client, auth, chat, blocks)
    target = job["results"][0]
    base = f"{jobs_url(chat)}/{job['refineJobId']}/results/{target['resultId']}"

    client.post(f"{base}/reject", headers=auth)
    assert client.post(f"{base}/approve", headers=auth).status_code == 409


# ── BE-REFINE-007, 008: 일괄 처리 ─────────────────────────────────────────


def test_approve_all_applies_every_pending_result(client, auth, chat, blocks, fake_ai):
    job = run_refine(client, auth, chat, blocks)

    res = client.post(
        f"{jobs_url(chat)}/{job['refineJobId']}/approve-all", headers=auth
    ).json()

    assert len(res["processed"]) == 3
    assert res["failed"] == []
    assert res["actionMeta"] == {
        "actionType": "bulk_refine_approve",
        "successCode": "SUCCESS",
        "message": "3개 정제 결과를 반영했습니다.",
        "affectedResourceId": job["refineJobId"],
    }

    detail = client.get(f"/api/chats/{chat['chatMeta']['chatId']}", headers=auth)
    assert [b["content"] for b in detail.json()["messageBlocks"]] == [
        "[정제] 원본0",
        "[정제] 원본1",
        "[정제] 원본2",
    ]


def test_approve_all_skips_already_decided(client, auth, chat, blocks, fake_ai):
    job = run_refine(client, auth, chat, blocks)
    first = job["results"][0]
    client.post(
        f"{jobs_url(chat)}/{job['refineJobId']}/results/{first['resultId']}/reject",
        headers=auth,
    )

    res = client.post(
        f"{jobs_url(chat)}/{job['refineJobId']}/approve-all", headers=auth
    ).json()

    assert len(res["processed"]) == 2
    detail = client.get(f"/api/chats/{chat['chatMeta']['chatId']}", headers=auth)
    assert detail.json()["messageBlocks"][0]["content"] == "원본0"


def test_reject_all_changes_nothing_in_conversation(client, auth, chat, blocks, fake_ai):
    job = run_refine(client, auth, chat, blocks)

    res = client.post(
        f"{jobs_url(chat)}/{job['refineJobId']}/reject-all", headers=auth
    ).json()

    assert len(res["processed"]) == 3
    assert res["actionMeta"]["actionType"] == "bulk_refine_reject"
    assert res["actionMeta"]["successCode"] == "SUCCESS"
    detail = client.get(f"/api/chats/{chat['chatMeta']['chatId']}", headers=auth)
    assert [b["content"] for b in detail.json()["messageBlocks"]] == [
        "원본0",
        "원본1",
        "원본2",
    ]


def test_approve_all_returns_safe_formal_failure_and_continues(
    client, auth, chat, blocks, fake_ai, monkeypatch
):
    from app.services import refine_service

    job = run_refine(client, auth, chat, blocks)
    failed_id = job["results"][0]["resultId"]
    original_approve = refine_service.approve

    def fail_one(db, current_chat, branch, result):
        if str(result.id) == failed_id:
            raise RuntimeError("Bearer internal-secret user@example.com")
        return original_approve(db, current_chat, branch, result)

    monkeypatch.setattr(refine_service, "approve", fail_one)
    response = client.post(
        f"{jobs_url(chat)}/{job['refineJobId']}/approve-all", headers=auth
    )

    assert response.status_code == 200
    body = response.json()
    assert len(body["processed"]) == 2
    assert body["failed"] == [
        {
            "resourceId": failed_id,
            "errorCode": "REFINE_ITEM_FAILED",
            "message": "항목을 승인하지 못했습니다.",
            "resultId": failed_id,
            "reason": "항목을 승인하지 못했습니다.",
        }
    ]
    assert body["actionMeta"] == {
        "actionType": "bulk_refine_approve",
        "successCode": "PARTIAL_SUCCESS",
        "message": "3개 중 2개를 처리했습니다.",
        "affectedResourceId": job["refineJobId"],
    }
    assert "internal-secret" not in response.text


# ── BE-REFINE-010: 미승인 정리 ────────────────────────────────────────────


def test_cleanup_marks_pending_as_rejected(client, auth, chat, blocks, fake_ai):
    """패널을 닫으면 남은 대기 항목은 확정 거절된다 (REQ-043)."""
    job = run_refine(client, auth, chat, blocks)
    client.post(
        f"{jobs_url(chat)}/{job['refineJobId']}/results/{job['results'][0]['resultId']}/approve",
        headers=auth,
    )

    res = client.post(
        f"{jobs_url(chat)}/{job['refineJobId']}/cleanup", headers=auth
    ).json()
    assert res["cleanedCount"] == 2
    assert res["actionMeta"] == {
        "actionType": "refine_cleanup",
        "successCode": "REFINE_CLEANED_UP",
        "message": "2개 미승인 결과를 정리했습니다.",
        "affectedResourceId": job["refineJobId"],
    }

    after = client.get(f"{jobs_url(chat)}/{job['refineJobId']}", headers=auth).json()
    statuses = sorted(r["status"] for r in after["results"])
    assert statuses == ["approved", "rejected", "rejected"]


def test_cleanup_does_not_undo_approved(client, auth, chat, blocks, fake_ai):
    job = run_refine(client, auth, chat, blocks)
    client.post(f"{jobs_url(chat)}/{job['refineJobId']}/approve-all", headers=auth)

    res = client.post(
        f"{jobs_url(chat)}/{job['refineJobId']}/cleanup", headers=auth
    ).json()
    assert res["cleanedCount"] == 0

    detail = client.get(f"/api/chats/{chat['chatMeta']['chatId']}", headers=auth)
    assert detail.json()["messageBlocks"][0]["content"] == "[정제] 원본0"


# ── BE-REFINE-011: 권한 ───────────────────────────────────────────────────


def test_job_from_other_chat_is_not_found(client, auth, chat, blocks, fake_ai):
    job = run_refine(client, auth, chat, blocks)
    other = client.post("/api/chats", headers=auth).json()

    res = client.get(
        f"/api/chats/{other['chatMeta']['chatId']}"
        f"/branches/{other['branchMeta']['branchId']}"
        f"/refine-jobs/{job['refineJobId']}",
        headers=auth,
    )
    assert res.status_code == 404
    assert res.json()["errorCode"] == "REFINE_JOB_NOT_FOUND"


def test_other_user_cannot_refine(client, auth, chat, blocks, fake_ai, monkeypatch):
    other = GoogleUser("sub-x", "x@example.com", "다른사람", None)
    monkeypatch.setattr(auth_router, "verify_google_id_token", lambda _t: other)
    token = client.post("/api/auth/google", json={"idToken": "x"}).json()["accessToken"]

    res = client.post(
        jobs_url(chat),
        json={"selectedBlockIds": [blocks[0]["blockId"]], "instructionText": "요약"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 403
