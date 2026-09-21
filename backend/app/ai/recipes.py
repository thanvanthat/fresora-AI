"""Zero-waste recipe generation.

Two paths, and the response always says which one ran:

``llm``
    A configured provider writes the recipe, grounded on the curated knowledge
    records for the ingredients and constrained to the ingredient list we give
    it. Its output is then validated: any ingredient it invented outside the
    allowed set is rejected and we fall back to the rules path.

``rules``
    A deterministic matcher over ``RECIPE_TEMPLATES``. Real recipes, just not
    generated. This runs when no provider is configured or a provider call
    fails, so the feature never goes dark and never fabricates.

The safety filter runs *before* either path: items assessed as ``spoiled`` are
removed from consideration entirely and reported in ``excluded_item_ids``.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from ..knowledge.service import knowledge
from ..schemas import (
    RecipeIngredientOut,
    RecipeInventoryItem,
    RecipeRequest,
    RecipeResponse,
)
from .provider import AIProvider, AIProviderError

logger = logging.getLogger(__name__)

#: Statuses a recipe may use. 'spoiled' is absent by design (rule 50).
USABLE_STATUSES: frozenset[str] = frozenset(
    {"fresh", "nearly_spoiled", "overripe", "unknown"}
)

#: Urgency ordering, most urgent first, for choosing what to rescue.
_STATUS_URGENCY: dict[str, int] = {
    "nearly_spoiled": 0,
    "overripe": 1,
    "fresh": 2,
    "unknown": 3,
}


@dataclass(frozen=True)
class RecipeTemplate:
    """A real recipe keyed on the ingredients it needs."""

    title: str
    description: str
    #: Must all be present (case-insensitive) for this template to match.
    requires: tuple[str, ...]
    #: Used if present; improves the match score but is not required.
    optional: tuple[str, ...]
    prep_minutes: int
    cook_minutes: int
    pantry: tuple[str, ...]
    instructions: tuple[str, ...]
    tips: tuple[str, ...] = ()
    #: Fewest inventory ingredients this template needs to make sense.
    #:
    #: Templates with no required ingredient (the smoothie) would otherwise
    #: match on a single optional item and produce nonsense -- "blends soft
    #: fruit" with nothing but yoghurt in the bowl.
    min_used: int = 1


RECIPE_TEMPLATES: tuple[RecipeTemplate, ...] = (
    RecipeTemplate(
        title="Tomato Spinach Toast",
        description=(
            "A fast open sandwich that uses up softening tomatoes and wilting "
            "spinach in one go."
        ),
        requires=("tomato", "spinach", "bread"),
        optional=("cheese", "onion"),
        prep_minutes=10,
        cook_minutes=8,
        pantry=("Olive oil", "Salt", "Black pepper", "Garlic"),
        instructions=(
            "Toast the bread slices until firm enough to hold a topping.",
            "Warm a little olive oil in a pan and soften the sliced garlic for 30 seconds.",
            "Add the spinach and cook until just wilted, then season and set aside.",
            "Slice the tomatoes, season them, and warm them briefly in the same pan.",
            "Pile the spinach and tomato onto the toast, add cheese if using, and serve at once.",
        ),
        tips=(
            "Softer tomatoes work better here than firm ones — they break down into the toast.",
        ),
    ),
    RecipeTemplate(
        title="Everything Vegetable Stir Fry",
        description=(
            "A flexible stir fry that clears whatever vegetables need using first."
        ),
        requires=("onion",),
        optional=(
            "carrot",
            "capsicum",
            "cabbage",
            "broccoli",
            "cauliflower",
            "mushroom",
            "cucumber",
            "spinach",
        ),
        prep_minutes=12,
        cook_minutes=10,
        pantry=("Cooking oil", "Garlic", "Ginger", "Salt", "Black pepper"),
        instructions=(
            "Cut every vegetable to a similar size so they cook evenly.",
            "Heat oil in a wide pan over the highest heat your hob will give.",
            "Fry the onion, garlic and ginger for a minute until fragrant.",
            "Add the firmest vegetables first, then the softer ones a few minutes later.",
            "Keep everything moving, season, and take it off the heat while still crisp.",
        ),
        tips=("Anything limp will soften anyway in a stir fry — this is the dish for it.",),
    ),
    RecipeTemplate(
        title="Roast Vegetable Soup",
        description=(
            "Roasting rescues vegetables past their crisp best and concentrates "
            "their flavour into a soup."
        ),
        requires=("onion",),
        optional=("carrot", "potato", "tomato", "capsicum", "cauliflower", "broccoli"),
        prep_minutes=15,
        cook_minutes=35,
        pantry=("Olive oil", "Salt", "Black pepper", "Garlic", "Cumin"),
        instructions=(
            "Heat the oven to 200 °C.",
            "Chop the vegetables into rough chunks, toss with oil, salt and cumin.",
            "Roast for 25-30 minutes until the edges catch and caramelise.",
            "Tip everything into a pot, cover with water or stock, and simmer 10 minutes.",
            "Blend until smooth, then season to taste.",
        ),
        tips=("Soup is the most forgiving destination for slightly soft vegetables.",),
    ),
    RecipeTemplate(
        title="Banana Bread Batter",
        description="The classic use for bananas that have gone too soft to eat.",
        requires=("banana",),
        optional=("milk",),
        prep_minutes=15,
        cook_minutes=50,
        pantry=("Wheat flour", "Sugar", "Salt", "Cooking oil"),
        instructions=(
            "Heat the oven to 175 °C and line a loaf tin.",
            "Mash the bananas thoroughly — the darker and softer, the better.",
            "Beat in the sugar and oil, then fold in the flour and a pinch of salt.",
            "Pour into the tin and bake 45-55 minutes, until a skewer comes out clean.",
            "Cool in the tin for 10 minutes before turning out.",
        ),
        tips=("Very ripe bananas are sweeter, so you can cut the sugar back.",),
    ),
    RecipeTemplate(
        title="Fruit Rescue Smoothie",
        description="Blends soft fruit before it turns, with no cooking at all.",
        requires=(),
        optional=("banana", "mango", "strawberry", "guava", "apple", "pear", "milk", "yogurt"),
        prep_minutes=5,
        cook_minutes=0,
        pantry=("Sugar",),
        instructions=(
            "Peel and roughly chop the fruit, discarding any bruised patches.",
            "Add it to a blender with the milk or yoghurt.",
            "Blend until smooth, adding a splash more liquid if it is too thick.",
            "Taste and sweeten only if the fruit needs it.",
        ),
        tips=("Freeze the fruit first if you want it thicker without ice.",),
        # Needs at least a fruit and a liquid, or it is not a smoothie.
        min_used=2,
    ),
    RecipeTemplate(
        title="Masala Scramble with Vegetables",
        description="A quick savoury pan dish that absorbs odds and ends.",
        requires=("onion", "tomato"),
        optional=("capsicum", "spinach", "cheese"),
        prep_minutes=8,
        cook_minutes=10,
        pantry=("Cooking oil", "Turmeric", "Chilli powder", "Salt", "Cumin"),
        instructions=(
            "Finely chop the onion and tomato.",
            "Heat oil, add cumin seeds, then the onion, and cook until translucent.",
            "Add turmeric, chilli powder and the tomato; cook until the tomato collapses.",
            "Stir in any remaining vegetables and cook until just tender.",
            "Season and serve hot with bread or rice.",
        ),
    ),
    RecipeTemplate(
        title="Bread Upma",
        description="Turns bread that is drying out into a savoury breakfast.",
        requires=("bread",),
        optional=("onion", "tomato", "capsicum", "carrot"),
        prep_minutes=10,
        cook_minutes=12,
        pantry=("Cooking oil", "Mustard seeds", "Turmeric", "Salt", "Chilli powder"),
        instructions=(
            "Cut the bread into cubes and set aside.",
            "Heat oil, crackle the mustard seeds, then fry the onion until soft.",
            "Add the other chopped vegetables with turmeric and chilli, and cook through.",
            "Fold in the bread cubes with a splash of water so they soften but hold shape.",
            "Season and serve immediately.",
        ),
        tips=("Slightly stale bread holds its shape better here than fresh.",),
    ),
    RecipeTemplate(
        title="Potato and Onion Sabzi",
        description="A dependable dish for potatoes and onions that need using.",
        requires=("potato", "onion"),
        optional=("tomato", "capsicum"),
        prep_minutes=10,
        cook_minutes=20,
        pantry=("Cooking oil", "Turmeric", "Cumin", "Chilli powder", "Salt"),
        instructions=(
            "Dice the potatoes small so they cook quickly.",
            "Heat oil, add cumin, then the sliced onion, and fry until golden.",
            "Add the potato with turmeric, chilli and salt; stir to coat.",
            "Cover and cook on low 12-15 minutes, stirring now and then, until tender.",
            "Uncover and fry a final minute to crisp the edges.",
        ),
    ),
)


def _filter_inventory(
    items: list[RecipeInventoryItem], selected_ids: list[str]
) -> tuple[list[RecipeInventoryItem], list[str]]:
    """Drop spoiled items, then narrow to an explicit selection if given."""
    excluded = [item.id for item in items if item.status not in USABLE_STATUSES]
    usable = [item for item in items if item.status in USABLE_STATUSES]

    if selected_ids:
        wanted = set(selected_ids)
        usable = [item for item in usable if item.id in wanted]

    return usable, excluded


def _score_template(
    template: RecipeTemplate, available: dict[str, RecipeInventoryItem]
) -> tuple[int, list[RecipeInventoryItem]] | None:
    """Score a template against what is available.

    Returns None when a required ingredient is missing. Otherwise the score is
    weighted to prefer recipes that consume the most *urgent* items, since the
    whole point is rescuing food that is about to be lost.
    """
    used: list[RecipeInventoryItem] = []

    for required in template.requires:
        item = available.get(required)
        if item is None:
            return None
        used.append(item)

    for optional in template.optional:
        item = available.get(optional)
        if item is not None and item not in used:
            used.append(item)

    if len(used) < max(template.min_used, 1):
        return None

    score = 0
    for item in used:
        # 10 points per ingredient used, plus an urgency bonus.
        score += 10
        urgency = _STATUS_URGENCY.get(item.status, 3)
        score += (3 - urgency) * 6
        if item.estimated_remaining_days is not None and item.estimated_remaining_days <= 1:
            score += 8

    return score, used


#: Told to the user whenever an item was dropped for being spoiled. This must
#: survive every code path -- it is a safety message, not a nicety.
EXCLUSION_NOTE = "Items assessed as spoiled were excluded from this recipe."


def _note(excluded: list[str], extra: str | None = None) -> str | None:
    """Combine the exclusion notice with any path-specific note.

    Every return site goes through this, so no branch can quietly lose the
    exclusion message while adding its own.
    """
    parts = [EXCLUSION_NOTE] if excluded else []
    if extra:
        parts.append(extra)
    return " ".join(parts) if parts else None


def _append_note(result: RecipeResponse, extra: str) -> None:
    """Add a note without discarding what is already there.

    Assigning to ``result.note`` directly is a trap: the spoiled-exclusion
    message is set inside ``generate_with_rules``, and an outer branch that
    overwrote it silently dropped a safety message.
    """
    result.note = f"{result.note} {extra}".strip() if result.note else extra


def _available_index(items: list[RecipeInventoryItem]) -> dict[str, RecipeInventoryItem]:
    """Map a normalised food key -> the most urgent matching item."""
    index: dict[str, RecipeInventoryItem] = {}
    for item in items:
        record = knowledge.resolve(item.food_name)
        key = (record.name if record else item.food_name).strip().lower()

        existing = index.get(key)
        if existing is None:
            index[key] = item
            continue

        # Keep whichever is more urgent, so a recipe rescues the right one.
        if _STATUS_URGENCY.get(item.status, 3) < _STATUS_URGENCY.get(existing.status, 3):
            index[key] = item
    return index


def generate_with_rules(request: RecipeRequest) -> RecipeResponse:
    """Deterministic recipe match. Always returns something usable."""
    usable, excluded = _filter_inventory(request.inventory, request.selected_item_ids)

    if not usable:
        return RecipeResponse(
            title="Nothing to rescue yet",
            description=(
                "No usable ingredients were available, so there is nothing to build "
                "a recipe from."
            ),
            prep_minutes=0,
            cook_minutes=0,
            servings=request.servings,
            ingredients=[],
            instructions=[
                "Scan or add food to your inventory, then generate a recipe again."
            ],
            rescued_item_ids=[],
            tips=[],
            source="rules",
            excluded_item_ids=excluded,
            note=_note(
                excluded,
                None if excluded else "Your inventory had no ingredients to work with.",
            ),
        )

    available = _available_index(usable)

    best: tuple[int, RecipeTemplate, list[RecipeInventoryItem]] | None = None
    for template in RECIPE_TEMPLATES:
        scored = _score_template(template, available)
        if scored is None:
            continue
        score, used = scored
        if best is None or score > best[0]:
            best = (score, template, used)

    if best is None:
        # No template matched. Offer the honest generic route rather than
        # pretending a specific dish exists.
        names = [item.food_name for item in usable]
        return RecipeResponse(
            title=f"Simple sauté with {names[0]}",
            description=(
                "No stored recipe matched this combination, so here is a basic "
                "method that works for most vegetables and proteins."
            ),
            prep_minutes=10,
            cook_minutes=15,
            servings=request.servings,
            ingredients=[
                RecipeIngredientOut(
                    ingredient_name=item.food_name,
                    quantity=f"{item.quantity:g} {item.unit}".strip(),
                    is_rescued=item.status in {"nearly_spoiled", "overripe"},
                    inventory_item_id=item.id,
                )
                for item in usable
            ]
            + [
                RecipeIngredientOut(ingredient_name=staple, quantity="to taste")
                for staple in ("Cooking oil", "Salt", "Black pepper")
            ],
            instructions=[
                "Cut everything to a similar size so it cooks at the same rate.",
                "Heat oil in a wide pan over medium-high heat.",
                "Add the firmest ingredients first and cook until they start to colour.",
                "Add softer ingredients and cook until just tender.",
                "Season to taste and serve hot.",
            ],
            rescued_item_ids=[
                item.id for item in usable if item.status in {"nearly_spoiled", "overripe"}
            ],
            tips=["Taste as you go — quantities here are a guide, not a rule."],
            source="rules",
            excluded_item_ids=excluded,
            note=_note(excluded, "Built from a general method, not a stored recipe."),
        )

    _, template, used = best
    ingredients = [
        RecipeIngredientOut(
            ingredient_name=item.food_name,
            quantity=f"{item.quantity:g} {item.unit}".strip(),
            is_rescued=item.status in {"nearly_spoiled", "overripe"},
            inventory_item_id=item.id,
        )
        for item in used
    ]
    ingredients += [
        RecipeIngredientOut(ingredient_name=staple, quantity="to taste")
        for staple in template.pantry
    ]

    return RecipeResponse(
        title=template.title,
        description=template.description,
        prep_minutes=template.prep_minutes,
        cook_minutes=template.cook_minutes,
        servings=request.servings,
        ingredients=ingredients,
        instructions=list(template.instructions),
        rescued_item_ids=[
            item.id for item in used if item.status in {"nearly_spoiled", "overripe"}
        ],
        tips=list(template.tips),
        source="rules",
        excluded_item_ids=excluded,
        note=_note(excluded),
    )


# --- LLM path -------------------------------------------------------------

_RECIPE_SYSTEM = """You are the recipe engine inside FreshcoAI, a food-waste app.

Write one practical home recipe that uses as many of the LISTED INGREDIENTS as
sensibly fit together. Rules you must follow:

1. Use ONLY ingredients from LISTED INGREDIENTS and ALLOWED PANTRY. Never
   introduce anything else.
2. Prefer using the ingredients marked URGENT -- rescuing those is the point.
3. It is fine to leave out a listed ingredient that genuinely does not belong in
   the dish. Do not force a bad combination.
4. Give realistic prep and cook times in whole minutes.
5. Never comment on whether food is safe to eat. Do not mention bacteria,
   pathogens or food poisoning. The app handles safety messaging itself.
6. Write instructions as complete, clear sentences a beginner can follow.

Reply with ONLY a JSON object, no prose around it:

{
  "title": "string",
  "description": "one or two sentences",
  "prep_minutes": 10,
  "cook_minutes": 15,
  "servings": 2,
  "ingredients": [{"name": "string", "quantity": "string"}],
  "instructions": ["step one", "step two"],
  "tips": ["optional tip"]
}"""


def _build_recipe_prompt(request: RecipeRequest, usable: list[RecipeInventoryItem]) -> str:
    lines: list[str] = ["LISTED INGREDIENTS:"]
    for item in usable:
        urgent = item.status in {"nearly_spoiled", "overripe"}
        days = item.estimated_remaining_days
        marker = " [URGENT]" if urgent else ""
        window = f", about {days} day(s) left" if days is not None else ""
        lines.append(
            f"- {item.food_name} ({item.quantity:g} {item.unit}, "
            f"assessed {item.status}{window}){marker}"
        )

    lines.append("")
    lines.append(f"ALLOWED PANTRY: {', '.join(knowledge.pantry_staples())}")
    lines.append("")
    lines.append(f"SERVINGS: {request.servings}")

    if request.dietary_preferences:
        lines.append(f"DIETARY REQUIREMENTS: {', '.join(request.dietary_preferences)}")

    if request.language != "en":
        lines.append(
            f"Write the title, description, instructions and tips in the language "
            f"with code '{request.language}'. Keep the JSON keys in English."
        )

    facts = [
        block
        for block in (knowledge.describe_for_prompt(item.food_name) for item in usable)
        if block
    ]
    if facts:
        lines.append("")
        lines.append("REFERENCE NOTES (use these, do not contradict them):")
        lines.extend(facts)

    return "\n".join(lines)


def _validate_llm_recipe(
    payload: dict,
    request: RecipeRequest,
    usable: list[RecipeInventoryItem],
    excluded: list[str],
) -> RecipeResponse:
    """Accept the model's recipe only if every ingredient was allowed.

    This is the guard that stops a generated recipe from quietly requiring an
    ingredient the user does not have -- or, worse, one we filtered out for
    being spoiled.
    """
    allowed: dict[str, RecipeInventoryItem] = {}
    for item in usable:
        allowed[item.food_name.strip().lower()] = item
        record = knowledge.resolve(item.food_name)
        if record is not None:
            allowed.setdefault(record.name.strip().lower(), item)

    pantry = {staple.strip().lower() for staple in knowledge.pantry_staples()}

    raw_ingredients = payload.get("ingredients")
    if not isinstance(raw_ingredients, list) or not raw_ingredients:
        raise AIProviderError("recipe had no ingredients")

    ingredients: list[RecipeIngredientOut] = []
    rescued: set[str] = set()

    for entry in raw_ingredients:
        if not isinstance(entry, dict):
            raise AIProviderError("malformed ingredient entry")
        name = str(entry.get("name", "")).strip()
        if not name:
            continue
        quantity = str(entry.get("quantity", "")).strip() or "as needed"
        key = name.lower()

        matched = allowed.get(key)
        if matched is None:
            # Tolerate "2 ripe tomatoes" style names by substring match.
            for allowed_key, item in allowed.items():
                if allowed_key in key or key in allowed_key:
                    matched = item
                    break

        if matched is not None:
            is_rescued = matched.status in {"nearly_spoiled", "overripe"}
            if is_rescued:
                rescued.add(matched.id)
            ingredients.append(
                RecipeIngredientOut(
                    ingredient_name=matched.food_name,
                    quantity=quantity,
                    is_rescued=is_rescued,
                    inventory_item_id=matched.id,
                )
            )
            continue

        if key in pantry or any(staple in key for staple in pantry):
            ingredients.append(
                RecipeIngredientOut(ingredient_name=name, quantity=quantity)
            )
            continue

        raise AIProviderError(
            f"recipe used an ingredient outside the allowed set: {name!r}"
        )

    instructions = [
        str(step).strip()
        for step in payload.get("instructions", [])
        if str(step).strip()
    ]
    if not instructions:
        raise AIProviderError("recipe had no instructions")

    title = str(payload.get("title", "")).strip() or "Zero-waste recipe"

    def _minutes(key: str, default: int) -> int:
        try:
            value = int(payload.get(key, default))
        except (TypeError, ValueError):
            return default
        return max(0, min(value, 600))

    return RecipeResponse(
        title=title,
        description=str(payload.get("description", "")).strip(),
        prep_minutes=_minutes("prep_minutes", 10),
        cook_minutes=_minutes("cook_minutes", 15),
        servings=request.servings,
        ingredients=ingredients,
        instructions=instructions,
        rescued_item_ids=sorted(rescued),
        tips=[str(tip).strip() for tip in payload.get("tips", []) if str(tip).strip()],
        source="llm",
        excluded_item_ids=excluded,
        note=_note(excluded),
    )


async def generate_recipe(
    request: RecipeRequest, provider: AIProvider | None
) -> RecipeResponse:
    """Generate a recipe, preferring the LLM and falling back to rules."""
    usable, excluded = _filter_inventory(request.inventory, request.selected_item_ids)

    if provider is None or not usable:
        result = generate_with_rules(request)
        if provider is None and usable:
            _append_note(
                result,
                "No AI provider is configured on the server, so this came from "
                "FreshcoAI's built-in recipe matcher.",
            )
        return result

    try:
        payload = await provider.complete_json(
            _RECIPE_SYSTEM,
            [{"role": "user", "content": _build_recipe_prompt(request, usable)}],
            max_tokens=1600,
        )
        return _validate_llm_recipe(payload, request, usable, excluded)
    except AIProviderError as exc:
        logger.warning("LLM recipe generation rejected, using rules: %s", exc)
        result = generate_with_rules(request)
        _append_note(
            result,
            "The AI provider's recipe could not be used, so FreshcoAI's built-in "
            "recipe matcher ran instead.",
        )
        return result
