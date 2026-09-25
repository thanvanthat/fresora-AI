"""ONNX inference backend for food identification.

Why ONNX rather than TensorFlow
-------------------------------
The original classifier required TensorFlow. That is roughly 600 MB installed,
which exceeds the 250 MB unzipped limit for a Python serverless function, so on
the deployed backend identification could never run at all -- a trained model
would have been undeployable. ``onnxruntime`` is 24 MB and the MobileNetV2
graph is 14 MB, so the whole identification path fits alongside OpenCV.

TensorFlow also publishes no wheels for Python 3.13+, which is why the feature
was off in local development too.

Two modes
---------
**imagenet** (default): the stock MobileNetV2 graph classifies into the 1000
ImageNet classes, and ``IMAGENET_FOOD_MAP`` narrows those to food names Fresora
knows. This identifies fruit and vegetables. It cannot identify raw meat,
poultry or fish, because ImageNet-1k has no class for them -- no amount of
wiring changes that, only a model trained on those classes does.

**custom**: a trained head (``head.npz``) plus ``labels.txt`` sitting beside the
graph. The head is a plain linear layer over the 1000-dimensional ImageNet
output, so it trains on CPU in seconds from a few hundred images per class and
adds kilobytes rather than megabytes. This is the path that makes raw-meat
classes possible; see ``scripts/train_food_head.py``.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)

#: The graph expects 224x224 RGB.
INPUT_SIZE = (224, 224)

#: torchvision-style normalisation, which is what the ONNX Model Zoo
#: MobileNetV2 was exported with. Using Keras-style [-1, 1] scaling here would
#: silently degrade every prediction rather than fail, so it is worth stating.
_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

#: Where the bundled graph and label table live.
MODELS_DIR = Path(__file__).resolve().parents[2] / "models"
GRAPH_FILE = "mobilenetv2-12.onnx"
CLASS_INDEX_FILE = "imagenet_class_index.json"
HEAD_FILE = "head.npz"
LABELS_FILE = "labels.txt"
HINT_FILE = "protein_hint.npz"
HINT_LABELS_FILE = "protein_hint_labels.txt"

#: Minimum probability before the raw-protein hint is reported at all.
#:
#: Measured on a held-out split: at 0.70 the hint fires on 88% of raw protein
#: and is correct 97% of the time when it does. Precision is what matters here
#: -- a wrong hint sends the user to the wrong shortlist, and staying quiet
#: costs only the shortlist, since naming the food manually still works.
HINT_MIN_CONFIDENCE = 0.70


class OnnxUnavailable(RuntimeError):
    """Raised when the ONNX runtime or the graph file is not usable."""


@dataclass(frozen=True)
class TrainedHead:
    """A linear classifier over the feature vector: ``softmax(x @ W + b)``."""

    weights: np.ndarray  # (features, classes)
    bias: np.ndarray  # (classes,)
    labels: list[str]

    def __post_init__(self) -> None:
        if self.weights.shape[1] != len(self.labels):
            raise ValueError(
                f"head has {self.weights.shape[1]} outputs but "
                f"{len(self.labels)} labels"
            )
        if self.bias.shape[0] != len(self.labels):
            raise ValueError(
                f"bias has {self.bias.shape[0]} entries but {len(self.labels)} labels"
            )


def softmax(x: np.ndarray) -> np.ndarray:
    """Numerically stable softmax over the last axis.

    Degenerate inputs return a uniform distribution rather than NaNs, because a
    NaN confidence does not raise -- it renders, as a percentage on the result
    screen.
    """
    # An all -inf vector makes the shift below inf - inf, so short-circuit it.
    if not np.isfinite(x).any():
        return np.full(x.shape, 1.0 / x.size, dtype=np.float64)

    exp = np.exp(x - np.max(x))
    total = exp.sum()
    if not np.isfinite(total) or total <= 0.0:
        return np.full(x.shape, 1.0 / x.size, dtype=np.float64)
    return exp / total


def preprocess(image_bgr: np.ndarray) -> np.ndarray:
    """BGR uint8 image -> normalised NCHW float32 batch of one."""
    import cv2  # noqa: PLC0415 -- imported lazily to keep scoring testable

    resized = cv2.resize(image_bgr, INPUT_SIZE, interpolation=cv2.INTER_AREA)
    rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    normalised = (rgb - _MEAN) / _STD
    return np.expand_dims(normalised.transpose(2, 0, 1), axis=0)


def load_class_index(models_dir: Path = MODELS_DIR) -> dict[int, str]:
    """ImageNet class index -> Keras-style label (e.g. 954 -> "banana")."""
    path = models_dir / CLASS_INDEX_FILE
    if not path.exists():
        raise OnnxUnavailable(f"missing {path}")
    raw = json.loads(path.read_text(encoding="utf-8"))
    return {int(k): str(v[1]) for k, v in raw.items()}


def load_head(
    models_dir: Path = MODELS_DIR,
    head_file: str = HEAD_FILE,
    labels_file: str = LABELS_FILE,
) -> TrainedHead | None:
    """Loads a trained linear head, or None when this build has none.

    Returning None rather than raising is deliberate: no head is the normal
    state, and it must degrade to ImageNet mode instead of disabling
    identification entirely.
    """
    head_path = models_dir / head_file
    labels_path = models_dir / labels_file
    if not head_path.exists() or not labels_path.exists():
        return None

    labels = [
        line.strip()
        for line in labels_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    with np.load(head_path) as data:
        weights = data["weights"].astype(np.float32)
        bias = data["bias"].astype(np.float32)

    head = TrainedHead(weights=weights, bias=bias, labels=labels)
    logger.info("Loaded trained head with %d labels", len(labels))
    return head


class OnnxFoodModel:
    """Owns the ONNX session. Loading is lazy and done once by the caller."""

    def __init__(self, models_dir: Path = MODELS_DIR) -> None:
        self._models_dir = models_dir
        self._session = None
        self._input_name = ""
        self.head: TrainedHead | None = None
        self.hint: TrainedHead | None = None
        self.class_index: dict[int, str] = {}

    def load(self) -> None:
        try:
            import onnxruntime as ort  # noqa: PLC0415
        except ImportError as exc:
            raise OnnxUnavailable(
                "onnxruntime is not installed, so food identification is "
                "unavailable. Install the backend requirements to enable it."
            ) from exc

        graph = self._models_dir / GRAPH_FILE
        if not graph.exists():
            raise OnnxUnavailable(f"missing model graph: {graph}")

        # One thread: serverless gives a single vCPU, and letting ORT spawn a
        # pool there costs more in contention than it saves.
        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1

        self._session = ort.InferenceSession(
            str(graph), options, providers=["CPUExecutionProvider"]
        )
        self._input_name = self._session.get_inputs()[0].name
        self.class_index = load_class_index(self._models_dir)
        self.head = load_head(self._models_dir)
        self.hint = load_head(self._models_dir, HINT_FILE, HINT_LABELS_FILE)

    @property
    def mode(self) -> str:
        return "custom" if self.head is not None else "imagenet"

    @property
    def version(self) -> str:
        if self.head is not None:
            return f"mobilenetv2-onnx+head:{len(self.head.labels)}"
        return "mobilenetv2-onnx-imagenet"

    def features(self, image_bgr: np.ndarray) -> np.ndarray:
        """Raw 1000-dimensional graph output, before any softmax."""
        if self._session is None:
            raise OnnxUnavailable("session not loaded")
        batch = preprocess(image_bgr)
        return np.asarray(self._session.run(None, {self._input_name: batch})[0])[0]

    def predict(self, image_bgr: np.ndarray) -> np.ndarray:
        """Class probabilities: the trained head's when present, else ImageNet's."""
        raw = self.features(image_bgr)
        if self.head is None:
            return softmax(raw)
        return softmax(raw @ self.head.weights + self.head.bias)

    def protein_hint_from_features(self, raw: np.ndarray) -> float | None:
        """The hint decision, given an already-computed feature vector.

        Kept separate from the graph so the thresholding rules can be tested
        without a 14 MB model file.
        """
        if self.hint is None:
            return None

        try:
            index = self.hint.labels.index("raw_protein")
        except ValueError:
            return None

        probs = softmax(raw @ self.hint.weights + self.hint.bias)
        confidence = float(probs[index])
        if confidence < HINT_MIN_CONFIDENCE or int(np.argmax(probs)) != index:
            return None
        return confidence

    def protein_hint(self, image_bgr: np.ndarray) -> float | None:
        """Probability the image shows raw meat, poultry or seafood.

        Returns None when the hint is unavailable or below the confidence
        floor. This is deliberately NOT identification: the same training data
        that separates raw protein from everything else at 86% cannot tell
        chicken from mutton at better than 36%, so the hint narrows the choices
        and the user still names the food.
        """
        if self.hint is None:
            return None
        return self.protein_hint_from_features(self.features(image_bgr))
