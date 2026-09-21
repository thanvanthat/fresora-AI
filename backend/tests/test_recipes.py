"""Recipe generation, and above all the spoiled-food exclusion rule.

Needs pydantic (``pip install -r backend/requirements.txt``). Run with::

    pytest backend/tests/test_recipes.py
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

pytest.importorskip("pydantic", reason="backend requirements not installed")

from app.ai.provider import AIProvider, AIProviderError  # noqa: E402
from app.ai.recipes import (  # noqa: E402
    RECIPE_TEMPLATES,
    USABLE_STATUSES,
    generate_recipe,
    generate_with_rules,
)
from app.schemas import RecipeInventoryItem, RecipeRequest  # noqa: E402


def item(
    item_id: str,
    name: str,
    status: str = "fresh",
    days: int | None = None,
    category: str = "vegetable",
) -> RecipeInventoryItem:
    return RecipeInventoryItem(
        id=item_id,
        food_name=name,
        category=category,  # type: ignore[arg-type]
        status=status,  # type: ignore[arg-type]
        estimated_remaining_days=days,
    )


def request_for(*items: RecipeInventoryItem, **kwargs) -> RecipeRequest:
    return RecipeRequest(inventory=list(items), **kwargs)


# --- The safety rule ------------------------------------------------------


def test_spoiled_status_is_not_usable() -> None:
    assert "spoiled" not in USABLE_STATUSES


def test_spoiled_items_never_appear_in_a_recipe() -> None:
    result = generate_with_rules(
        request_for(
            item("1", "Tomato", "nearly_spoiled", 1),
            item("2", "Spinach", "spoiled"),
            item("3", "Bread", "fresh", category="bakery"),
        )
    )

    names = {ing.ingredient_name.lower() for ing in result.ingredients}
    assert "spinach" not in names
    assert "2" in result.excluded_item_ids
    assert "2" not in result.rescued_item_ids


def test_exclusion_is_reported_to_the_user() -> None:
    result = generate_with_rules(
        request_for(
            item("1", "Tomato", "fresh"),
            item("2", "Onion", "spoiled"),
        )
    )
    assert result.excluded_item_ids == ["2"]
    assert result.note is not None
    assert "spoiled" in result.note.lower()


def test_all_spoiled_inventory_produces_no_recipe() -> None:
    result = generate_with_rules(
        request_for(
            item("1", "Tomato", "spoiled"),
            item("2", "Spinach", "spoiled"),
        )
    )
    assert result.ingredients == []
    assert sorted(result.excluded_item_ids) == ["1", "2"]


# --- Template matching ----------------------------------------------------


def test_matching_template_is_selected() -> None:
    result = generate_with_rules(
        request_for(
            item("1", "Tomato", "nearly_spoiled", 1),
            item("2", "Spinach", "nearly_spoiled", 1),
            item("3", "Bread", "fresh", category="bakery"),
        )
    )
    assert result.title == "Tomato Spinach Toast"
    assert result.source == "rules"
    assert sorted(result.rescued_item_ids) == ["1", "2"]


def test_urgent_items_are_preferred() -> None:
    """Given a choice, the recipe should rescue what is about to be lost."""
    result = generate_with_rules(
        request_for(
            item("1", "Banana", "nearly_spoiled", 1, category="fruit"),
            item("2", "Potato", "fresh", 40),
            item("3", "Onion", "fresh", 40),
        )
    )
    # Banana bread rescues the urgent item; potato sabzi rescues nothing.
    assert "1" in result.rescued_item_ids


def test_rescued_ids_only_include_attention_items() -> None:
    result = generate_with_rules(
        request_for(
            item("1", "Potato", "fresh"),
            item("2", "Onion", "fresh"),
        )
    )
    assert result.rescued_item_ids == []


def test_unmatched_combination_falls_back_to_a_general_method() -> None:
    result = generate_with_rules(request_for(item("1", "Yogurt", "fresh", category="dairy")))
    assert result.ingredients, "a fallback recipe must still list ingredients"
    assert result.instructions
    assert result.note is not None


def test_empty_inventory_is_handled_gracefully() -> None:
    result = generate_with_rules(request_for())
    assert result.ingredients == []
    assert result.instructions


def test_servings_are_respected() -> None:
    result = generate_with_rules(
        request_for(item("1", "Banana", "overripe", category="fruit"), servings=6)
    )
    assert result.servings == 6


def test_selected_ids_narrow_the_ingredient_set() -> None:
    result = generate_with_rules(
        request_for(
            item("1", "Tomato", "fresh"),
            item("2", "Spinach", "fresh"),
            item("3", "Bread", "fresh", category="bakery"),
            selected_item_ids=["1", "3"],
        )
    )
    names = {ing.inventory_item_id for ing in result.ingredients if ing.inventory_item_id}
    assert "2" not in names


def test_every_template_is_well_formed() -> None:
    for template in RECIPE_TEMPLATES:
        assert template.title
        assert template.description
        assert template.instructions, f"{template.title} has no instructions"
        assert template.prep_minutes >= 0
        assert template.cook_minutes >= 0
        assert template.requires or template.optional, (
            f"{template.title} matches nothing"
        )


# --- LLM path -------------------------------------------------------------


class FakeProvider(AIProvider):
    """Returns a canned payload, or raises, without any network call."""

    name = "fake"

    def __init__(self, payload: dict | None = None, error: str | None = None) -> None:
        self._payload = payload
        self._error = error

    async def complete(self, system, messages, *, max_tokens, temperature=0.4) -> str:
        raise NotImplementedError

    async def complete_json(self, system, messages, *, max_tokens, temperature=0.3):
        if self._error:
            raise AIProviderError(self._error)
        assert self._payload is not None
        return self._payload


def test_llm_recipe_is_accepted_when_ingredients_are_allowed() -> None:
    payload = {
        "title": "Quick Tomato Sauté",
        "description": "Uses up softening tomatoes.",
        "prep_minutes": 5,
        "cook_minutes": 10,
        "ingredients": [
            {"name": "Tomato", "quantity": "3 medium"},
            {"name": "Salt", "quantity": "to taste"},
        ],
        "instructions": ["Slice the tomatoes.", "Fry until they collapse."],
        "tips": ["Serve hot."],
    }
    result = asyncio.run(
        generate_recipe(
            request_for(item("1", "Tomato", "nearly_spoiled", 1)),
            FakeProvider(payload=payload),
        )
    )
    assert result.source == "llm"
    assert result.title == "Quick Tomato Sauté"
    assert result.rescued_item_ids == ["1"]


def test_llm_recipe_is_rejected_if_it_invents_an_ingredient() -> None:
    """A generated recipe must not require something the user does not have."""
    payload = {
        "title": "Tomato and Prawn Curry",
        "description": "Invented an ingredient.",
        "prep_minutes": 5,
        "cook_minutes": 10,
        "ingredients": [
            {"name": "Tomato", "quantity": "3"},
            {"name": "King prawns", "quantity": "200 g"},
        ],
        "instructions": ["Cook it."],
    }
    result = asyncio.run(
        generate_recipe(
            request_for(item("1", "Tomato", "fresh")),
            FakeProvider(payload=payload),
        )
    )
    assert result.source == "rules", "invented ingredient should force the fallback"
    assert result.note is not None


def test_llm_recipe_cannot_resurrect_a_spoiled_item() -> None:
    """The spoiled item was filtered out, so naming it must be rejected."""
    payload = {
        "title": "Spinach and Tomato",
        "description": "Tries to use the excluded item.",
        "prep_minutes": 5,
        "cook_minutes": 5,
        "ingredients": [
            {"name": "Tomato", "quantity": "2"},
            {"name": "Spinach", "quantity": "100 g"},
        ],
        "instructions": ["Cook it."],
    }
    result = asyncio.run(
        generate_recipe(
            request_for(
                item("1", "Tomato", "fresh"),
                item("2", "Spinach", "spoiled"),
            ),
            FakeProvider(payload=payload),
        )
    )
    assert result.source == "rules"
    names = {ing.ingredient_name.lower() for ing in result.ingredients}
    assert "spinach" not in names


def test_provider_failure_falls_back_without_raising() -> None:
    result = asyncio.run(
        generate_recipe(
            request_for(item("1", "Banana", "overripe", category="fruit")),
            FakeProvider(error="provider exploded"),
        )
    )
    assert result.source == "rules"
    assert result.note is not None


def test_no_provider_uses_rules_and_says_so() -> None:
    result = asyncio.run(
        generate_recipe(request_for(item("1", "Banana", "overripe", category="fruit")), None)
    )
    assert result.source == "rules"
    assert result.note is not None
    assert "built-in" in result.note


def test_llm_tolerates_descriptive_ingredient_names() -> None:
    """"2 ripe tomatoes" should still map back to the Tomato inventory item."""
    payload = {
        "title": "Tomato Toast",
        "description": "Descriptive naming.",
        "prep_minutes": 5,
        "cook_minutes": 5,
        "ingredients": [{"name": "ripe tomatoes", "quantity": "2"}],
        "instructions": ["Cook it."],
    }
    result = asyncio.run(
        generate_recipe(
            request_for(item("1", "Tomato", "nearly_spoiled", 1)),
            FakeProvider(payload=payload),
        )
    )
    assert result.source == "llm"
    assert result.ingredients[0].inventory_item_id == "1"
