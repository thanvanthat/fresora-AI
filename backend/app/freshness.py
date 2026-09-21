"""Freshness scoring: measured surface features -> a 0-100 score and a status.

WHAT THIS IS
------------
A documented, deterministic mapping from the OpenCV measurements in
``app/vision/metrics.py`` to a single freshness score. It is a transparent
heuristic over real measurements, not a trained spoilage classifier, and the API
labels it as such (``scoring_method`` in the response).

It exists because no trained freshness model ships with this repository. When
one is supplied via ``MODEL_PATH`` with freshness labels, its probabilities
should take over as the primary signal and this formula becomes a cross-check.

THE FORMULA
-----------
Start from a perfect 100 and subtract a weighted penalty for each measured
defect signal::

    penalty = W_defect  * defect_coverage
            + W_brown   * browning_index   * browning_penalty(food)
            + W_discolor* discoloration
            + W_texture * (1 - texture_uniformity)
            + W_colour  * (1 - color_consistency)

    score   = round(100 * (1 - clamp(penalty, 0, 1)))

Each input is already normalised to 0..1 by the measurement stage, so each
weight is the maximum number of points that signal can cost, and the weights sum
to 1.0 (i.e. 100 points).

Weights are per food family, because the same pixel evidence means different
things for different foods:

- ``produce``  balanced; dark spots and browning dominate.
- ``leafy``    discoloration (yellowing) weighted hardest; wilting shows as
               texture irregularity.
- ``protein``  browning and discoloration weighted hardest, and the score is
               capped (see below).
- ``bakery``   surface defects (mould) dominate; browning is mostly crust.
- ``dairy``    visual signal is weakest of all, so the score is capped hardest.

MISSING MEASUREMENTS
--------------------
If a measurement could not be taken, its weight is redistributed across the
signals that *were* measured, so the score stays on a 0-100 scale rather than
being silently inflated by an unmeasurable term. The response reports which
signals contributed.

CAPS FOR HIGH-RISK FOODS
------------------------
For meat, poultry, seafood and dairy, a photograph genuinely cannot establish
freshness -- pathogen growth is invisible. For those foods the score is capped
at ``HIGH_RISK_SCORE_CAP`` so the app never shows a reassuring 95/100 for raw
chicken, and the status can never be better than ``nearly_spoiled``. The UI
pairs this with a prompt to check smell and the printed date.

STATUS BANDS
------------
Mirrored in the mobile app at ``src/constants/status.ts``::

    80..100 fresh
    45..79  nearly_spoiled
    25..44  overripe
    0..24   spoiled

``overripe`` is only ever returned for foods that actually have a ripening
stage (fruit and fruit-like vegetables). For everything else that band folds
into ``nearly_spoiled``, so the app never invents a ripeness concept for bread
or milk.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from .knowledge.food_data import FoodRecord

if TYPE_CHECKING:  # pragma: no cover
    # Import for typing only: this module deliberately does not pull in OpenCV
    # or NumPy, so the scoring logic stays importable (and unit-testable)
    # without the vision stack installed.
    from .vision.metrics import SurfaceMetrics

# --- Weights --------------------------------------------------------------

#: Signal -> maximum points it can subtract, per food family. Each row sums to 1.
WEIGHTS: dict[str, dict[str, float]] = {
    "produce": {
        "defect": 0.34,
        "browning": 0.24,
        "discoloration": 0.16,
        "texture": 0.16,
        "colour": 0.10,
    },
    "leafy": {
        "defect": 0.24,
        "browning": 0.20,
        "discoloration": 0.30,
        "texture": 0.18,
        "colour": 0.08,
    },
    "protein": {
        "defect": 0.22,
        "browning": 0.30,
        "discoloration": 0.28,
        "texture": 0.12,
        "colour": 0.08,
    },
    "bakery": {
        "defect": 0.46,
        "browning": 0.14,
        "discoloration": 0.20,
        "texture": 0.12,
        "colour": 0.08,
    },
    "dairy": {
        "defect": 0.42,
        "browning": 0.18,
        "discoloration": 0.22,
        "texture": 0.08,
        "colour": 0.10,
    },
}

#: Foods whose family is 'leafy' regardless of their category.
LEAFY_FOODS: frozenset[str] = frozenset(
    {"spinach", "cabbage", "broccoli", "cauliflower", "lettuce", "kale", "coriander"}
)

#: Categories where a photo cannot establish freshness.
HIGH_RISK_CATEGORIES: frozenset[str] = frozenset(
    {"meat", "poultry", "seafood", "dairy"}
)

#: Highest score a high-risk food may receive from visual analysis alone.
HIGH_RISK_SCORE_CAP = 72

#: Foods that genuinely have a ripening stage, so 'overripe' is meaningful.
RIPENING_CATEGORIES: frozenset[str] = frozenset({"fruit", "vegetable"})

# --- Status bands ---------------------------------------------------------

FRESH_MIN = 80
NEARLY_MIN = 45
OVERRIPE_MIN = 25


@dataclass
class FreshnessAssessment:
    score: int
    status: str
    #: Which signals actually contributed, with the points each cost.
    contributions: dict[str, float] = field(default_factory=dict)
    #: Plain-language reasons, shown under "Why this result?".
    reasoning: list[str] = field(default_factory=list)
    #: 'opencv-heuristic-v1' or 'model:<version>' once a trained model is wired.
    scoring_method: str = "opencv-heuristic-v1"
    #: True when the high-risk cap was applied.
    capped: bool = False


def food_family(record: FoodRecord | None, category: str) -> str:
    """Pick the weight row for this food."""
    if record is not None and record.name.lower() in LEAFY_FOODS:
        return "leafy"
    if category in {"meat", "poultry", "seafood"}:
        return "protein"
    if category == "dairy":
        return "dairy"
    if category == "bakery":
        return "bakery"
    return "produce"


def _status_for_score(score: int, category: str) -> str:
    if score >= FRESH_MIN:
        return "fresh"
    if score >= NEARLY_MIN:
        return "nearly_spoiled"
    if score >= OVERRIPE_MIN:
        # Only foods that ripen can be 'overripe'; others stay 'nearly_spoiled'.
        return "overripe" if category in RIPENING_CATEGORIES else "nearly_spoiled"
    return "spoiled"


def assess(
    metrics: SurfaceMetrics,
    category: str,
    record: FoodRecord | None = None,
) -> FreshnessAssessment:
    """Score a set of surface measurements."""
    family = food_family(record, category)
    weights = WEIGHTS[family]
    browning_penalty = record.browning_penalty if record is not None else 1.0

    # Each entry is (weight key, normalised 0..1 defect magnitude).
    signals: list[tuple[str, float]] = []

    if metrics.defect_coverage is not None:
        # Defect coverage saturates well below 100% of the surface: a third of
        # the surface visibly decayed is already a total loss.
        signals.append(("defect", min(metrics.defect_coverage / 0.33, 1.0)))

    if metrics.browning_index is not None:
        signals.append(("browning", min(metrics.browning_index * browning_penalty, 1.0)))

    if metrics.discoloration is not None:
        signals.append(("discoloration", min(metrics.discoloration / 0.5, 1.0)))

    if metrics.texture_uniformity is not None:
        signals.append(("texture", 1.0 - metrics.texture_uniformity))

    if metrics.color_consistency is not None:
        signals.append(("colour", 1.0 - metrics.color_consistency))

    if not signals:
        # Nothing measurable. Say so rather than returning a made-up score.
        return FreshnessAssessment(
            score=0,
            status="unknown",
            reasoning=[
                "No surface measurements could be taken from this image, so no "
                "freshness score was calculated."
            ],
        )

    # Redistribute the weight of any signal we could not measure.
    available_weight = sum(weights[key] for key, _ in signals)
    scale = 1.0 / available_weight if available_weight > 0 else 0.0

    contributions: dict[str, float] = {}
    penalty = 0.0
    for key, magnitude in signals:
        points = weights[key] * scale * magnitude
        contributions[key] = round(points * 100, 1)
        penalty += points

    penalty = max(0.0, min(penalty, 1.0))
    score = int(round(100 * (1.0 - penalty)))

    capped = False
    if category in HIGH_RISK_CATEGORIES and score > HIGH_RISK_SCORE_CAP:
        score = HIGH_RISK_SCORE_CAP
        capped = True

    status = _status_for_score(score, category)

    return FreshnessAssessment(
        score=score,
        status=status,
        contributions=contributions,
        reasoning=_build_reasoning(metrics, contributions, capped, category),
        capped=capped,
    )


def _build_reasoning(
    metrics: SurfaceMetrics,
    contributions: dict[str, float],
    capped: bool,
    category: str,
) -> list[str]:
    """Plain-language explanation, ordered by how much each signal cost."""
    reasons: list[str] = []

    descriptions = {
        "defect": lambda: (
            f"About {metrics.defect_coverage:.0%} of the visible surface is markedly "
            f"darker than the rest, which reads as spots or decay."
        ),
        "browning": lambda: (
            f"The surface browning index measured {metrics.browning_index:.2f} "
            f"on a 0-1 scale."
        ),
        "discoloration": lambda: (
            f"Surface colour drifts {metrics.discoloration:.2f} (0-1) away from the "
            f"even tone expected for this food."
        ),
        "texture": lambda: (
            f"Surface texture is {metrics.texture_uniformity:.0%} uniform; "
            f"lower uniformity suggests softening or an irregular surface."
        ),
        "colour": lambda: (
            f"Colour is {metrics.color_consistency:.0%} consistent across the surface."
        ),
    }

    ranked = sorted(contributions.items(), key=lambda kv: kv[1], reverse=True)
    for key, points in ranked:
        if key not in descriptions:
            continue
        detail = descriptions[key]()
        reasons.append(f"{detail} ({points:.0f} points)")

    if capped:
        reasons.append(
            f"Because this is a {category} item, the score is capped at "
            f"{HIGH_RISK_SCORE_CAP}: a photograph cannot establish freshness for "
            f"this category. Check smell, texture and the printed date."
        )

    reasons.extend(metrics.notes)
    return reasons


# --- Shelf-life estimation ------------------------------------------------


def estimate_window(
    score: int,
    status: str,
    typical: tuple[int, int] | None,
) -> tuple[int, int]:
    """Scale a typical shelf-life window by the assessed condition.

    ``typical`` is the curated (min, max) days for a sound example in the chosen
    storage mode. A score of 100 keeps the full window; lower scores shrink it
    proportionally. Spoiled items return (0, 0).

    Without curated data for the food we return a deliberately narrow, cautious
    window rather than inventing a confident number.
    """
    if status == "spoiled":
        return (0, 0)

    if typical is None:
        # No curated figure. Give the shortest useful hint and let the UI mark
        # it as a rough estimate.
        return (1, 2) if score < FRESH_MIN else (2, 4)

    low, high = typical

    # Map the score onto the fraction of the window that remains. 100 -> 1.0,
    # at the fresh threshold -> ~0.55, at the spoiled threshold -> ~0.1.
    fraction = max(0.08, min(1.0, (score / 100.0) ** 1.6))

    min_days = max(0, int(round(low * fraction)))
    max_days = max(min_days, int(round(high * fraction)))

    if status in {"nearly_spoiled", "overripe"}:
        # Never promise more than a couple of days for something already
        # flagged as needing attention.
        max_days = min(max_days, 2)
        min_days = min(min_days, max_days)

    return (min_days, max_days)
