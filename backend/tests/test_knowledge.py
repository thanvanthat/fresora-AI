"""The food knowledge layer. Pure stdlib -- runs with no extra dependencies."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.knowledge.food_data import ALL_FOODS, FOOD_INDEX  # noqa: E402
from app.knowledge.service import FoodKnowledgeService, knowledge  # noqa: E402

VALID_CATEGORIES = {
    "fruit",
    "vegetable",
    "meat",
    "poultry",
    "seafood",
    "dairy",
    "bakery",
    "other",
}
VALID_STORAGE = {"pantry", "refrigerated", "frozen", "counter"}


def test_every_record_is_well_formed() -> None:
    for record in ALL_FOODS:
        assert record.name, "a food record has no name"
        assert record.category in VALID_CATEGORIES, f"{record.name}: bad category"
        assert (
            record.preferred_storage in VALID_STORAGE
        ), f"{record.name}: bad preferred_storage"
        assert record.storage_headline, f"{record.name}: no storage headline"
        assert record.storage_details, f"{record.name}: no storage details"
        assert record.nutrition, f"{record.name}: no nutrition text"
        assert 0.0 <= record.browning_penalty <= 2.0, f"{record.name}: odd penalty"


def test_preferred_storage_always_has_a_shelf_life_figure() -> None:
    """A food must have a curated window for the mode we tell people to use."""
    for record in ALL_FOODS:
        window = record.shelf_life.for_storage(record.preferred_storage)
        assert window is not None, (
            f"{record.name} prefers {record.preferred_storage} but has no "
            f"shelf-life figure for it"
        )
        low, high = window
        assert 0 < low <= high, f"{record.name}: invalid window {window}"


def test_healthy_hue_ranges_are_valid() -> None:
    """Hues must sit in OpenCV's 0-179 range, or discoloration is nonsense."""
    for record in ALL_FOODS:
        if record.healthy_hue is None:
            continue
        low, high = record.healthy_hue
        assert 0 <= low <= 179, f"{record.name}: hue low {low} out of range"
        assert 0 <= high <= 179, f"{record.name}: hue high {high} out of range"


def test_no_duplicate_names() -> None:
    names = [record.name for record in ALL_FOODS]
    assert len(names) == len(set(names)), "duplicate food name in ALL_FOODS"


def test_aliases_resolve() -> None:
    assert knowledge.resolve("Eggplant") is not None
    assert knowledge.resolve("Eggplant").name == "Brinjal"
    assert knowledge.resolve("Bell pepper").name == "Capsicum"


def test_resolve_is_case_insensitive() -> None:
    assert knowledge.resolve("TOMATO").name == "Tomato"
    assert knowledge.resolve("  spinach  ").name == "Spinach"


def test_resolve_handles_plurals() -> None:
    assert knowledge.resolve("tomatoes").name == "Tomato"
    assert knowledge.resolve("bananas").name == "Banana"


def test_resolve_rejects_unknown_food() -> None:
    assert knowledge.resolve("dragonfruit") is None
    assert knowledge.resolve("") is None


def test_short_queries_do_not_substring_match() -> None:
    """A 3-character query must not latch onto a long name by accident."""
    service = FoodKnowledgeService({"pomegranate": FOOD_INDEX["pomegranate"]})
    assert service.resolve("gra") is None


def test_shelf_life_falls_back_to_preferred_storage() -> None:
    """Asking for a mode with no figure returns the preferred mode's window."""
    # Cucumber has only a refrigerated figure on file.
    frozen = knowledge.get_typical_shelf_life("Cucumber", "frozen")
    preferred = knowledge.get_typical_shelf_life("Cucumber", "refrigerated")
    assert frozen == preferred


def test_high_risk_flags_the_right_categories() -> None:
    assert knowledge.is_high_risk("Chicken") is True
    assert knowledge.is_high_risk("Fish") is True
    assert knowledge.is_high_risk("Milk") is True
    assert knowledge.is_high_risk("Tomato") is False
    assert knowledge.is_high_risk("Bread") is False


def test_prompt_block_contains_curated_facts_only() -> None:
    block = knowledge.describe_for_prompt("Spinach")
    assert block is not None
    assert "Spinach" in block
    assert "Typical shelf life" in block
    assert "refrigerated" in block
    # The curated storage line must be present verbatim for grounding.
    assert "Refrigerate dry, loosely wrapped" in block


def test_prompt_block_is_none_for_unknown_food() -> None:
    """The LLM must be told we have no data, not handed a blank template."""
    assert knowledge.describe_for_prompt("dragonfruit") is None


def test_high_risk_note_reaches_the_prompt() -> None:
    block = knowledge.describe_for_prompt("Chicken")
    assert block is not None
    assert "higher-risk" in block


def test_known_names_covers_the_requested_foods() -> None:
    """Foods named in the product brief must all be present."""
    required = {
        "Apple",
        "Banana",
        "Orange",
        "Mango",
        "Guava",
        "Pear",
        "Strawberry",
        "Avocado",
        "Tomato",
        "Carrot",
        "Potato",
        "Onion",
        "Spinach",
        "Broccoli",
        "Capsicum",
        "Brinjal",
        "Cucumber",
        "Chicken",
        "Fish",
        "Beef",
        "Milk",
        "Cheese",
        "Yogurt",
        "Bread",
        "Pastry",
    }
    missing = required - set(knowledge.known_names())
    assert not missing, f"missing reference data for: {sorted(missing)}"


def test_pantry_staples_are_returned_as_a_copy() -> None:
    """Callers must not be able to mutate the shared staple list."""
    first = knowledge.pantry_staples()
    first.append("Gold leaf")
    assert "Gold leaf" not in knowledge.pantry_staples()


def _run() -> int:
    failures = 0
    for name, fn in sorted(globals().items()):
        if not name.startswith("test_") or not callable(fn):
            continue
        try:
            fn()
        except AssertionError as exc:
            failures += 1
            print(f"FAIL {name}: {exc}")
        except Exception as exc:  # noqa: BLE001
            failures += 1
            print(f"ERROR {name}: {type(exc).__name__}: {exc}")
        else:
            print(f"ok   {name}")
    print("\n" + ("all passed" if failures == 0 else f"{failures} failed"))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(_run())
