"""LLM provider abstraction.

The UI never names a provider. Everything goes through ``AIProvider``, chosen
from ``LLM_PROVIDER`` at start-up. When no key is configured, ``get_provider``
returns ``None`` and callers fall back to their deterministic path and say so in
the response -- they never fabricate a generated answer.
"""

from __future__ import annotations

import asyncio
import json
import logging
from abc import ABC, abstractmethod
from typing import Any

import httpx

from ..config import Settings

logger = logging.getLogger(__name__)

#: Statuses worth another attempt: the request was fine, the service was not.
#: 429 is rate limiting, the 5xx are transient capacity problems.
RETRYABLE_STATUSES: frozenset[int] = frozenset({429, 500, 502, 503, 504})

#: Seconds to wait before each retry. Two attempts after the first, because a
#: third rarely helps within a request a user is waiting on.
RETRY_BACKOFF: tuple[float, ...] = (0.8, 2.0)


class AIProviderError(RuntimeError):
    """A provider call failed. Surfaced to the client as a truthful error."""


class AIProvider(ABC):
    """Minimal surface: one text completion with a system prompt."""

    name: str = "abstract"

    @abstractmethod
    async def complete(
        self,
        system: str,
        messages: list[dict[str, str]],
        *,
        max_tokens: int,
        temperature: float = 0.4,
    ) -> str:
        """Return the assistant's text reply."""

    async def complete_json(
        self,
        system: str,
        messages: list[dict[str, str]],
        *,
        max_tokens: int,
        temperature: float = 0.3,
    ) -> dict[str, Any]:
        """Return a parsed JSON object from the model.

        Models sometimes wrap JSON in prose or a code fence, so the outermost
        brace-delimited span is extracted before parsing.
        """
        raw = await self.complete(
            system, messages, max_tokens=max_tokens, temperature=temperature
        )
        return _extract_json_object(raw)


def _extract_json_object(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if text.startswith("```"):
        # Strip a fenced block, with or without a language tag.
        lines = [line for line in text.splitlines() if not line.startswith("```")]
        text = "\n".join(lines).strip()

    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise AIProviderError("provider did not return a JSON object")

    try:
        parsed = json.loads(text[start : end + 1])
    except json.JSONDecodeError as exc:
        raise AIProviderError(f"provider returned invalid JSON: {exc}") from exc

    if not isinstance(parsed, dict):
        raise AIProviderError("provider returned JSON that was not an object")
    return parsed


class AnthropicProvider(AIProvider):
    name = "anthropic"

    API_URL = "https://api.anthropic.com/v1/messages"
    API_VERSION = "2023-06-01"

    def __init__(self, api_key: str, model: str, timeout: float) -> None:
        self._api_key = api_key
        self._model = model
        self._timeout = timeout

    async def complete(
        self,
        system: str,
        messages: list[dict[str, str]],
        *,
        max_tokens: int,
        temperature: float = 0.4,
    ) -> str:
        payload = {
            "model": self._model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "system": system,
            "messages": messages,
        }
        headers = {
            "x-api-key": self._api_key,
            "anthropic-version": self.API_VERSION,
            "content-type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.post(
                    self.API_URL, json=payload, headers=headers
                )
        except httpx.HTTPError as exc:
            raise AIProviderError(f"could not reach the AI provider: {exc}") from exc

        if response.status_code != 200:
            # Deliberately not echoing the body, which can carry key material.
            raise AIProviderError(
                f"AI provider returned HTTP {response.status_code}"
            )

        body = response.json()
        blocks = body.get("content") or []
        text = "".join(
            block.get("text", "") for block in blocks if block.get("type") == "text"
        )
        if not text.strip():
            raise AIProviderError("AI provider returned an empty response")
        return text


class OpenAIProvider(AIProvider):
    name = "openai"

    API_URL = "https://api.openai.com/v1/chat/completions"

    def __init__(self, api_key: str, model: str, timeout: float) -> None:
        self._api_key = api_key
        self._model = model
        self._timeout = timeout

    async def complete(
        self,
        system: str,
        messages: list[dict[str, str]],
        *,
        max_tokens: int,
        temperature: float = 0.4,
    ) -> str:
        payload = {
            "model": self._model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": [{"role": "system", "content": system}, *messages],
        }
        headers = {
            "authorization": f"Bearer {self._api_key}",
            "content-type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.post(
                    self.API_URL, json=payload, headers=headers
                )
        except httpx.HTTPError as exc:
            raise AIProviderError(f"could not reach the AI provider: {exc}") from exc

        if response.status_code != 200:
            raise AIProviderError(f"AI provider returned HTTP {response.status_code}")

        body = response.json()
        choices = body.get("choices") or []
        if not choices:
            raise AIProviderError("AI provider returned no choices")
        text = choices[0].get("message", {}).get("content", "")
        if not text.strip():
            raise AIProviderError("AI provider returned an empty response")
        return text


class GeminiProvider(AIProvider):
    """Google Gemini via the Generative Language REST API.

    Called over plain HTTP like the other two providers rather than through
    ``google-genai``. The SDK would add a dependency and ~10 MB to a serverless
    bundle that already carries OpenCV and onnxruntime, to wrap one POST. (The
    ``@google/genai`` package named in the brief is the JavaScript SDK; this
    backend is Python.)

    Gemini's request shape differs from the OpenAI-style one in three ways that
    each cause a silent failure rather than an error if missed: the system
    prompt is its own ``system_instruction`` field, not a message with
    ``role: "system"``; the assistant role is called ``model``; and message
    text lives in a ``parts`` array.
    """

    name = "gemini"

    BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"

    def __init__(self, api_key: str, model: str, timeout: float) -> None:
        self._api_key = api_key
        self._model = model
        self._timeout = timeout

    def _describe_error(self, response: httpx.Response) -> str:
        """A short, safe reason from an error response.

        Returns the status and message Google supplies -- "API_KEY_INVALID",
        "models/... is not found" -- with the key scrubbed in case a future
        message quotes it back. Falls back to a truncated body when the shape
        is unfamiliar, so an unexpected error is still visible.
        """
        try:
            error = response.json().get("error") or {}
            status = error.get("status") or ""
            message = error.get("message") or ""
            detail = f"{status}: {message}".strip(": ") or response.text[:200]
        except Exception:  # pragma: no cover - non-JSON error body
            detail = response.text[:200]

        if self._api_key:
            detail = detail.replace(self._api_key, "<redacted>")
        return detail

    async def complete(
        self,
        system: str,
        messages: list[dict[str, str]],
        *,
        max_tokens: int,
        temperature: float = 0.4,
    ) -> str:
        contents = [
            {
                # Gemini names the assistant "model"; sending "assistant" is
                # rejected, and sending "system" here is silently ignored.
                "role": "model" if message.get("role") == "assistant" else "user",
                "parts": [{"text": message.get("content", "")}],
            }
            for message in messages
        ]

        payload: dict[str, Any] = {
            "contents": contents,
            "systemInstruction": {"parts": [{"text": system}]},
            "generationConfig": {
                "maxOutputTokens": max_tokens,
                "temperature": temperature,
            },
        }

        # The key goes in a header, not the query string: a URL with the key in
        # it lands in proxy and server logs.
        headers = {
            "x-goog-api-key": self._api_key,
            "content-type": "application/json",
        }
        url = f"{self.BASE_URL}/{self._model}:generateContent"

        # Gemini's free tier returns 503 "high demand" intermittently -- two in
        # five calls, measured. Without a retry that surfaced as the assistant
        # and recipe generation silently dropping to their fallbacks for no
        # reason the user could see or act on.
        response = None
        for attempt in range(len(RETRY_BACKOFF) + 1):
            try:
                async with httpx.AsyncClient(timeout=self._timeout) as client:
                    response = await client.post(url, json=payload, headers=headers)
            except httpx.HTTPError as exc:
                raise AIProviderError(f"could not reach the AI provider: {exc}") from exc

            if response.status_code not in RETRYABLE_STATUSES:
                break

            if attempt < len(RETRY_BACKOFF):
                logger.info(
                    "Gemini returned %s; retrying in %.1fs",
                    response.status_code,
                    RETRY_BACKOFF[attempt],
                )
                await asyncio.sleep(RETRY_BACKOFF[attempt])

        assert response is not None  # the loop always assigns or raises

        if response.status_code != 200:
            # Gemini's 400 covers an invalid key, an unknown model and a
            # malformed request alike, and they need different fixes. Dropping
            # the body entirely left "HTTP 400" as the only clue, which is not
            # enough to act on -- so the reason is surfaced with the key
            # redacted, rather than the whole body discarded.
            raise AIProviderError(
                f"AI provider returned HTTP {response.status_code}: "
                f"{self._describe_error(response)}"
            )

        body = response.json()
        candidates = body.get("candidates") or []
        if not candidates:
            # No candidates usually means the prompt tripped a safety filter,
            # which is a real outcome the caller must fall back from rather
            # than an empty string presented as an answer.
            reason = (body.get("promptFeedback") or {}).get("blockReason")
            raise AIProviderError(
                f"AI provider returned no candidates (blockReason={reason})"
                if reason
                else "AI provider returned no candidates"
            )

        parts = (candidates[0].get("content") or {}).get("parts") or []
        text = "".join(part.get("text", "") for part in parts)
        if not text.strip():
            # A truncated response has no text but a MAX_TOKENS finish reason;
            # saying which makes the difference obvious in the logs.
            finish = candidates[0].get("finishReason")
            raise AIProviderError(
                f"AI provider returned an empty response (finishReason={finish})"
                if finish
                else "AI provider returned an empty response"
            )
        return text


_PROVIDERS: dict[str, type[AIProvider]] = {
    "anthropic": AnthropicProvider,
    "openai": OpenAIProvider,
    "gemini": GeminiProvider,
}


def get_provider(settings: Settings) -> AIProvider | None:
    """Build the configured provider, or None when no key is set."""
    if not settings.llm_configured:
        return None

    provider_class = _PROVIDERS.get(settings.llm_provider)
    if provider_class is None:
        logger.warning(
            "Unknown LLM_PROVIDER %r; supported: %s",
            settings.llm_provider,
            ", ".join(sorted(_PROVIDERS)),
        )
        return None

    return provider_class(  # type: ignore[call-arg]
        api_key=settings.llm_api_key,
        model=settings.llm_model,
        timeout=settings.llm_timeout_seconds,
    )
