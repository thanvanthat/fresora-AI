"""The OpenCV measurement pipeline, run against synthetic images.

Synthetic rather than photographic on purpose: we construct images whose
properties we know exactly (a clean red disc, the same disc with dark spots
painted on, a browned disc), so an assertion failure points at the measurement
code rather than at an ambiguous photo.

Needs opencv and numpy::

    pytest backend/tests/test_vision.py

Also runnable directly::

    python backend/tests/test_vision.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

cv2 = pytest.importorskip("cv2", reason="opencv not installed")

from app.freshness import assess  # noqa: E402
from app.knowledge.service import knowledge  # noqa: E402
from app.narrative import build_narrative  # noqa: E402
from app.vision.metrics import (  # noqa: E402
    ImageDecodeError,
    decode_image,
    measure_surface,
    segment_food,
)

SIZE = 480
CENTRE = (SIZE // 2, SIZE // 2)
RADIUS = 150


def _canvas() -> np.ndarray:
    """Light grey background, like a worktop."""
    return np.full((SIZE, SIZE, 3), 225, dtype=np.uint8)


def clean_tomato() -> np.ndarray:
    """A saturated red disc: an evenly coloured, unblemished item."""
    image = _canvas()
    cv2.circle(image, CENTRE, RADIUS, (36, 28, 200), -1)  # BGR red
    return image


def spotted_tomato(spots: int = 18) -> np.ndarray:
    """The same disc with dark spots painted on, deterministically placed."""
    image = clean_tomato()
    rng = np.random.default_rng(1234)
    for _ in range(spots):
        angle = rng.uniform(0, 2 * np.pi)
        distance = rng.uniform(0, RADIUS * 0.75)
        x = int(CENTRE[0] + np.cos(angle) * distance)
        y = int(CENTRE[1] + np.sin(angle) * distance)
        cv2.circle(image, (x, y), int(rng.uniform(9, 17)), (18, 16, 22), -1)
    return image


def browned_tomato() -> np.ndarray:
    """A brown disc: heavy colour shift away from red."""
    image = _canvas()
    cv2.circle(image, CENTRE, RADIUS, (33, 62, 105), -1)  # BGR brown
    return image


def pale_flesh(browned: bool = False) -> np.ndarray:
    """A pale disc, like cut apple or potato -- where browning index is valid.

    `browned` swaps the pale cream for a mid-brown, which is exactly the
    deterioration the Palou browning index was developed to quantify.
    """
    image = _canvas()
    colour = (96, 132, 168) if browned else (188, 216, 232)  # BGR
    cv2.circle(image, CENTRE, RADIUS, colour, -1)
    return image


def encode(image: np.ndarray) -> bytes:
    ok, buffer = cv2.imencode(".jpg", image)
    assert ok, "failed to encode the test image"
    return buffer.tobytes()


# --- Decoding -------------------------------------------------------------


def test_decode_roundtrip() -> None:
    frame = decode_image(encode(clean_tomato()))
    assert frame.shape[2] == 3
    assert frame.dtype == np.uint8


def test_decode_downscales_large_images() -> None:
    big = cv2.resize(clean_tomato(), (2400, 1800))
    frame = decode_image(encode(big), max_edge=800)
    assert max(frame.shape[:2]) == 800


def test_decode_preserves_aspect_ratio() -> None:
    wide = cv2.resize(clean_tomato(), (1600, 800))
    frame = decode_image(encode(wide), max_edge=400)
    height, width = frame.shape[:2]
    assert abs((width / height) - 2.0) < 0.05


def test_decode_rejects_garbage() -> None:
    for payload in (b"", b"not an image at all", bytes(range(64))):
        try:
            decode_image(payload)
        except ImageDecodeError:
            continue
        raise AssertionError(f"decode should have rejected {payload[:16]!r}")


def test_decode_rejects_tiny_images() -> None:
    tiny = np.full((16, 16, 3), 200, dtype=np.uint8)
    try:
        decode_image(encode(tiny))
    except ImageDecodeError:
        return
    raise AssertionError("a 16x16 image should be rejected")


# --- Segmentation ---------------------------------------------------------


def test_segmentation_finds_the_disc() -> None:
    mask, source, fraction = segment_food(clean_tomato())
    assert source == "saturation-otsu"

    # The disc covers pi*r^2 / SIZE^2 of the frame.
    expected = (np.pi * RADIUS**2) / (SIZE * SIZE)
    assert abs(fraction - expected) < 0.05, f"expected ~{expected:.3f}, got {fraction:.3f}"

    # And the mask should actually sit over the disc, not somewhere else.
    assert mask[CENTRE[1], CENTRE[0]] > 0, "centre of the disc is not in the mask"
    assert mask[5, 5] == 0, "a background corner is inside the mask"


def test_segmentation_falls_back_on_a_flat_image() -> None:
    """A uniform grey frame has no saturated region, so the fallback runs."""
    mask, source, fraction = segment_food(_canvas())
    assert source == "centre-ellipse"
    assert fraction > 0.2
    assert mask[CENTRE[1], CENTRE[0]] > 0


# --- Measurement ----------------------------------------------------------


def test_clean_item_measures_well() -> None:
    metrics = measure_surface(clean_tomato(), healthy_hue=(0, 12))

    assert metrics.mask_source == "saturation-otsu"

    assert metrics.defect_coverage is not None
    assert metrics.defect_coverage < 0.02, "a clean disc should show almost no defects"

    assert metrics.color_consistency is not None
    assert metrics.color_consistency > 0.85, "a single-colour disc should be consistent"

    assert metrics.discoloration is not None
    assert metrics.discoloration < 0.1, "red disc against a red reference hue"

    # A flat disc is a perfectly even surface. This was 0.0 before the mask
    # was eroded, because edge blocks caught the food/background boundary.
    assert metrics.texture_uniformity is not None
    assert metrics.texture_uniformity > 0.9, "a flat disc should be near-perfectly uniform"

    assert metrics.mean_lightness is not None
    assert metrics.mean_saturation is not None and metrics.mean_saturation > 0.5


def test_spots_raise_defect_coverage() -> None:
    clean = measure_surface(clean_tomato(), healthy_hue=(0, 12))
    spotted = measure_surface(spotted_tomato(), healthy_hue=(0, 12))

    assert clean.defect_coverage is not None and spotted.defect_coverage is not None
    assert spotted.defect_coverage > clean.defect_coverage
    assert spotted.defect_coverage > 0.05, "18 painted spots should register"


def test_more_spots_measure_higher() -> None:
    few = measure_surface(spotted_tomato(spots=6), healthy_hue=(0, 12))
    many = measure_surface(spotted_tomato(spots=30), healthy_hue=(0, 12))
    assert few.defect_coverage is not None and many.defect_coverage is not None
    assert many.defect_coverage > few.defect_coverage


def test_browning_is_not_measured_for_chromatic_foods() -> None:
    """A red tomato must report null, not a meaningless 1.0.

    The Palou browning index reads ~1.0 for a flawless red tomato, because a
    large positive a* drives the formula regardless of condition. Reporting
    that as "browning: 100%" would be actively misleading, so the metric is
    gated to the light-coloured foods it is valid for.
    """
    metrics = measure_surface(clean_tomato(), healthy_hue=(0, 12), measure_browning=False)
    assert metrics.browning_index is None
    assert any("Browning index is not a valid measure" in n for n in metrics.notes)


def test_browning_is_measured_for_pale_foods() -> None:
    """Where the index IS valid, browning must register as worse."""
    fresh = measure_surface(pale_flesh(False), healthy_hue=(15, 35), measure_browning=True)
    browned = measure_surface(pale_flesh(True), healthy_hue=(15, 35), measure_browning=True)

    assert fresh.browning_index is not None and browned.browning_index is not None
    assert browned.browning_index > fresh.browning_index, (
        f"browned pale flesh ({browned.browning_index}) should exceed "
        f"fresh ({fresh.browning_index})"
    )
    # And it must not be pinned at the top of the scale.
    assert fresh.browning_index < 0.9, "a fresh pale surface should not read as fully browned"


def test_browning_applicability_matches_the_knowledge_base() -> None:
    from app.knowledge.food_data import browning_applicable

    assert browning_applicable("Apple") is True
    assert browning_applicable("Banana") is True
    assert browning_applicable("Potato") is True
    assert browning_applicable("Tomato") is False
    assert browning_applicable("Strawberry") is False
    assert browning_applicable(None) is False


def test_browned_tomato_still_registers_via_other_signals() -> None:
    """Gating browning must not blind us to a discoloured tomato.

    Discoloration, colour consistency and lightness still carry the signal.
    """
    red = measure_surface(clean_tomato(), healthy_hue=(0, 8))
    brown = measure_surface(browned_tomato(), healthy_hue=(0, 8))

    assert red.mean_lightness is not None and brown.mean_lightness is not None
    assert brown.mean_lightness < red.mean_lightness, "the brown disc is darker"

    assert red.mean_saturation is not None and brown.mean_saturation is not None
    assert brown.mean_saturation < red.mean_saturation, "the brown disc is duller"


def test_texture_survives_jpeg_compression() -> None:
    """A smooth surface must stay uniform after a JPEG round-trip.

    Regression test for the scale-invariance bug: an unregularised coefficient
    of variation read 0.0 here (fully irregular) purely from compression noise
    on a flawless disc, costing ~21 points of the freshness score.
    """
    raw = measure_surface(clean_tomato(), healthy_hue=(0, 12))
    compressed = measure_surface(decode_image(encode(clean_tomato())), healthy_hue=(0, 12))

    assert raw.texture_uniformity is not None
    assert compressed.texture_uniformity is not None
    assert compressed.texture_uniformity > 0.9, (
        f"JPEG noise alone dropped uniformity to {compressed.texture_uniformity}"
    )
    assert abs(raw.texture_uniformity - compressed.texture_uniformity) < 0.1


def test_localised_damage_lowers_uniformity() -> None:
    """Uniformity measures evenness: localised spots make a surface uneven."""
    clean = measure_surface(decode_image(encode(clean_tomato())), healthy_hue=(0, 12))
    spotted = measure_surface(decode_image(encode(spotted_tomato(18))), healthy_hue=(0, 12))

    assert clean.texture_uniformity is not None
    assert spotted.texture_uniformity is not None
    assert spotted.texture_uniformity < 0.6
    assert spotted.texture_uniformity < clean.texture_uniformity


def test_all_metrics_stay_in_range() -> None:
    """Every normalised metric must be within 0..1, or the score breaks."""
    for image in (
        clean_tomato(),
        spotted_tomato(),
        browned_tomato(),
        pale_flesh(False),
        pale_flesh(True),
    ):
        metrics = measure_surface(image, healthy_hue=(0, 12), measure_browning=True)
        for field in (
            "defect_coverage",
            "browning_index",
            "discoloration",
            "texture_uniformity",
            "color_consistency",
            "mean_saturation",
        ):
            value = getattr(metrics, field)
            if value is None:
                continue
            assert 0.0 <= value <= 1.0, f"{field} out of range: {value}"


def test_discoloration_is_none_without_a_reference_hue() -> None:
    """We refuse to guess a reference hue (milk, yoghurt, unknown foods)."""
    metrics = measure_surface(clean_tomato(), healthy_hue=None)
    assert metrics.discoloration is None
    assert any("discoloration" in note for note in metrics.notes)


def test_as_dict_rounds_and_keeps_nulls() -> None:
    metrics = measure_surface(clean_tomato(), healthy_hue=None)
    payload = metrics.as_dict()
    assert payload["discoloration"] is None
    assert isinstance(payload["defect_coverage"], float)
    # Rounded to 3 dp for the wire.
    assert payload["defect_coverage"] == round(payload["defect_coverage"], 3)


# --- End to end -----------------------------------------------------------


def test_clean_disc_scores_fresh_end_to_end() -> None:
    """Pixels in, a real score out -- the whole chain with nothing stubbed."""
    frame = decode_image(encode(clean_tomato()))
    record = knowledge.resolve("Tomato")
    assert record is not None

    metrics = measure_surface(frame, healthy_hue=record.healthy_hue)
    result = assess(metrics, record.category, record)

    assert result.status == "fresh", f"got {result.status} at {result.score}"
    assert result.score >= 80
    assert result.contributions, "contributions should be reported"
    assert result.reasoning


def test_spotted_disc_scores_worse_than_clean_end_to_end() -> None:
    record = knowledge.resolve("Tomato")
    assert record is not None

    clean = assess(
        measure_surface(decode_image(encode(clean_tomato())), record.healthy_hue),
        record.category,
        record,
    )
    spotted = assess(
        measure_surface(decode_image(encode(spotted_tomato(30))), record.healthy_hue),
        record.category,
        record,
    )
    assert spotted.score < clean.score, (
        f"spotted ({spotted.score}) should score below clean ({clean.score})"
    )


def test_browned_pale_flesh_scores_worse_end_to_end() -> None:
    """Apple flesh, where browning is both valid and the real spoilage cue."""
    record = knowledge.resolve("Apple")
    assert record is not None

    def score(browned: bool) -> int:
        frame = decode_image(encode(pale_flesh(browned)))
        metrics = measure_surface(frame, record.healthy_hue, measure_browning=True)
        return assess(metrics, record.category, record).score

    assert score(True) < score(False)


def test_narrative_is_generated_from_real_measurements() -> None:
    record = knowledge.resolve("Tomato")
    assert record is not None

    metrics = measure_surface(decode_image(encode(spotted_tomato(30))), record.healthy_hue)
    result = assess(metrics, record.category, record)
    narrative = build_narrative(metrics, result, record.category, record)

    assert set(narrative) == {"color", "texture", "surface", "ripeness"}
    for key, line in narrative.items():
        assert line and line[-1] == ".", f"{key} should be a sentence: {line!r}"
    assert "Not measured" not in narrative["surface"]


def test_unmeasurable_narrative_says_so_rather_than_inventing() -> None:
    """A frame with nothing to measure must not get a confident description."""
    record = knowledge.resolve("Milk")
    assert record is not None

    # A 40x40 solid frame: past the decode floor, but too few masked pixels.
    flat = np.full((40, 40, 3), 240, dtype=np.uint8)
    metrics = measure_surface(flat, healthy_hue=None)
    result = assess(metrics, "dairy", record)

    assert result.status == "unknown"
    narrative = build_narrative(metrics, result, "dairy", record)
    assert "Not measured" in narrative["surface"]


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
