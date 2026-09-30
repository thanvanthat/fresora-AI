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
YOLOX-Tiny trained on COCO. Of COCO's 80 classes, five are foods Fresora
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
DETECTOR_FILE = "yolox_tiny.onnx"

#: Square side the network takes. Images are letterboxed to it.
INPUT_SIZE = 416

#: Feature-map strides YOLOX predicts at. 416/8, /16 and /32 give
#: 52*52 + 26*26 + 13*13 = 3549 anchors, matching the output's middle axis.
STRIDES = (8, 16, 32)

#: Letterbox fill. YOLOX trains with this value, so padding with black instead
#: shifts the statistics the network sees at the edges.
PAD_VALUE = 114

#: COCO class index -> the Fresora food it corresponds to.
#:
#: These are 0-based indices into COCO's 80 classes, which is what YOLOX emits.
#: SSD used the 90-class map where banana is 52; here it is 46. Carrying the
#: old numbers over would silently relabel everything -- apples as oranges and
#: so on -- rather than failing, so they are worth stating plainly.
COCO_TO_FOOD: dict[int, str] = {
    46: "Banana",
    47: "Apple",
    49: "Orange",
    50: "Broccoli",
    51: "Carrot",
}

#: COCO foods with no Fresora reference data. Reported so the user can name
#: them; never silently dropped, because "we found nothing" would be wrong.
COCO_OTHER_FOOD: dict[int, str] = {
    48: "sandwich",
    52: "hot dog",
    53: "pizza",
    54: "donut",
    55: "cake",
}

#: Below this the model mostly proposes duplicates of what it already found.
#: Measured on multi-item photos: 0.30 produced overlapping near-duplicates,
#: 0.40 kept every item a person would point at.
MIN_CONFIDENCE = 0.40

#: Two boxes overlapping more than this are treated as the same item.
#:
#: YOLOX emits one prediction per anchor with no NMS of its own, so a single
#: apple arrives as dozens of near-identical boxes -- 110 raw hits on a
#: six-fruit photo. `deduplicate` is therefore doing real NMS here, not the
#: cross-class tidy-up it was for SSD, and it also still merges the same fruit
#: returned under two classes.
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


def letterbox(image_bgr: np.ndarray) -> tuple[np.ndarray, float]:
    """Scales the image into a square canvas without distorting it.

    Returns the NCHW batch and the scale factor, which is needed to map boxes
    back to the original image. Stretching to a square instead would squash a
    banana into something the network has not seen.

    YOLOX takes raw BGR in 0-255: no channel swap and no mean/std
    normalisation. Applying ImageNet normalisation here -- as the classifier
    needs -- would not error, it would just make every prediction wrong.
    """
    import cv2  # noqa: PLC0415

    canvas = np.full((INPUT_SIZE, INPUT_SIZE, 3), PAD_VALUE, dtype=np.uint8)
    ratio = min(INPUT_SIZE / image_bgr.shape[0], INPUT_SIZE / image_bgr.shape[1])

    height = int(image_bgr.shape[0] * ratio)
    width = int(image_bgr.shape[1] * ratio)
    canvas[:height, :width] = cv2.resize(
        image_bgr, (width, height), interpolation=cv2.INTER_LINEAR
    )

    batch = np.ascontiguousarray(canvas.transpose(2, 0, 1)[np.newaxis], dtype=np.float32)
    return batch, ratio


def decode(raw: np.ndarray) -> np.ndarray:
    """Turns grid-relative predictions into pixel boxes.

    YOLOX predicts an offset within each grid cell rather than an absolute
    position, so every box needs its cell origin added and its stride applied.
    Skipping this yields boxes clustered in the top-left corner, which looks
    like a broken model rather than a missing step.

    In: (anchors, 85). Out: the same array with columns 0-3 as
    (cx, cy, w, h) in letterboxed pixels.
    """
    grids = []
    strides = []
    for stride in STRIDES:
        size = INPUT_SIZE // stride
        xs, ys = np.meshgrid(np.arange(size), np.arange(size))
        grids.append(np.stack((xs, ys), axis=2).reshape(-1, 2))
        strides.append(np.full((size * size, 1), stride))

    grid = np.concatenate(grids, axis=0)
    stride_per_anchor = np.concatenate(strides, axis=0)

    raw[:, :2] = (raw[:, :2] + grid) * stride_per_anchor
    raw[:, 2:4] = np.exp(raw[:, 2:4]) * stride_per_anchor
    return raw


class DetectorUnavailable(RuntimeError):
    """The detector model or runtime is not usable."""


class FoodDetector:
    """Lazy-loading YOLOX-Tiny detector."""

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

        height, width = image_bgr.shape[:2]
        batch, ratio = letterbox(image_bgr)
        predictions = decode(
            np.asarray(self._session.run(None, {self._input_name: batch})[0])[0].copy()
        )

        # Column 4 is objectness, 5 onwards are per-class scores. The product
        # is the usual YOLO confidence: a box can be confidently "an apple"
        # while the model is not confident anything is there at all.
        class_scores = predictions[:, 4:5] * predictions[:, 5:]
        class_ids = class_scores.argmax(axis=1)
        confidences = class_scores.max(axis=1)

        found: list[Detection] = []
        for index in np.flatnonzero(confidences >= MIN_CONFIDENCE):
            class_id = int(class_ids[index])
            food_name = COCO_TO_FOOD.get(class_id)
            raw_label = food_name or COCO_OTHER_FOOD.get(class_id)
            if raw_label is None:
                continue  # not a food; a box round a fork helps nobody

            # (cx, cy, w, h) in letterboxed pixels -> corners in the original
            # image -> normalised. Dividing by `ratio` undoes the letterbox
            # scale; the padding sits bottom-right so no offset is needed.
            cx, cy, box_w, box_h = (float(v) / ratio for v in predictions[index, :4])
            box = (
                max(0.0, (cx - box_w / 2) / width),
                max(0.0, (cy - box_h / 2) / height),
                min(1.0, (cx + box_w / 2) / width),
                min(1.0, (cy + box_h / 2) / height),
            )

            if (box[2] - box[0]) * (box[3] - box[1]) < MIN_AREA_FRACTION:
                continue

            found.append(
                Detection(
                    food_name=food_name,
                    raw_label=raw_label.lower(),
                    confidence=round(float(confidences[index]), 4),
                    box=box,
                )
            )

        # Sorting first is what makes deduplicate an NMS: the most confident
        # box of each cluster is kept and the rest are suppressed against it.
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
