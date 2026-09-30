"""The vision identification fallback: what it accepts, and what it refuses.

Every refusal path matters more than the happy path. A wrong name the user can
correct is cheap; a name invented from a low-confidence guess is what puts a
freshness score on the wrong food.
"""

from __future__ import annotations

import pytest

from app.ai import identify
from app.ai.provider import AIProviderError


class _Vision:
    """A provider that returns a canned reply to complete_vision."""

    name = "fake"

    def __init__(self, reply: str | Exception) -> None:
        self.reply = reply
        self.calls: list[bytes] = []

    async def complete_vision(self, system, prompt, image, **kwargs) -> str:
        self.calls.append(image)
        if isinstance(self.reply, Exception):
            raise self.reply
        return self.reply


@pytest.fixture
def provider(monkeypatch):
    def _install(reply):
        fake = _Vision(reply)
        monkeypatch.setattr(identify, "get_provider", lambda _settings, **_kw: fake)
        return fake

    return _install


@pytest.mark.asyncio
async def test_names_a_food_the_local_models_have_no_class_for(provider):
    provider(
        '{"is_food": true, "food_name": "Bitter gourd", "category": "vegetable",'
        ' "confidence": 0.91, "multiple": false}'
    )
    seen = await identify.identify_food(b"jpeg-bytes")
    assert seen is not None
    assert seen.food_name == "Bitter gourd"
    assert seen.category == "vegetable"
    assert seen.confidence == pytest.approx(0.91)


@pytest.mark.asyncio
async def test_reads_json_out_of_a_code_fence(provider):
    provider(
        '```json\n{"is_food": true, "food_name": "Idli", "category": "other",'
        ' "confidence": 0.8, "multiple": false}\n```'
    )
    seen = await identify.identify_food(b"x")
    assert seen is not None and seen.food_name == "Idli"


@pytest.mark.asyncio
async def test_spoiled_food_is_still_named(provider):
    """The whole point: mould must not make a tomato stop being a tomato."""
    provider(
        '{"is_food": true, "food_name": "Tomato", "category": "vegetable",'
        ' "confidence": 0.88, "multiple": false}'
    )
    seen = await identify.identify_food(b"mouldy")
    assert seen is not None and seen.food_name == "Tomato"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "reply",
    [
        # Not food at all.
        '{"is_food": false, "food_name": "Park bench", "category": "other",'
        ' "confidence": 0.99, "multiple": false}',
        # Food, but the model is guessing.
        '{"is_food": true, "food_name": "Mango", "category": "fruit",'
        ' "confidence": 0.3, "multiple": false}',
        # No name.
        '{"is_food": true, "food_name": "", "category": "fruit",'
        ' "confidence": 0.9, "multiple": false}',
        # Confidence missing entirely: absent is not "certain".
        '{"is_food": true, "food_name": "Mango", "category": "fruit"}',
        # Not JSON at all.
        "I am not sure what this is.",
    ],
)
async def test_refuses_rather_than_guesses(provider, reply):
    provider(reply)
    assert await identify.identify_food(b"x") is None


@pytest.mark.asyncio
async def test_unknown_category_falls_back_to_other(provider):
    provider(
        '{"is_food": true, "food_name": "Sambar", "category": "curry",'
        ' "confidence": 0.9, "multiple": false}'
    )
    seen = await identify.identify_food(b"x")
    assert seen is not None and seen.category == "other"


@pytest.mark.asyncio
async def test_provider_failure_never_raises(provider):
    """Out of quota, unreachable, or a provider with no vision support at all."""
    provider(AIProviderError("quota exhausted"))
    assert await identify.identify_food(b"x") is None


@pytest.mark.asyncio
async def test_no_provider_configured(monkeypatch):
    monkeypatch.setattr(identify, "get_provider", lambda _settings, **_kw: None)
    assert await identify.identify_food(b"x") is None


@pytest.mark.asyncio
async def test_several_foods_are_flagged_not_named(provider):
    """A fruit bowl must reach the multi-item path, not be scored as one food."""
    provider(
        '{"is_food": true, "food_name": "Apple", "category": "fruit",'
        ' "confidence": 0.95, "multiple": true}'
    )
    seen = await identify.identify_food(b"x")
    assert seen is not None and seen.multiple is True
