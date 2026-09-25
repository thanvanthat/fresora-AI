"""Food identification with MobileNetV2.

Two modes, chosen at start-up:

``custom``
    ``MODEL_PATH`` points at a fine-tuned model plus a ``labels.txt`` beside it.
    Its labels are used directly. This is the mode to use once a food/freshness
    dataset has been trained.

``imagenet``
    No custom model is configured, so stock MobileNetV2 ImageNet weights are
    downloaded and used.

An honest limitation of the ``imagenet`` mode
--------------------------------------------
ImageNet-1k contains a usable class for *some* foods (banana, orange, lemon,
strawberry, pineapple, pomegranate, cucumber, bell pepper, broccoli,
cauliflower, mushroom, cabbage, bread, bagel) but has **no class at all** for
several foods Fresora cares about -- tomato, potato, onion, spinach, carrot,
mango, guava, and raw chicken, fish, beef, milk or yoghurt.

For those, stock ImageNet weights cannot identify the item, and this module says
so: it returns ``identified=False`` with whatever the raw top labels were, and
the app asks the user to name the food. It does **not** invent a plausible food
name, because a confident wrong label is worse than an honest blank.

``IMAGENET_FOOD_MAP`` therefore only contains mappings that are genuinely
correct. Everything else is a deliberate gap.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .onnx_backend import OnnxFoodModel, OnnxUnavailable

logger = logging.getLogger(__name__)

MODEL_INPUT_SIZE = (224, 224)

#: ImageNet class name (as Keras ``decode_predictions`` reports it) -> the
#: Fresora food name. Only unambiguous mappings appear here.
IMAGENET_FOOD_MAP: dict[str, str] = {
    # Fruit
    "banana": "Banana",
    "orange": "Orange",
    "lemon": "Lemon",
    "strawberry": "Strawberry",
    "pineapple": "Pineapple",
    "ananas": "Pineapple",
    "pomegranate": "Pomegranate",
    "Granny_Smith": "Apple",
    # Vegetables
    "cucumber": "Cucumber",
    "cuke": "Cucumber",
    "bell_pepper": "Capsicum",
    "broccoli": "Broccoli",
    "cauliflower": "Cauliflower",
    "mushroom": "Mushroom",
    "head_cabbage": "Cabbage",
    # Bakery
    "French_loaf": "Bread",
    "bagel": "Bread",
    "beigel": "Bread",
}

#: ImageNet labels that mean "this is food, but not a class we can name".
#: Seeing one of these raises our confidence that a food is in frame even when
#: we cannot identify it, which is worth reporting to the user.
GENERIC_FOOD_LABELS: frozenset[str] = frozenset(
    {
        "plate",
        "tray",
        "soup_bowl",
        "mixing_bowl",
        "grocery_store",
        "market",
        "butcher_shop",
        "confectionery",
        "bakery",
        "menu",
        "consomme",
        "hot_pot",
        "meat_loaf",
        "mashed_potato",
        "guacamole",
        "carbonara",
        "pizza",
        "cheeseburger",
        "hotdog",
        "ice_cream",
        "trifle",
    }
)


@dataclass
class Prediction:
    food_name: str
    confidence: float
    #: The raw model label behind this prediction, kept for transparency.
    raw_label: str


@dataclass
class Identification:
    identified: bool
    food_name: str | None
    confidence: float
    predictions: list[Prediction] = field(default_factory=list)
    #: Raw top labels, whether or not they mapped to a known food.
    raw_labels: list[tuple[str, float]] = field(default_factory=list)
    #: True when the frame looks like food even though we could not name it.
    looks_like_food: bool = False
    model_version: str = "unknown"
    note: str | None = None


class ModelUnavailableError(RuntimeError):
    """Raised when no classifier can be loaded.

    The router turns this into a truthful "analysis unavailable" response. It is
    never swallowed in favour of a placeholder prediction.
    """


class FoodClassifier:
    """Lazy-loading MobileNetV2 wrapper.

    The model is loaded on first use, not at import, so the API can start and
    serve its health and knowledge endpoints even if TensorFlow is missing.
    Loading is guarded by a lock because Keras models are not thread-safe to
    build concurrently.
    """

    def __init__(self, model_path: str = "") -> None:
        self._model_path = model_path.strip()
        self._model = None
        self._labels: list[str] | None = None
        self._mode = "custom" if self._model_path else "imagenet"
        self._lock = threading.Lock()
        self._load_error: str | None = None
        #: ONNX is the preferred backend; TensorFlow stays only for loading a
        #: pre-existing Keras model via MODEL_PATH.
        self._onnx: OnnxFoodModel | None = None

    # --- Loading ----------------------------------------------------------

    @property
    def mode(self) -> str:
        return self._mode

    @property
    def model_version(self) -> str:
        # Reported to the client and shown in the You tab, so it has to name the
        # backend that actually produced the prediction.
        if self._onnx is not None:
            return self._onnx.version
        if self._mode == "custom":
            return f"custom:{Path(self._model_path).name}"
        return "mobilenetv2-imagenet"

    def is_available(self) -> bool:
        """Whether the model can be used, without raising."""
        try:
            self._ensure_loaded()
            return True
        except ModelUnavailableError:
            return False

    def _ensure_loaded(self) -> None:
        if self._model is not None:
            return

        with self._lock:
            if self._model is not None:
                return
            if self._load_error is not None:
                raise ModelUnavailableError(self._load_error)

            try:
                self._load()
            except ModelUnavailableError:
                raise
            except Exception as exc:  # pragma: no cover - environment dependent
                self._load_error = f"failed to load classifier: {exc}"
                logger.exception("Classifier load failed")
                raise ModelUnavailableError(self._load_error) from exc

    def _load(self) -> None:
        # ONNX first. It is the only backend small enough to deploy, so an
        # explicit Keras MODEL_PATH is the sole reason to reach for TensorFlow.
        if not self._model_path:
            onnx = OnnxFoodModel()
            try:
                onnx.load()
            except OnnxUnavailable as exc:
                logger.info("ONNX backend unavailable (%s); trying TensorFlow", exc)
            else:
                self._onnx = onnx
                self._model = onnx
                self._mode = onnx.mode
                self._labels = list(onnx.head.labels) if onnx.head else None
                logger.info("Loaded ONNX classifier (%s)", onnx.version)
                return

        try:
            from tensorflow.keras.applications import MobileNetV2  # noqa: PLC0415
            from tensorflow.keras.models import load_model  # noqa: PLC0415
        except ImportError as exc:
            self._load_error = (
                "Food identification is unavailable: no ONNX model bundle was "
                "found and TensorFlow is not installed."
            )
            raise ModelUnavailableError(self._load_error) from exc

        if self._mode == "custom":
            path = Path(self._model_path)
            if not path.exists():
                self._load_error = f"MODEL_PATH does not exist: {path}"
                raise ModelUnavailableError(self._load_error)

            self._model = load_model(str(path))
            labels_file = path.parent / "labels.txt"
            if not labels_file.exists():
                self._load_error = (
                    f"A custom model needs a labels.txt beside it at {labels_file}"
                )
                raise ModelUnavailableError(self._load_error)
            self._labels = [
                line.strip()
                for line in labels_file.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            logger.info("Loaded custom classifier with %d labels", len(self._labels))
            return

        self._model = MobileNetV2(weights="imagenet")
        logger.info("Loaded MobileNetV2 ImageNet weights")

    # --- Inference --------------------------------------------------------

    def _preprocess(self, image_bgr: np.ndarray) -> np.ndarray:
        import cv2  # noqa: PLC0415
        from tensorflow.keras.applications.mobilenet_v2 import (  # noqa: PLC0415
            preprocess_input,
        )

        resized = cv2.resize(image_bgr, MODEL_INPUT_SIZE, interpolation=cv2.INTER_AREA)
        rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
        batch = np.expand_dims(rgb.astype(np.float32), axis=0)
        return preprocess_input(batch)

    def identify(self, image_bgr: np.ndarray, top_k: int = 5) -> Identification:
        """Identify the food in a BGR image.

        Raises ModelUnavailableError when no model could be loaded.
        """
        self._ensure_loaded()
        assert self._model is not None  # _ensure_loaded guarantees this

        if self._onnx is not None:
            raw = self._onnx.predict(image_bgr)
        else:
            batch = self._preprocess(image_bgr)
            raw = self._model.predict(batch, verbose=0)[0]

        if self._mode == "custom":
            return self._interpret_custom(raw, top_k)
        return self._interpret_imagenet(raw, top_k)

    def _interpret_custom(self, raw: np.ndarray, top_k: int) -> Identification:
        labels = self._labels or []
        order = np.argsort(raw)[::-1][:top_k]

        predictions = [
            Prediction(
                food_name=labels[int(i)] if int(i) < len(labels) else f"class_{int(i)}",
                confidence=float(raw[int(i)]),
                raw_label=labels[int(i)] if int(i) < len(labels) else f"class_{int(i)}",
            )
            for i in order
        ]
        top = predictions[0]
        return Identification(
            identified=True,
            food_name=top.food_name,
            confidence=top.confidence,
            predictions=predictions,
            raw_labels=[(p.raw_label, p.confidence) for p in predictions],
            looks_like_food=True,
            model_version=self.model_version,
        )

    def _decode_imagenet(
        self, raw: np.ndarray, top_k: int
    ) -> list[tuple[str, str, float]]:
        """Top-k as (synset_id, label, score), matching Keras decode_predictions.

        The ONNX path decodes from the bundled class-index table so that no
        TensorFlow import is needed to read a prediction.
        """
        if self._onnx is not None:
            order = np.argsort(raw)[::-1][:top_k]
            return [
                ("", self._onnx.class_index.get(int(i), f"class_{int(i)}"), float(raw[int(i)]))
                for i in order
            ]

        from tensorflow.keras.applications.mobilenet_v2 import (  # noqa: PLC0415
            decode_predictions,
        )

        return decode_predictions(np.expand_dims(raw, axis=0), top=top_k)[0]

    def _interpret_imagenet(self, raw: np.ndarray, top_k: int) -> Identification:
        decoded = self._decode_imagenet(raw, top_k)
        raw_labels = [(str(name), float(score)) for _, name, score in decoded]

        mapped: list[Prediction] = []
        for _, name, score in decoded:
            food = IMAGENET_FOOD_MAP.get(str(name))
            if food is not None and not any(p.food_name == food for p in mapped):
                mapped.append(
                    Prediction(
                        food_name=food, confidence=float(score), raw_label=str(name)
                    )
                )

        looks_like_food = bool(mapped) or any(
            name in GENERIC_FOOD_LABELS for name, _ in raw_labels
        )

        if mapped:
            top = mapped[0]
            return Identification(
                identified=True,
                food_name=top.food_name,
                confidence=top.confidence,
                predictions=mapped,
                raw_labels=raw_labels,
                looks_like_food=True,
                model_version=self.model_version,
            )

        return Identification(
            identified=False,
            food_name=None,
            confidence=0.0,
            predictions=[],
            raw_labels=raw_labels,
            looks_like_food=looks_like_food,
            model_version=self.model_version,
            note=(
                "Stock ImageNet weights have no class for this item. Set the food "
                "name to continue -- the surface measurements below were still taken."
            ),
        )


#: Process-wide classifier. Built from settings on first import of the router.
_classifier: FoodClassifier | None = None
_classifier_lock = threading.Lock()


def get_classifier(model_path: str = "") -> FoodClassifier:
    global _classifier
    if _classifier is None:
        with _classifier_lock:
            if _classifier is None:
                _classifier = FoodClassifier(model_path)
    return _classifier


def reset_classifier() -> None:
    """Drop the cached classifier. Used by tests."""
    global _classifier
    with _classifier_lock:
        _classifier = None
