"""Turns measurements into the short read-outs shown on the analysis screen.

Every sentence here is driven by a measured value. Where a measurement is
missing the line says so, rather than describing something we did not see.

These strings are written in English on the server. The mobile app renders them
as supporting detail beneath localised labels; the localisable parts of the
screen (row titles, status names, guidance) come from the app's own dictionary.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from .freshness import FreshnessAssessment
from .knowledge.food_data import FoodRecord

if TYPE_CHECKING:  # pragma: no cover
    # Typing only -- keeps this module free of the OpenCV/NumPy import chain.
    from .vision.metrics import SurfaceMetrics

_NOT_MEASURED = "Not measured for this image."


def _colour_line(metrics: SurfaceMetrics, record: FoodRecord | None) -> str:
    consistency = metrics.color_consistency
    discoloration = metrics.discoloration

    if consistency is None and discoloration is None:
        return _NOT_MEASURED

    parts: list[str] = []
    if consistency is not None:
        if consistency >= 0.82:
            parts.append("Even, consistent colouring across the surface")
        elif consistency >= 0.6:
            parts.append("Mostly even colouring with some variation")
        else:
            parts.append("Noticeably uneven colouring")

    if discoloration is not None:
        if discoloration <= 0.12:
            parts.append("close to the tone expected for this food")
        elif discoloration <= 0.3:
            parts.append("drifting somewhat from the expected tone")
        else:
            parts.append("shifted well away from the expected tone")
    elif record is not None:
        parts.append("no reference tone on file to compare against")

    return ", ".join(parts) + "."


def _texture_line(metrics: SurfaceMetrics) -> str:
    uniformity = metrics.texture_uniformity
    if uniformity is None:
        return _NOT_MEASURED

    if uniformity >= 0.8:
        return "Firm, smooth and even across the surface."
    if uniformity >= 0.6:
        return "Largely even, with some irregular patches."
    if uniformity >= 0.4:
        return "Irregular surface texture, consistent with softening."
    return "Highly irregular texture, consistent with significant softening."


def _surface_line(metrics: SurfaceMetrics) -> str:
    coverage = metrics.defect_coverage
    if coverage is None:
        return _NOT_MEASURED

    if coverage <= 0.02:
        return "No significant visible decay detected."
    if coverage <= 0.06:
        return f"Small darker areas over about {coverage:.0%} of the surface."
    if coverage <= 0.15:
        return f"Visible deterioration over about {coverage:.0%} of the surface."
    return f"Extensive visible deterioration over about {coverage:.0%} of the surface."


def _ripeness_line(
    assessment: FreshnessAssessment,
    category: str,
    record: FoodRecord | None,
) -> str:
    """Ripeness only means something for foods that ripen."""
    if category not in {"fruit", "vegetable"}:
        if assessment.status == "fresh":
            return "Condition looks sound; ripeness does not apply to this food."
        if assessment.status == "spoiled":
            return "Visible spoilage indicators present."
        return "Condition is declining; use promptly."

    if assessment.status == "fresh":
        return "Ready to consume."
    if assessment.status == "nearly_spoiled":
        return "Past peak. Best used today or tomorrow."
    if assessment.status == "overripe":
        if record is not None and record.preservation:
            return f"Overripe. Still usable for: {record.preservation[0].lower()}."
        return "Overripe. Best used in cooking rather than eaten raw."
    return "Visible spoilage indicators present. Not suitable for consumption."


def build_narrative(
    metrics: SurfaceMetrics,
    assessment: FreshnessAssessment,
    category: str,
    record: FoodRecord | None,
) -> dict[str, str]:
    return {
        "color": _colour_line(metrics, record),
        "texture": _texture_line(metrics),
        "surface": _surface_line(metrics),
        "ripeness": _ripeness_line(assessment, category, record),
    }


# --- Action guidance ------------------------------------------------------

#: The "what should you do now?" line, keyed by status. Deliberately imperative
#: and short -- one action per status.
ACTION_BY_STATUS: dict[str, str] = {
    "fresh": (
        "Store appropriately and consume within the estimated freshness window."
    ),
    "nearly_spoiled": (
        "Prioritise consumption today or preserve appropriately."
    ),
    "overripe": (
        "Use in cooking or preserve now rather than eating it raw."
    ),
    "spoiled": (
        "Do not consume. Follow appropriate disposal guidance."
    ),
    "unknown": (
        "Inspect the item yourself and re-scan in better lighting."
    ),
}


def action_for(status: str, high_risk: bool) -> str:
    action = ACTION_BY_STATUS.get(status, ACTION_BY_STATUS["unknown"])
    if high_risk and status != "spoiled":
        action += (
            " For this category, also check smell and the printed date before use."
        )
    return action
