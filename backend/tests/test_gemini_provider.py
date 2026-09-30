"""Tests for the Gemini provider and its configuration.

Gemini's request shape differs from the OpenAI-style one in ways that fail
quietly rather than loudly -- a system prompt sent as a message is ignored, not
rejected -- so the shape itself is asserted here rather than only the happy
path.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from app.ai.provider import (
    AIProviderError,
    GeminiProvider,
    get_provider,
)
from app.config import Settings


def _client(handler: Any) -> Any:
    """Patches httpx.AsyncClient so no request leaves the machine."""

    class FakeClient:
        def __init__(self, *_: Any, **__: Any) -> None:
            pass

        async def __aenter__(self) -> "FakeClient":
            return self

        async def __aexit__(self, *_: Any) -> None:
            return None

        async def post(self, url: str, json: dict, headers: dict) -> httpx.Response:
            return handler(url, json, headers)

    return FakeClient


def _ok(text: str) -> httpx.Response:
    return httpx.Response(
        200,
        json={"candidates": [{"content": {"parts": [{"text": text}]}}]},
        request=httpx.Request("POST", "https://example.invalid"),
    )


class TestRequestShape:
    @pytest.mark.asyncio
    async def test_system_prompt_is_not_sent_as_a_message(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Gemini ignores a role:"system" message instead of erroring.

        Sent that way the model simply never sees its instructions, which
        looks like a bad model rather than a bad request.
        """
        seen: dict[str, Any] = {}

        def handler(url: str, payload: dict, headers: dict) -> httpx.Response:
            seen.update(payload)
            return _ok("hi")

        monkeypatch.setattr(httpx, "AsyncClient", _client(handler))
        provider = GeminiProvider("k", "gemini-2.0-flash", 10.0)
        await provider.complete("BE HELPFUL", [{"role": "user", "content": "q"}], max_tokens=64)

        assert seen["systemInstruction"]["parts"][0]["text"] == "BE HELPFUL"
        roles = [c["role"] for c in seen["contents"]]
        assert "system" not in roles

    @pytest.mark.asyncio
    async def test_assistant_role_is_renamed_to_model(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        seen: dict[str, Any] = {}

        def handler(url: str, payload: dict, headers: dict) -> httpx.Response:
            seen.update(payload)
            return _ok("hi")

        monkeypatch.setattr(httpx, "AsyncClient", _client(handler))
        provider = GeminiProvider("k", "gemini-2.0-flash", 10.0)
        await provider.complete(
            "s",
            [
                {"role": "user", "content": "one"},
                {"role": "assistant", "content": "two"},
            ],
            max_tokens=64,
        )

        assert [c["role"] for c in seen["contents"]] == ["user", "model"]
        assert seen["contents"][0]["parts"][0]["text"] == "one"

    @pytest.mark.asyncio
    async def test_the_key_goes_in_a_header_not_the_url(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A key in the query string is logged by every proxy in the path."""
        seen: dict[str, Any] = {}

        def handler(url: str, payload: dict, headers: dict) -> httpx.Response:
            seen["url"] = url
            seen["headers"] = headers
            return _ok("hi")

        monkeypatch.setattr(httpx, "AsyncClient", _client(handler))
        provider = GeminiProvider("SECRET-KEY", "gemini-2.0-flash", 10.0)
        await provider.complete("s", [{"role": "user", "content": "q"}], max_tokens=64)

        assert "SECRET-KEY" not in seen["url"]
        assert seen["headers"]["x-goog-api-key"] == "SECRET-KEY"
        assert "gemini-2.0-flash:generateContent" in seen["url"]


class TestFailureModes:
    @pytest.mark.asyncio
    async def test_a_safety_block_raises_rather_than_returning_empty(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """No candidates means blocked. Returning "" would render as an answer."""

        def handler(url: str, payload: dict, headers: dict) -> httpx.Response:
            return httpx.Response(
                200,
                json={"candidates": [], "promptFeedback": {"blockReason": "SAFETY"}},
                request=httpx.Request("POST", "https://example.invalid"),
            )

        monkeypatch.setattr(httpx, "AsyncClient", _client(handler))
        provider = GeminiProvider("k", "m", 10.0)

        with pytest.raises(AIProviderError, match="SAFETY"):
            await provider.complete("s", [{"role": "user", "content": "q"}], max_tokens=64)

    @pytest.mark.asyncio
    async def test_a_truncated_response_names_the_finish_reason(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def handler(url: str, payload: dict, headers: dict) -> httpx.Response:
            return httpx.Response(
                200,
                json={"candidates": [{"content": {"parts": []}, "finishReason": "MAX_TOKENS"}]},
                request=httpx.Request("POST", "https://example.invalid"),
            )

        monkeypatch.setattr(httpx, "AsyncClient", _client(handler))
        provider = GeminiProvider("k", "m", 10.0)

        with pytest.raises(AIProviderError, match="MAX_TOKENS"):
            await provider.complete("s", [{"role": "user", "content": "q"}], max_tokens=4)

    @pytest.mark.asyncio
    async def test_an_http_error_reports_the_reason_without_the_key(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A bare "HTTP 400" is not actionable.

        Gemini returns 400 for an invalid key, an unknown model and a
        malformed request alike, and each needs a different fix -- so the
        reason has to survive, with the key scrubbed in case it is quoted back.
        """

        def handler(url: str, payload: dict, headers: dict) -> httpx.Response:
            return httpx.Response(
                400,
                json={
                    "error": {
                        "status": "INVALID_ARGUMENT",
                        "message": "API key not valid: SECRET-KEY",
                    }
                },
                request=httpx.Request("POST", "https://example.invalid"),
            )

        monkeypatch.setattr(httpx, "AsyncClient", _client(handler))
        provider = GeminiProvider("SECRET-KEY", "m", 10.0)

        with pytest.raises(AIProviderError) as caught:
            await provider.complete("s", [{"role": "user", "content": "q"}], max_tokens=64)

        message = str(caught.value)
        assert "SECRET-KEY" not in message
        assert "<redacted>" in message
        assert "INVALID_ARGUMENT" in message
        assert "400" in message

    @pytest.mark.asyncio
    async def test_a_transient_503_is_retried(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Gemini's free tier returns 503 "high demand" intermittently.

        Measured at two failures in five calls, so without a retry the
        assistant and recipes drop to their fallbacks for no reason the user
        can see.
        """
        calls = {"n": 0}

        def handler(url: str, payload: dict, headers: dict) -> httpx.Response:
            calls["n"] += 1
            if calls["n"] == 1:
                return httpx.Response(
                    503,
                    json={"error": {"status": "UNAVAILABLE", "message": "high demand"}},
                    request=httpx.Request("POST", "https://example.invalid"),
                )
            return _ok("second time lucky")

        monkeypatch.setattr(httpx, "AsyncClient", _client(handler))
        monkeypatch.setattr("app.ai.provider.RETRY_BACKOFF", (0.0, 0.0))
        provider = GeminiProvider("k", "m", 10.0)

        result = await provider.complete(
            "s", [{"role": "user", "content": "q"}], max_tokens=64
        )

        assert result == "second time lucky"
        assert calls["n"] == 2

    @pytest.mark.asyncio
    async def test_retries_are_bounded(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """A user is waiting on this request; it cannot retry indefinitely."""
        calls = {"n": 0}

        def handler(url: str, payload: dict, headers: dict) -> httpx.Response:
            calls["n"] += 1
            return httpx.Response(
                503,
                json={"error": {"status": "UNAVAILABLE", "message": "high demand"}},
                request=httpx.Request("POST", "https://example.invalid"),
            )

        monkeypatch.setattr(httpx, "AsyncClient", _client(handler))
        monkeypatch.setattr("app.ai.provider.RETRY_BACKOFF", (0.0, 0.0))
        provider = GeminiProvider("k", "m", 10.0)

        with pytest.raises(AIProviderError, match="UNAVAILABLE"):
            await provider.complete("s", [{"role": "user", "content": "q"}], max_tokens=64)

        assert calls["n"] == 3  # the first attempt plus two retries

    @pytest.mark.asyncio
    async def test_a_bad_key_is_not_retried(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Retrying a 400 wastes the user's time: the request will never work."""
        calls = {"n": 0}

        def handler(url: str, payload: dict, headers: dict) -> httpx.Response:
            calls["n"] += 1
            return httpx.Response(
                400,
                json={"error": {"status": "INVALID_ARGUMENT", "message": "bad key"}},
                request=httpx.Request("POST", "https://example.invalid"),
            )

        monkeypatch.setattr(httpx, "AsyncClient", _client(handler))
        provider = GeminiProvider("k", "m", 10.0)

        with pytest.raises(AIProviderError):
            await provider.complete("s", [{"role": "user", "content": "q"}], max_tokens=64)

        assert calls["n"] == 1

    @pytest.mark.asyncio
    async def test_an_unknown_model_is_reported_as_such(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The other common 400, and it needs a different fix from a bad key."""

        def handler(url: str, payload: dict, headers: dict) -> httpx.Response:
            return httpx.Response(
                404,
                json={
                    "error": {
                        "status": "NOT_FOUND",
                        "message": "models/gemini-9-turbo is not found",
                    }
                },
                request=httpx.Request("POST", "https://example.invalid"),
            )

        monkeypatch.setattr(httpx, "AsyncClient", _client(handler))
        provider = GeminiProvider("k", "gemini-9-turbo", 10.0)

        with pytest.raises(AIProviderError, match="is not found"):
            await provider.complete("s", [{"role": "user", "content": "q"}], max_tokens=64)

    @pytest.mark.asyncio
    async def test_json_is_parsed_out_of_a_code_fence(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Gemini wraps JSON in ```json fences more often than the others do."""
        fenced = '```json\n{"recipe_name": "Soup", "ingredients": []}\n```'

        def handler(url: str, payload: dict, headers: dict) -> httpx.Response:
            return _ok(fenced)

        monkeypatch.setattr(httpx, "AsyncClient", _client(handler))
        provider = GeminiProvider("k", "m", 10.0)

        result = await provider.complete_json(
            "s", [{"role": "user", "content": "q"}], max_tokens=256
        )

        assert result["recipe_name"] == "Soup"


class TestConfiguration:
    def test_gemini_api_key_alone_selects_gemini(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Otherwise the key is set, nothing errors, and Anthropic is called."""
        monkeypatch.delenv("LLM_PROVIDER", raising=False)
        monkeypatch.delenv("LLM_API_KEY", raising=False)
        monkeypatch.delenv("LLM_MODEL", raising=False)
        monkeypatch.setenv("GEMINI_API_KEY", "abc")

        settings = Settings()

        assert settings.llm_provider == "gemini"
        assert settings.llm_api_key == "abc"
        assert settings.llm_model.startswith("gemini")
        assert get_provider(settings).name == "gemini"

    def test_gemini_model_is_honoured(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("LLM_PROVIDER", raising=False)
        monkeypatch.delenv("LLM_MODEL", raising=False)
        monkeypatch.setenv("GEMINI_API_KEY", "abc")
        monkeypatch.setenv("GEMINI_MODEL", "gemini-2.5-pro")

        assert Settings().llm_model == "gemini-2.5-pro"

    def test_explicit_llm_vars_win(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("GEMINI_API_KEY", "gem")
        monkeypatch.setenv("LLM_PROVIDER", "openai")
        monkeypatch.setenv("LLM_API_KEY", "oai")
        monkeypatch.setenv("LLM_MODEL", "gpt-4o-mini")

        settings = Settings()

        assert settings.llm_provider == "openai"
        assert settings.llm_api_key == "oai"

    def test_no_key_means_no_provider(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """The deterministic fallback must stay reachable."""
        monkeypatch.delenv("LLM_API_KEY", raising=False)
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)

        settings = Settings()

        assert settings.llm_configured is False
        assert get_provider(settings) is None
