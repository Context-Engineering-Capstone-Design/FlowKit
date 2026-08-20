"""모델 목록·선택값·API 키 처리 테스트 (AI-CORE-001~004, 006).

실제 API 를 부르지 않는다.
"""

from __future__ import annotations

import pytest

from modeling import llm
from modeling.llm import MissingApiKeyError, check_connection, resolve_api_key
from modeling.models import UnsupportedModelError, available_models, resolve_model


@pytest.fixture(autouse=True)
def clear_key(monkeypatch):
    """예비 키와 환경변수를 비운 상태에서 시작한다.

    앞 테스트가 넣어 둔 키가 남아 있으면 '키 없음'을 검증할 수 없다.
    """
    monkeypatch.setattr(llm, "_fallback_api_key", None)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)


# ── 모델 목록과 선택값 ──────────────────────────────────────────────────────


def test_model_list_has_exactly_one_default():
    """기본 모델이 없거나 둘이면 선택값 없이 들어온 요청을 처리할 수 없다."""
    defaults = [m for m in available_models() if m.is_default]
    assert len(defaults) == 1


def test_resolve_model_without_selection_uses_default():
    assert resolve_model(None).is_default
    assert resolve_model("  ").is_default


def test_resolve_model_rejects_unknown_model():
    """모르는 모델을 조용히 기본 모델로 바꾸면 사용자가 속는다."""
    with pytest.raises(UnsupportedModelError):
        resolve_model("gpt-9")


def test_resolve_model_returns_selected_model():
    picked = available_models()[0]
    assert resolve_model(picked.model_id).model_id == picked.model_id


# ── API 키 ─────────────────────────────────────────────────────────────────


def test_request_key_is_used_first():
    llm.configure("예비키")
    assert resolve_api_key("사용자키") == "사용자키"


def test_falls_back_to_configured_key():
    llm.configure("예비키")
    assert resolve_api_key(None) == "예비키"


def test_missing_key_raises():
    with pytest.raises(MissingApiKeyError):
        resolve_api_key(None)


def test_blank_key_is_treated_as_missing():
    with pytest.raises(MissingApiKeyError):
        resolve_api_key("   ")


def test_client_cache_separates_key_and_options(monkeypatch):
    """키·모델·검색 옵션이 다르면 서로 다른 클라이언트여야 한다 (AI-CORE-003).

    모델 이름만 기준으로 재사용하면 한 사용자의 키가 다른 사용자 요청에 쓰이고,
    검색을 켠 클라이언트가 검색을 끈 요청에도 쓰인다.
    """
    built: list[tuple] = []

    class FakeClient:
        def __init__(self, **kwargs):
            built.append((kwargs.get("api_key"), kwargs.get("model")))

        def bind_tools(self, tools, tool_choice=None):
            tag = "forced" if tool_choice is not None else "search"
            built[-1] = built[-1] + (tag,)
            return self

    fake_module = type("M", (), {"ChatOpenAI": FakeClient})
    monkeypatch.setitem(__import__("sys").modules, "langchain_openai", fake_module)
    llm.get_chat_model.cache_clear()

    model_id = resolve_model(None).model_id
    llm.get_chat_model("키A", model_id, "off")
    llm.get_chat_model("키A", model_id, "off")  # 같은 조합이라 새로 만들지 않는다
    llm.get_chat_model("키B", model_id, "off")
    llm.get_chat_model("키A", model_id, "auto")

    assert len(built) == 3
    assert ("키A", model_id) in built
    assert ("키B", model_id) in built
    assert ("키A", model_id, "search") in built

    # always는 도구를 붙이고 tool_choice로 반드시 쓰도록 강제한다.
    llm.get_chat_model("키A", model_id, "always")
    assert len(built) == 4
    assert built[-1] == ("키A", model_id, "forced")

    llm.get_chat_model.cache_clear()


def test_off_mode_does_not_attach_search_tool(monkeypatch):
    """웹 검색을 끄면 도구를 붙이지 않아 모델이 검색을 쓸 수 없다 (AI-SEARCH-001)."""
    built: list[tuple] = []

    class FakeClient:
        def __init__(self, **kwargs):
            built.append(())

        def bind_tools(self, tools, tool_choice=None):
            built[-1] = built[-1] + ("bound",)
            return self

    fake_module = type("M", (), {"ChatOpenAI": FakeClient})
    monkeypatch.setitem(__import__("sys").modules, "langchain_openai", fake_module)
    llm.get_chat_model.cache_clear()

    llm.get_chat_model("키", resolve_model(None).model_id, "off")

    assert built == [()]
    llm.get_chat_model.cache_clear()


def test_client_uses_requested_reasoning_effort(monkeypatch):
    """선택한 추론 단계가 Responses API 요청 설정으로 전달돼야 한다."""
    configs: list[dict] = []

    class FakeClient:
        def __init__(self, **kwargs):
            configs.append(kwargs)

        def bind_tools(self, _tools):
            return self

    fake_module = type("M", (), {"ChatOpenAI": FakeClient})
    monkeypatch.setitem(__import__("sys").modules, "langchain_openai", fake_module)
    llm.get_chat_model.cache_clear()

    llm.get_chat_model("키", resolve_model(None).model_id, reasoning_effort="high")

    assert configs[0]["reasoning"] == {"effort": "high"}
    llm.get_chat_model.cache_clear()


# ── 연결 확인 ───────────────────────────────────────────────────────────────


def test_connection_check_without_key_returns_failure():
    """연결 확인은 실패도 결과값으로 돌려준다 (AI-CORE-006)."""
    result = check_connection(None)
    assert result.success is False
    assert result.reason


def test_connection_check_reports_provider_failure(monkeypatch):
    class FailingClient:
        def __init__(self, **kwargs):
            pass

        def invoke(self, _):
            raise RuntimeError("잘못된 키입니다\n요청 상세 정보")

    fake_module = type("M", (), {"ChatOpenAI": FailingClient})
    monkeypatch.setitem(__import__("sys").modules, "langchain_openai", fake_module)

    result = check_connection("키")
    assert result.success is False
    assert "잘못된 키입니다" in result.reason
    assert "\n" not in result.reason  # 배너에 그대로 넣을 수 있어야 한다


def test_connection_check_succeeds(monkeypatch):
    class OkClient:
        def __init__(self, **kwargs):
            pass

        def invoke(self, _):
            return "pong"

    fake_module = type("M", (), {"ChatOpenAI": OkClient})
    monkeypatch.setitem(__import__("sys").modules, "langchain_openai", fake_module)

    result = check_connection("키")
    assert result.success is True
    assert result.reason is None
