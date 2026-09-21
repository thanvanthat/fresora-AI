"""LLM provider abstraction.

The UI never names a provider. Everything goes through ``AIProvider``, chosen
from ``LLM_PROVIDER`` at start-up. When no key is configured, ``get_provider``
returns ``None`` and callers fall back to their deterministic path and say so in
the response -- they never fabricate a generated answer.
"""

from __future__ import annotations

import json
import logging
from abc import ABC, abstractmethod
from typing import Any

import httpx

from ..config import Settings

logger = logging.getLogger(__name__)


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


_PROVIDERS: dict[str, type[AIProvider]] = {
    "anthropic": AnthropicProvider,
    "openai": OpenAIProvider,
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
