"""Object detection: find the separate food items in one photo.

WHY A SECOND MODEL
------------------
The classifier in ``onnx_backend`` answers "what is this photo of", which
assumes one item filling the frame. A fridge shelf or a shopping haul is
several items at once, and cropping them apart is what lets each be measured
and scored on its own -- a bruised banana next to a sound apple should not
average into one number.

WHAT IT DETECTS
---------------
SSD MobileNet v1 trained on COCO. Of COCO's 80 classes, five are foods Fresora
already holds reference data for: banana, apple, orange, broccoli and carrot.
Four more are foods it does not (sandwich, pizza, hot dog, donut, cake), and
those are reported as detected-but-unknown rather than dropped, so the user can
name them.

Everything else COCO knows -- people, cutlery, furniture -- is deliberately not
reported. A bounding box round a fork is noise on a food scan.

This model cannot find tomatoes, potatoes, onions, spinach or any raw meat.
Neither COCO nor ImageNet has a class for them, which is the same limit the
classifier has, for the same reason.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)

MODELS_DIR = Path(__file__).resolve().parents[2] / "models"
DETECTOR_FILE = "ssd_mobilenet_v1_coco.onnx"

#: COCO class id -> the Fresora food it corresponds to.
#: Only unambiguous mappings, matching the classifier's own policy.
COCO_TO_FOOD: dict[int, str] = {
    52: "Banana",
    53: "Apple",
    55: "Orange",
    56: "Broccoli",
    57: "Carrot",
}

#: COCO foods with no Fresora reference data. Reported so the user can name
#: them; never silently dropped, because "we found nothing" would be wrong.
COCO_OTHER_FOOD: dict[int, str] = {
    54: "sandwich",
    58: "hot dog",
    59: "pizza",
    60: "donut",
    61: "cake",
}

#: Below this the model mostly proposes duplicates of what it already found.
#: Measured on multi-item photos: 0.30 produced overlapping near-duplicates,
#: 0.40 kept every item a person would point at.
MIN_CONFIDENCE = 0.40

#: Two boxes overlapping more than this are treated as the same item. SSD
#: already applies its own NMS per class, but the same fruit often comes back
#: under two classes (an orange as both "orange" and "apple"), which its NMS
#: does not merge and which would double-count on the inventory screen.
MAX_IOU = 0.55

#: A box smaller than this fraction of the frame is too small to measure
#: surface condition from, so detecting it would promise an assessment the
#: crop cannot support.
MIN_AREA_FRACTION = 0.01


@dataclass(frozen=True)
class Detection:
    """One food object located in the frame.

    ``box`` is (x1, y1, x2, y2) normalised to 0-1 so the client can draw it at
    any preview size without knowing the analysed resolution.
    """

    food_name: str | None
    raw_label: str
    confidence: float
    box: tuple[float, float, float, float]

    @property
    def known(self) -> bool:
        """Whether Fresora holds reference data for this food."""
        return self.food_name is not None

    def crop(self, image_bgr: np.ndarray, *, pad: float = 0.04) -> np.ndarray:
        """The image region for this detection, padded slightly.

        The padding matters: SSD boxes sit tight against the object, and a
        tight crop clips the edge where bruising and shrivelling show first.
        """
        height, width = image_bgr.shape[:2]
        x1, y1, x2, y2 = self.box

        dx = (x2 - x1) * pad
        dy = (y2 - y1) * pad
        x1 = int(max(0.0, x1 - dx) * width)
        x2 = int(min(1.0, x2 + dx) * width)
        y1 = int(max(0.0, y1 - dy) * height)
        y2 = int(min(1.0, y2 + dy) * height)

        # Guard against a degenerate box producing an empty array, which would
        # fail deep inside OpenCV rather than here.
        if x2 <= x1 or y2 <= y1:
            return image_bgr
        return image_bgr[y1:y2, x1:x2]


def _iou(a: tuple[float, ...], b: tuple[float, ...]) -> float:
    """Intersection over union of two (x1, y1, x2, y2) boxes."""
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])

    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    if inter <= 0.0:
        return 0.0

    area_a = (a[2] - a[0]) * (a[3] - a[1])
    area_b = (b[2] - b[0]) * (b[3] - b[1])
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def deduplicate(detections: list[Detection]) -> list[Detection]:
    """Drops boxes that overlap a more confident one, across classes.

    Input is assumed sorted by confidence descending.
    """
    kept: list[Detection] = []
    for candidate in detections:
        if all(_iou(candidate.box, k.box) <= MAX_IOU for k in kept):
            kept.append(candidate)
    return kept


class DetectorUnavailable(RuntimeError):
    """The detector model or runtime is not usable."""


class FoodDetector:
    """Lazy-loading SSD MobileNet detector."""

    def __init__(self, models_dir: Path = MODELS_DIR) -> None:
        self._models_dir = models_dir
        self._session = None
        self._input_name = ""

    def load(self) -> None:
        try:
            import onnxruntime as ort  # noqa: PLC0415
        except ImportError as exc:
            raise DetectorUnavailable("onnxruntime is not installed") from exc

        path = self._models_dir / DETECTOR_FILE
        if not path.exists():
            raise DetectorUnavailable(f"missing detector model: {path}")

        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1

        self._session = ort.InferenceSession(
            str(path), options, providers=["CPUExecutionProvider"]
        )
        self._input_name = self._session.get_inputs()[0].name

    @property
    def available(self) -> bool:
        return self._session is not None

    def detect(self, image_bgr: np.ndarray, *, max_items: int = 12) -> list[Detection]:
        """Food objects in the frame, most confident first.

        Returns an empty list when nothing food-like is found, which is a real
        answer and not an error.
        """
        if self._session is None:
            raise DetectorUnavailable("detector not loaded")

        import cv2  # noqa: PLC0415

        # The graph takes uint8 NHWC in RGB at whatever size it is given; it
        # resizes internally, so no normalisation happens here.
        rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)[np.newaxis, ...]
        boxes, classes, scores, count = self._session.run(
            None, {self._input_name: rgb}
        )

        found: list[Detection] = []
        for index in range(int(count[0])):
            confidence = float(scores[0][index])
            if confidence < MIN_CONFIDENCE:
                continue

            class_id = int(classes[0][index])
            food_name = COCO_TO_FOOD.get(class_id)
            raw_label = food_name or COCO_OTHER_FOOD.get(class_id)
            if raw_label is None:
                continue  # not a food; a box round a fork helps nobody

            # SSD emits (ymin, xmin, ymax, xmax); the rest of the app uses
            # (x1, y1, x2, y2), and mixing the two silently rotates every crop.
            ymin, xmin, ymax, xmax = (float(v) for v in boxes[0][index])
            box = (
                max(0.0, xmin),
                max(0.0, ymin),
                min(1.0, xmax),
                min(1.0, ymax),
            )

            if (box[2] - box[0]) * (box[3] - box[1]) < MIN_AREA_FRACTION:
                continue

            found.append(
                Detection(
                    food_name=food_name,
                    raw_label=raw_label.lower(),
                    confidence=round(confidence, 4),
                    box=box,
                )
            )

        found.sort(key=lambda d: d.confidence, reverse=True)
        return deduplicate(found)[:max_items]


_detector: FoodDetector | None = None


def get_detector() -> FoodDetector | None:
    """Process-wide detector, or None when it cannot be loaded.

    Returning None rather than raising keeps single-item scanning working on a
    deployment where the detector model is absent.
    """
    global _detector
    if _detector is None:
        candidate = FoodDetector()
        try:
            candidate.load()
        except DetectorUnavailable as exc:
            logger.info("Object detection unavailable: %s", exc)
            return None
        _detector = candidate
    return _detector
