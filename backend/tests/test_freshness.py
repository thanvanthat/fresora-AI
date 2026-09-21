"""Freshness scoring and shelf-life mapping.

Runs without OpenCV, NumPy or TensorFlow. With pytest installed::

    pytest backend/tests

Without pytest, this file is also runnable directly::

    python backend/tests/test_freshness.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.freshness import (  # noqa: E402
    FRESH_MIN,
    HIGH_RISK_SCORE_CAP,
    NEARLY_MIN,
    WEIGHTS,
    assess,
    estimate_window,
    food_family,
)
from app.knowledge.service import knowledge  # noqa: E402
from tests.stubs import declining, pristine, rotten, unmeasurable  # noqa: E402


def test_weight_rows_sum_to_one() -> None:
    """Every weight row must total 1.0, or scores drift off the 0-100 scale."""
    for family, row in WEIGHTS.items():
        total = sum(row.values())
        assert abs(total - 1.0) < 1e-9, f"{family} weights sum to {total}, not 1.0"


def test_pristine_produce_scores_fresh() -> None:
    result = assess(pristine(), "vegetable", knowledge.resolve("Tomato"))
    assert result.score >= FRESH_MIN
    assert result.status == "fresh"
    assert result.scoring_method == "opencv-heuristic-v1"


def test_declining_produce_is_not_fresh() -> None:
    result = assess(declining(), "vegetable", knowledge.resolve("Tomato"))
    assert result.status != "fresh"
    assert result.score < FRESH_MIN


def test_rotten_produce_scores_spoiled() -> None:
    result = assess(rotten(), "vegetable", knowledge.resolve("Tomato"))
    assert result.status == "spoiled"
    assert result.score < 25


def test_score_is_monotonic_in_condition() -> None:
    """Worse measurements must never produce a better score."""
    record = knowledge.resolve("Tomato")
    good = assess(pristine(), "vegetable", record).score
    mid = assess(declining(), "vegetable", record).score
    bad = assess(rotten(), "vegetable", record).score
    assert good > mid > bad


def test_banana_browning_is_penalised_less_than_apple() -> None:
    """A browning banana is ripening; a browning apple is deteriorating."""
    metrics = declining()
    banana = assess(metrics, "fruit", knowledge.resolve("Banana")).score
    apple = assess(metrics, "fruit", knowledge.resolve("Apple")).score
    assert banana > apple


def test_leafy_greens_weight_discoloration_hardest() -> None:
    assert food_family(knowledge.resolve("Spinach"), "vegetable") == "leafy"
    row = WEIGHTS["leafy"]
    assert row["discoloration"] == max(row.values())


def test_high_risk_foods_are_capped() -> None:
    """A photo must never return a reassuring score for raw chicken."""
    result = assess(pristine(), "poultry", knowledge.resolve("Chicken"))
    assert result.score == HIGH_RISK_SCORE_CAP
    assert result.capped is True
    assert result.status != "fresh"
    assert any("capped" in reason for reason in result.reasoning)


def test_dairy_is_capped_too() -> None:
    result = assess(pristine(), "dairy", knowledge.resolve("Milk"))
    assert result.score <= HIGH_RISK_SCORE_CAP
    assert result.capped is True


def test_unmeasurable_image_returns_unknown_not_a_number() -> None:
    """With nothing measured we must not invent a score."""
    result = assess(unmeasurable(), "vegetable", knowledge.resolve("Tomato"))
    assert result.status == "unknown"
    assert result.score == 0
    assert result.contributions == {}


def test_missing_signals_redistribute_weight() -> None:
    """One good signal alone should still read as fresh, not as a low score.

    If weight were not redistributed, a single measured signal would leave most
    of the 100 points unearned and a sound item would score badly.
    """
    partial = unmeasurable()
    partial.defect_coverage = 0.0
    partial.notes = []

    result = assess(partial, "vegetable", knowledge.resolve("Tomato"))
    assert result.status == "fresh"
    assert result.score >= FRESH_MIN
    assert set(result.contributions) == {"defect"}


def test_overripe_only_applies_to_ripening_foods() -> None:
    """Bread cannot be 'overripe'; it folds into nearly_spoiled."""
    metrics = declining()
    metrics.defect_coverage = 0.14
    metrics.browning_index = 0.55
    metrics.texture_uniformity = 0.35
    metrics.color_consistency = 0.4
    metrics.discoloration = 0.4

    bread = assess(metrics, "bakery", knowledge.resolve("Bread"))
    assert bread.status in {"nearly_spoiled", "spoiled"}
    assert bread.status != "overripe"


def test_reasoning_is_populated_and_ordered() -> None:
    result = assess(declining(), "vegetable", knowledge.resolve("Tomato"))
    assert result.reasoning, "every scored result needs an explanation"
    # The largest contributor should be mentioned first.
    top_signal = max(result.contributions.items(), key=lambda kv: kv[1])[0]
    descriptors = {
        "defect": "surface",
        "browning": "browning",
        "discoloration": "drifts",
        "texture": "texture",
        "colour": "consistent",
    }
    assert descriptors[top_signal] in result.reasoning[0].lower()


# --- Shelf life -----------------------------------------------------------


def test_spoiled_has_no_window() -> None:
    assert estimate_window(10, "spoiled", (3, 5)) == (0, 0)


def test_fresh_keeps_most_of_the_window() -> None:
    low, high = estimate_window(95, "fresh", (3, 5))
    assert 2 <= low <= 3
    assert 4 <= high <= 5


def test_window_shrinks_as_score_falls() -> None:
    fresh_high = estimate_window(95, "fresh", (7, 10))[1]
    poor_high = estimate_window(50, "nearly_spoiled", (7, 10))[1]
    assert poor_high < fresh_high


def test_attention_items_capped_at_two_days() -> None:
    _, high = estimate_window(60, "nearly_spoiled", (20, 30))
    assert high <= 2


def test_unknown_food_gets_cautious_window() -> None:
    """No curated figure must not become a confident number."""
    assert estimate_window(95, "fresh", None) == (2, 4)
    assert estimate_window(55, "nearly_spoiled", None) == (1, 2)


def test_min_never_exceeds_max() -> None:
    for score in range(0, 101, 5):
        for status in ("fresh", "nearly_spoiled", "overripe", "spoiled"):
            low, high = estimate_window(score, status, (1, 2))
            assert low <= high, f"{score}/{status} produced {low}>{high}"


def test_status_bands_match_the_mobile_app() -> None:
    """These thresholds are duplicated in mobile/src/constants/status.ts."""
    assert FRESH_MIN == 80
    assert NEARLY_MIN == 45


def _run() -> int:
    """Minimal runner so this file works without pytest installed."""
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
