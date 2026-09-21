"""OpenCV surface measurements.

Everything in this module is an actual measurement taken from the pixels. When a
measurement cannot be made for an image, the field is returned as ``None`` and
the mobile UI hides that row -- FreshcoAI never shows a fabricated metric.

Pipeline
--------
1. decode -> BGR uint8
2. resize so the longest edge is at most ``max_edge`` (keeps cost predictable)
3. segment the food region from the background
4. measure, inside the mask only:
   - browning index      (CIELAB -> published BI formula)
   - defect coverage     (dark-spot fraction relative to the item's own tone)
   - discoloration       (hue drift away from the food's healthy hue band)
   - texture uniformity  (consistency of local Laplacian energy)
   - colour consistency  (spread of hue and chroma)
   - mean L*, mean saturation

Segmentation
------------
Foods are usually more saturated than the surface they sit on, so an Otsu
threshold on the HSV saturation channel plus the largest connected component
isolates the item well for typical phone photos. When that produces an
implausible mask (under 8% or over 97% of the frame -- e.g. a pale item on a
white plate) we fall back to a centred ellipse covering the middle of the frame,
which matches the on-screen capture guide the scanner draws. ``mask_source`` on
the result records which path ran, so the behaviour is never opaque.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import cv2
import numpy as np

#: Fraction of the frame below/above which an Otsu mask is rejected as implausible.
_MIN_MASK_FRACTION = 0.08
_MAX_MASK_FRACTION = 0.97

#: Below this many food pixels there is not enough signal to measure anything.
_MIN_MASK_PIXELS = 1_500

#: Browning index reference. The Palou formula yields roughly 0 for a neutral
#: surface and climbs past 200 for heavily browned produce; we normalise by this
#: value so the reported figure is a 0..1 share of "heavily browned".
_BI_REFERENCE = 180.0

#: A pixel counts as a dark defect when its L* falls this far below the item's
#: own median L*. Relative rather than absolute, so a naturally dark item such
#: as a brinjal is not scored as one large defect.
_DEFECT_L_DROP = 28.0

#: Block size, in pixels, for the local-texture pass.
_TEXTURE_BLOCK = 16

#: Absolute floor, in 8-bit Laplacian units, added to the mean block energy
#: before taking the coefficient of variation.
#:
#: Without it the measure is nonsense on a smooth surface. A flat region has
#: near-zero energy everywhere, so JPEG noise alone produces a CoV of ~10
#: (measured: mean 0.001, std 0.010) even though the absolute variation is
#: negligible -- CoV is scale-invariant, so it cannot tell "no texture" from
#: "wildly varying texture". Regularising by a floor makes the statistic behave
#: like a CoV once there is real texture energy to compare, and saturate at
#: "uniform" when the surface is simply smooth.
#:
#: 4.0 was chosen from measured block statistics: clean JPEG surface -> 0.998,
#: locally spotted -> 0.23-0.37, evenly mottled -> 0.96.
_TEXTURE_ENERGY_FLOOR = 4.0


@dataclass
class SurfaceMetrics:
    """Measured surface properties. ``None`` means "not measurable here"."""

    defect_coverage: float | None = None
    browning_index: float | None = None
    discoloration: float | None = None
    texture_uniformity: float | None = None
    color_consistency: float | None = None
    mean_lightness: float | None = None
    mean_saturation: float | None = None

    #: Diagnostics, surfaced in the API so results stay explainable.
    mask_fraction: float | None = None
    mask_source: str = "none"
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, float | None]:
        return {
            "defect_coverage": _round(self.defect_coverage),
            "browning_index": _round(self.browning_index),
            "discoloration": _round(self.discoloration),
            "texture_uniformity": _round(self.texture_uniformity),
            "color_consistency": _round(self.color_consistency),
            "mean_lightness": _round(self.mean_lightness, 1),
            "mean_saturation": _round(self.mean_saturation),
        }


def _round(value: float | None, digits: int = 3) -> float | None:
    return None if value is None else round(float(value), digits)


class ImageDecodeError(ValueError):
    """Raised when the uploaded bytes are not a decodable image."""


def decode_image(data: bytes, max_edge: int = 1024) -> np.ndarray:
    """Decode upload bytes to a BGR array, downscaled to ``max_edge``.

    Raises ImageDecodeError for anything OpenCV cannot read, which the router
    turns into the friendly "that image is hard to read" response.
    """
    if not data:
        raise ImageDecodeError("empty upload")

    buffer = np.frombuffer(data, dtype=np.uint8)
    image = cv2.imdecode(buffer, cv2.IMREAD_COLOR)
    if image is None:
        raise ImageDecodeError("could not decode image data")

    height, width = image.shape[:2]
    if height < 32 or width < 32:
        raise ImageDecodeError("image too small to analyse")

    longest = max(height, width)
    if longest > max_edge:
        scale = max_edge / longest
        image = cv2.resize(
            image,
            (int(round(width * scale)), int(round(height * scale))),
            interpolation=cv2.INTER_AREA,
        )
    return image


def _fill_holes(mask: np.ndarray) -> np.ndarray:
    """Fill interior holes in a food mask by redrawing its outer contours solid.

    This matters more than it looks. Rot, bruising and mould are *dark and
    desaturated*, so a saturation threshold cuts them straight out of the food
    region -- meaning the exact pixels we most need to measure would be
    excluded, and a spotted item would measure as clean. Filling the outline
    puts them back inside the region.
    """
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return mask

    filled = np.zeros_like(mask)
    cv2.drawContours(filled, contours, -1, color=255, thickness=cv2.FILLED)
    return filled


def segment_food(image: np.ndarray) -> tuple[np.ndarray, str, float]:
    """Return (mask, source, fraction) isolating the food from the background."""
    height, width = image.shape[:2]
    total = height * width

    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    saturation = cv2.GaussianBlur(hsv[:, :, 1], (5, 5), 0)

    _, otsu = cv2.threshold(saturation, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    otsu = cv2.morphologyEx(otsu, cv2.MORPH_OPEN, kernel, iterations=2)
    otsu = cv2.morphologyEx(otsu, cv2.MORPH_CLOSE, kernel, iterations=2)

    count, labels, stats, _ = cv2.connectedComponentsWithStats(otsu, connectivity=8)
    if count > 1:
        # Label 0 is the background component; pick the largest of the rest.
        largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        mask = np.where(labels == largest, 255, 0).astype(np.uint8)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=3)
        mask = _fill_holes(mask)
        fraction = float(np.count_nonzero(mask)) / total
        if _MIN_MASK_FRACTION <= fraction <= _MAX_MASK_FRACTION:
            return mask, "saturation-otsu", fraction

    # Fallback: the centred ellipse the scanner's capture guide describes.
    mask = np.zeros((height, width), dtype=np.uint8)
    cv2.ellipse(
        mask,
        center=(width // 2, height // 2),
        axes=(int(width * 0.38), int(height * 0.38)),
        angle=0,
        startAngle=0,
        endAngle=360,
        color=255,
        thickness=-1,
    )
    return mask, "centre-ellipse", float(np.count_nonzero(mask)) / total


def _browning_index(lab_pixels: np.ndarray) -> float | None:
    """Mean browning index over the food pixels, normalised to 0..1.

    Uses the standard browning index for food surfaces (Palou et al., 1999):

        x  = (a* + 1.75 L*) / (5.645 L* + a* - 3.012 b*)
        BI = 100 * (x - 0.31) / 0.17

    ``lab_pixels`` is an (N, 3) float array of CIELAB values with L* in 0..100
    and a*/b* in roughly -128..127.
    """
    if lab_pixels.size == 0:
        return None

    lightness = lab_pixels[:, 0]
    a_star = lab_pixels[:, 1]
    b_star = lab_pixels[:, 2]

    denominator = 5.645 * lightness + a_star - 3.012 * b_star
    # Guard the denominator; near-zero values are numerically meaningless.
    valid = np.abs(denominator) > 1e-3
    if not np.any(valid):
        return None

    x = (a_star[valid] + 1.75 * lightness[valid]) / denominator[valid]
    bi = 100.0 * (x - 0.31) / 0.17

    mean_bi = float(np.mean(np.clip(bi, 0.0, None)))
    return float(np.clip(mean_bi / _BI_REFERENCE, 0.0, 1.0))


def _defect_coverage(lightness: np.ndarray) -> float | None:
    """Share of the surface that is markedly darker than the item's own tone."""
    if lightness.size < _MIN_MASK_PIXELS:
        return None

    median_l = float(np.median(lightness))
    dark = lightness < (median_l - _DEFECT_L_DROP)
    return float(np.count_nonzero(dark)) / float(lightness.size)


def _hue_distance(hue: np.ndarray, band: tuple[int, int]) -> np.ndarray:
    """Circular distance (in OpenCV hue units, 0-179) from a hue band."""
    low, high = band
    if low <= high:
        inside = (hue >= low) & (hue <= high)
    else:
        # Band wraps past 179 (e.g. reds).
        inside = (hue >= low) | (hue <= high)

    to_low = np.minimum(np.abs(hue - low), 180.0 - np.abs(hue - low))
    to_high = np.minimum(np.abs(hue - high), 180.0 - np.abs(hue - high))
    distance = np.minimum(to_low, to_high)
    return np.where(inside, 0.0, distance)


def _discoloration(hue: np.ndarray, healthy_hue: tuple[int, int] | None) -> float | None:
    """Mean normalised hue drift away from a sound example of this food.

    Returns None when the food has no meaningful single hue (milk, yoghurt) or
    is unknown to the knowledge base -- we will not guess a reference hue.
    """
    if healthy_hue is None or hue.size == 0:
        return None

    distance = _hue_distance(hue.astype(np.float32), healthy_hue)
    # 90 is the maximum possible circular distance in OpenCV hue units.
    return float(np.clip(np.mean(distance) / 90.0, 0.0, 1.0))


def _texture_uniformity(gray: np.ndarray, mask: np.ndarray) -> float | None:
    """How evenly local texture energy is distributed across the surface.

    Laplacian energy is averaged per block; a low coefficient of variation
    across blocks means an even surface (1.0), a high one means irregular
    patchiness (towards 0.0).

    The mask is eroded by a full block before sampling. Without that, blocks
    straddling the item's outline pick up the huge Laplacian response of the
    food-to-background edge, which swamps the real surface variation and makes
    even a perfectly smooth item measure as maximally irregular.
    """
    erosion = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (_TEXTURE_BLOCK + 1, _TEXTURE_BLOCK + 1)
    )
    interior = cv2.erode(mask, erosion, iterations=1)

    laplacian = cv2.Laplacian(gray, cv2.CV_32F, ksize=3)
    energy = np.abs(laplacian)

    height, width = gray.shape[:2]
    block_means: list[float] = []
    for y in range(0, height - _TEXTURE_BLOCK + 1, _TEXTURE_BLOCK):
        for x in range(0, width - _TEXTURE_BLOCK + 1, _TEXTURE_BLOCK):
            block_mask = interior[y : y + _TEXTURE_BLOCK, x : x + _TEXTURE_BLOCK]
            # Only score blocks that sit wholly inside the eroded region.
            if np.count_nonzero(block_mask) < (_TEXTURE_BLOCK * _TEXTURE_BLOCK * 0.95):
                continue
            block_means.append(
                float(np.mean(energy[y : y + _TEXTURE_BLOCK, x : x + _TEXTURE_BLOCK]))
            )

    if len(block_means) < 6:
        return None

    values = np.asarray(block_means, dtype=np.float32)
    mean = float(np.mean(values))
    spread = float(np.std(values))

    # Regularised coefficient of variation -- see _TEXTURE_ENERGY_FLOOR.
    variation = spread / (mean + _TEXTURE_ENERGY_FLOOR)

    # Variation of 0 -> 1.0; 1.5 or more -> 0.0.
    return float(np.clip(1.0 - (variation / 1.5), 0.0, 1.0))


def _color_consistency(hue: np.ndarray, saturation: np.ndarray) -> float | None:
    """How tightly the surface holds a single colour.

    Hue is circular, so its spread is measured with circular variance rather
    than a plain standard deviation (which would call red-at-0 and red-at-179
    maximally different).
    """
    if hue.size < _MIN_MASK_PIXELS:
        return None

    angles = hue.astype(np.float32) * (2.0 * math.pi / 180.0)
    # Weight each pixel's hue by its saturation: hue is unreliable when grey.
    weights = np.clip(saturation.astype(np.float32) / 255.0, 0.02, 1.0)
    total_weight = float(np.sum(weights))

    mean_cos = float(np.sum(np.cos(angles) * weights) / total_weight)
    mean_sin = float(np.sum(np.sin(angles) * weights) / total_weight)
    resultant = math.sqrt(mean_cos**2 + mean_sin**2)

    # resultant == 1 means every pixel shares a hue; 0 means fully scattered.
    hue_consistency = float(np.clip(resultant, 0.0, 1.0))

    saturation_spread = float(np.std(saturation.astype(np.float32) / 255.0))
    saturation_consistency = float(np.clip(1.0 - (saturation_spread / 0.35), 0.0, 1.0))

    return 0.7 * hue_consistency + 0.3 * saturation_consistency


def measure_surface(
    image: np.ndarray,
    healthy_hue: tuple[int, int] | None = None,
    measure_browning: bool = False,
) -> SurfaceMetrics:
    """Measure every surface property we can for this image.

    ``measure_browning`` should come from
    ``knowledge.food_data.browning_applicable(food_name)``. It defaults to
    False because the browning index is only valid for light-coloured foods --
    see that function for why.
    """
    result = SurfaceMetrics()

    mask, source, fraction = segment_food(image)
    result.mask_source = source
    result.mask_fraction = round(fraction, 3)

    selected = mask > 0
    pixel_count = int(np.count_nonzero(selected))
    if pixel_count < _MIN_MASK_PIXELS:
        result.notes.append(
            "Too little of the frame could be isolated as food to measure the surface."
        )
        return result

    if source == "centre-ellipse":
        result.notes.append(
            "The food could not be separated from the background, so measurements "
            "cover the centre of the frame."
        )

    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    # OpenCV's 8-bit Lab packs L* into 0..255 and a*/b* into 0..255 with a +128
    # offset, so both are rescaled to true CIELAB ranges here.
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB).astype(np.float32)
    lab[:, :, 0] *= 100.0 / 255.0
    lab[:, :, 1] -= 128.0
    lab[:, :, 2] -= 128.0

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    hue = hsv[:, :, 0][selected]
    saturation = hsv[:, :, 1][selected]
    lab_pixels = lab[selected]
    lightness = lab_pixels[:, 0]

    result.browning_index = _browning_index(lab_pixels) if measure_browning else None
    result.defect_coverage = _defect_coverage(lightness)
    result.discoloration = _discoloration(hue, healthy_hue)
    result.texture_uniformity = _texture_uniformity(gray, mask)
    result.color_consistency = _color_consistency(hue, saturation)
    result.mean_lightness = float(np.mean(lightness))
    result.mean_saturation = float(np.mean(saturation) / 255.0)

    if healthy_hue is None:
        result.notes.append(
            "No reference hue is on file for this food, so discoloration was not measured."
        )

    if not measure_browning:
        result.notes.append(
            "Browning index is not a valid measure for this food, so it was not measured."
        )

    return result
