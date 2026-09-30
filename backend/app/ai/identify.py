"""Name a food from a photograph using the configured vision model.

MobileNetV2 knows ImageNet's 1000 classes, of which roughly thirty are food and
almost all of them Western -- its only apple class is a Granny Smith on a plain
background. YOLOX knows COCO's eighty, of which ten are food. Between them they
cannot name a drumstick, a bitter gourd, an idli, a jackfruit or a curry leaf,
and neither has any class for food that has gone off: mould on bread reads as
``rotisserie``, a pile of windfall apples reads as ``park_bench``. That is why
a scan of real food from a real kitchen so often came back "Unidentified item".

A vision model has no fixed class list, so it answers for any cuisine and for
food in any condition. It is asked to do exactly one thing -- NAME what is in
the frame -- and nothing else:

* It never scores freshness. The score stays with the measured OpenCV features
  in ``app/vision/metrics.py`` and ``app/freshness.py``, which are reproducible
  and do not vary between calls.
* It never authors storage advice or shelf-life figures. Those stay in the
  curated ``app/knowledge/food_data.py``; a food the model names but the
  knowledge base has never heard of is reported with generic advice and said to
  be generic, which is what ``/analyze`` already does for any unknown name.
* It never judges safety. No prompt here asks whether food is safe to eat, and
  the safety notice is attached to every response regardless.

Returns ``None`` -- never a guess -- when no provider is configured, when the
provider has no vision support, when the call fails, or when the model is not
confident. Every caller falls back to asking the user to name the food.
"""

from __future__ import annotations

import logging

from ..config import get_settings
from ..schemas import FOOD_CATEGORIES
from .provider import AIProviderError, _extract_json_object, get_provider

logger = logging.getLogger(__name__)

#: Below this the model is guessing, and "Unidentified item" is the more useful
#: answer because it puts the food picker in front of the user.
MIN_CONFIDENCE = 0.55

#: A scan is interactive. The provider default of 45s is for the assistant,
#: where a user has asked a question and expects to wait; here it would leave
#: someone staring at a spinner long after they would have typed the name.
TIMEOUT_SECONDS = 12.0

_SYSTEM = (
    "You identify food in photographs for a kitchen inventory app. "
    "You name what you see and nothing more. "
    "You never state or imply whether food is safe to eat, never estimate how "
    "long it will keep, and never give storage advice -- other parts of the "
    "system do that from measured image features and a curated database. "
    "Name the food by its common English name, including foods from any world "
    "cuisine: Indian, Chinese, Middle Eastern, African, Latin American, "
    "European and others are all in scope. "
    "Identify the food even when it is mouldy, bruised, wilted, rotting or "
    "cooked -- a spoiled tomato is still a tomato. "
    "Answer with JSON only."
)

_PROMPT = (
    "What food is in this photograph?\n\n"
    "Reply with a JSON object and nothing else:\n"
    '{"is_food": true|false, '
    '"food_name": "common English name, singular, e.g. Tomato, Bitter gourd, '
    'Idli, Chapati", '
    '"category": one of ' + ", ".join(sorted(FOOD_CATEGORIES)) + ", "
    '"confidence": 0.0-1.0, '
    '"multiple": true if several different foods are in frame}\n\n'
    "Set is_food to false for anything that is not food. "
    "Set confidence honestly: below 0.5 if you are unsure which food it is."
)


class VisionIdentification:
    """What the vision model saw. Name only -- no score, no advice."""

    __slots__ = ("food_name", "category", "confidence", "multiple")

    def __init__(
        self, food_name: str, category: str, confidence: float, multiple: bool
    ) -> None:
        self.food_name = food_name
        self.category = category
        self.confidence = confidence
        self.multiple = multiple

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return (
            f"VisionIdentification({self.food_name!r}, {self.category!r}, "
            f"{self.confidence:.2f}, multiple={self.multiple})"
        )


async def identify_food(image: bytes, *, mime_type: str = "image/jpeg"):
    """Name the food in ``image``, or None when that cannot be done honestly."""
    settings = get_settings()
    provider = get_provider(settings)
    if provider is None:
        return None

    try:
        raw = await provider.complete_vision(
            _SYSTEM, _PROMPT, image, mime_type=mime_type, max_tokens=200
        )
        parsed = _extract_json_object(raw)
    except AIProviderError as exc:
        # A scan must never fail because the vision model was unreachable or
        # out of quota. The classifier's answer, or the food picker, stands.
        logger.info("Vision identification unavailable: %s", exc)
        return None
    except Exception:  # pragma: no cover - defensive
        logger.exception("Vision identification failed")
        return None

    if not parsed.get("is_food"):
        return None

    name = str(parsed.get("food_name") or "").strip()
    if not name:
        return None

    try:
        confidence = float(parsed.get("confidence", 0.0))
    except (TypeError, ValueError):
        confidence = 0.0
    if confidence < MIN_CONFIDENCE:
        return None

    category = str(parsed.get("category") or "").strip().lower()
    if category not in FOOD_CATEGORIES:
        category = "other"

    return VisionIdentification(
        food_name=name,
        category=category,
        confidence=min(confidence, 1.0),
        multiple=bool(parsed.get("multiple")),
    )
