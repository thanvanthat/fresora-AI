"""Train a food-identification head, including classes ImageNet cannot name.

WHY THIS EXISTS
---------------
Stock MobileNetV2 identifies the fruit and vegetables in ImageNet-1k. It has no
class for raw chicken, mutton, beef, fish or prawn, nor for tomato, potato,
onion, spinach, carrot or mango, so those photos can never be identified by the
stock graph no matter how they are preprocessed. Naming them needs a model that
has actually seen them.

Rather than fine-tune the whole network -- which needs a GPU, a large dataset
and a framework too big to deploy -- this trains a single linear layer on top
of the frozen graph's output. That is ordinary transfer learning, and it is
enough because the frozen features already encode colour, texture and shape;
the head only has to carve the feature space into your classes.

WHAT IT COSTS
-------------
Roughly 100-300 photos per class is a sensible floor, and more helps most for
classes that look alike (chicken vs fish). Training is CPU-only and takes
seconds to a couple of minutes. The saved head is a few hundred kilobytes, so
deploying it does not threaten the serverless size budget.

COLLECTING IMAGES
-----------------
Shoot them the way the app will see them: whole item roughly filling the frame,
ordinary kitchen lighting, varied backgrounds and angles. A set shot in one
session on one worktop teaches the head to recognise your worktop. Include the
awkward cases -- part-wrapped, on a plate, in poor light -- or the model will
be confident exactly where it should not be.

USAGE
-----
    data/
      chicken/   img001.jpg ...
      mutton/    ...
      fish/      ...
      prawn/     ...
      tomato/    ...

    python scripts/train_food_head.py --data data --out models

Writes models/head.npz and models/labels.txt. The API picks them up on the next
start and switches from "imagenet" to "custom" mode automatically.

A HEALTH WARNING
----------------
Fresora caps the freshness score for meat, poultry, seafood and dairy because a
photograph cannot establish whether those are safe to eat. Identifying them
automatically does not change that, and this script deliberately does not
provide a way to lift the cap.
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

import numpy as np

# Import the app package when run as a script from the backend directory.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.vision.onnx_backend import OnnxFoodModel, softmax  # noqa: E402

logger = logging.getLogger("train_food_head")

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def discover(data_dir: Path) -> tuple[list[Path], list[int], list[str]]:
    """Maps ``data/<label>/<image>`` into paths, indices and the label list."""
    labels = sorted(p.name for p in data_dir.iterdir() if p.is_dir())
    if len(labels) < 2:
        raise SystemExit(
            f"need at least two class folders in {data_dir}, found {len(labels)}"
        )

    paths: list[Path] = []
    targets: list[int] = []
    for index, label in enumerate(labels):
        files = [
            p
            for p in sorted((data_dir / label).iterdir())
            if p.suffix.lower() in IMAGE_SUFFIXES
        ]
        if not files:
            raise SystemExit(f"class '{label}' has no images")
        paths.extend(files)
        targets.extend([index] * len(files))
        logger.info("  %-14s %d images", label, len(files))

    return paths, targets, labels


def extract_features(model: OnnxFoodModel, paths: list[Path]) -> np.ndarray:
    """Runs every image through the frozen graph once."""
    import cv2

    features = []
    for i, path in enumerate(paths, 1):
        image = cv2.imread(str(path))
        if image is None:
            raise SystemExit(f"could not read {path}")
        features.append(model.features(image))
        if i % 50 == 0 or i == len(paths):
            logger.info("  embedded %d/%d", i, len(paths))
    return np.stack(features)


def train(
    features: np.ndarray,
    targets: np.ndarray,
    n_classes: int,
    *,
    epochs: int,
    lr: float,
    weight_decay: float,
) -> tuple[np.ndarray, np.ndarray]:
    """Multinomial logistic regression by full-batch gradient descent.

    Written out rather than pulled from scikit-learn to keep the training
    dependency set identical to the serving one: numpy and onnxruntime. The
    problem is tiny and convex, so plain gradient descent is sufficient and
    there is nothing to tune beyond the learning rate.
    """
    n_samples, n_features = features.shape

    # Standardise: the graph's outputs have a wide dynamic range, and without
    # this the first steps overshoot badly.
    mean = features.mean(axis=0)
    std = features.std(axis=0)
    std[std < 1e-6] = 1.0
    x = (features - mean) / std

    onehot = np.zeros((n_samples, n_classes), dtype=np.float32)
    onehot[np.arange(n_samples), targets] = 1.0

    rng = np.random.default_rng(0)  # deterministic: same data, same head
    w = rng.normal(0.0, 0.01, size=(n_features, n_classes)).astype(np.float32)
    b = np.zeros(n_classes, dtype=np.float32)

    for epoch in range(1, epochs + 1):
        logits = x @ w + b
        logits -= logits.max(axis=1, keepdims=True)
        exp = np.exp(logits)
        probs = exp / exp.sum(axis=1, keepdims=True)

        error = (probs - onehot) / n_samples
        w -= lr * (x.T @ error + weight_decay * w)
        b -= lr * error.sum(axis=0)

        if epoch % 100 == 0 or epoch == epochs:
            loss = -np.log(np.clip(probs[np.arange(n_samples), targets], 1e-9, None))
            accuracy = (probs.argmax(axis=1) == targets).mean()
            logger.info(
                "  epoch %4d  loss %.4f  train accuracy %.1f%%",
                epoch,
                loss.mean(),
                accuracy * 100,
            )

    # Fold the standardisation into the weights so inference stays a single
    # matmul and the serving code needs no knowledge of how this was trained.
    folded_w = (w.T / std).T.astype(np.float32)
    folded_b = (b - (mean / std) @ w).astype(np.float32)
    return folded_w, folded_b


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, required=True, help="dataset root")
    parser.add_argument("--out", type=Path, default=Path("models"))
    parser.add_argument("--epochs", type=int, default=1500)
    parser.add_argument("--lr", type=float, default=0.5)
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument(
        "--holdout",
        type=float,
        default=0.2,
        help="fraction held out to report honest accuracy (0 to disable)",
    )
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")

    if not args.data.is_dir():
        raise SystemExit(f"no such directory: {args.data}")

    logger.info("Classes:")
    paths, targets_list, labels = discover(args.data)
    targets = np.asarray(targets_list)

    logger.info("Loading frozen graph...")
    model = OnnxFoodModel()
    model.load()

    logger.info("Extracting features from %d images...", len(paths))
    features = extract_features(model, paths)

    # Hold out a stratified slice, so the accuracy printed at the end is
    # measured on images the head never saw. Training accuracy alone would
    # look excellent on any dataset and mean nothing.
    rng = np.random.default_rng(0)
    train_idx, test_idx = [], []
    for c in range(len(labels)):
        idx = np.where(targets == c)[0]
        rng.shuffle(idx)
        cut = int(len(idx) * args.holdout) if args.holdout > 0 else 0
        test_idx.extend(idx[:cut])
        train_idx.extend(idx[cut:])

    train_idx = np.asarray(train_idx)
    test_idx = np.asarray(test_idx)

    logger.info("Training on %d images...", len(train_idx))
    w, b = train(
        features[train_idx],
        targets[train_idx],
        len(labels),
        epochs=args.epochs,
        lr=args.lr,
        weight_decay=args.weight_decay,
    )

    if len(test_idx) > 0:
        predicted = np.array(
            [int(np.argmax(softmax(features[i] @ w + b))) for i in test_idx]
        )
        accuracy = (predicted == targets[test_idx]).mean()
        logger.info("")
        logger.info("Held-out accuracy: %.1f%% on %d images", accuracy * 100, len(test_idx))
        for c, label in enumerate(labels):
            mask = targets[test_idx] == c
            if mask.any():
                logger.info(
                    "  %-14s %.1f%%", label, (predicted[mask] == c).mean() * 100
                )
        if accuracy < 0.7:
            logger.warning(
                "\nThat is low. More images, or more varied ones, will help more "
                "than more epochs. Do not ship a head you would not trust."
            )

    args.out.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(args.out / "head.npz", weights=w, bias=b)
    (args.out / "labels.txt").write_text("\n".join(labels) + "\n", encoding="utf-8")

    logger.info("")
    logger.info("Wrote %s and %s", args.out / "head.npz", args.out / "labels.txt")
    logger.info("Restart the API to pick them up.")


if __name__ == "__main__":
    main()
