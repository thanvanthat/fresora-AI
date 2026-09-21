"""A stand-in for SurfaceMetrics.

The scoring and narrative modules take anything with these attributes, so tests
can exercise them without importing OpenCV or NumPy. That is the whole reason
``app/freshness.py`` imports ``SurfaceMetrics`` under ``TYPE_CHECKING`` only.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class FakeMetrics:
    defect_coverage: float | None = None
    browning_index: float | None = None
    discoloration: float | None = None
    texture_uniformity: float | None = None
    color_consistency: float | None = None
    mean_lightness: float | None = None
    mean_saturation: float | None = None
    mask_fraction: float | None = 0.5
    mask_source: str = "saturation-otsu"
    notes: list[str] = field(default_factory=list)


def pristine() -> FakeMetrics:
    """What a sound, evenly coloured item measures like."""
    return FakeMetrics(
        defect_coverage=0.0,
        browning_index=0.02,
        discoloration=0.02,
        texture_uniformity=0.95,
        color_consistency=0.95,
        mean_lightness=60.0,
        mean_saturation=0.6,
    )


def declining() -> FakeMetrics:
    """Past its best: some spotting, some browning, softening."""
    return FakeMetrics(
        defect_coverage=0.09,
        browning_index=0.34,
        discoloration=0.22,
        texture_uniformity=0.55,
        color_consistency=0.6,
        mean_lightness=48.0,
        mean_saturation=0.42,
    )


def rotten() -> FakeMetrics:
    """Heavily deteriorated on every measured signal."""
    return FakeMetrics(
        defect_coverage=0.48,
        browning_index=0.9,
        discoloration=0.62,
        texture_uniformity=0.12,
        color_consistency=0.2,
        mean_lightness=28.0,
        mean_saturation=0.2,
    )


def unmeasurable() -> FakeMetrics:
    """Segmentation failed: nothing could be measured."""
    return FakeMetrics(notes=["Too little of the frame could be isolated as food."])
