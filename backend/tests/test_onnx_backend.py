"""Tests for the ONNX identification backend.

The pure maths is tested without the graph so these stay fast; the two tests
that need the real 14 MB model are skipped when it is absent, which keeps the
suite runnable on a checkout that has not fetched it.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from app.vision.onnx_backend import (
    MODELS_DIR,
    OnnxFoodModel,
    TrainedHead,
    load_head,
    preprocess,
    softmax,
)

GRAPH_PRESENT = (MODELS_DIR / "mobilenetv2-12.onnx").exists()
needs_graph = pytest.mark.skipif(GRAPH_PRESENT is False, reason="model graph not present")


class TestSoftmax:
    def test_sums_to_one(self) -> None:
        assert softmax(np.array([1.0, 2.0, 3.0])).sum() == pytest.approx(1.0)

    def test_is_shift_invariant(self) -> None:
        x = np.array([0.5, -2.0, 7.25])
        assert softmax(x) == pytest.approx(softmax(x + 1000.0))

    def test_survives_a_huge_input(self) -> None:
        # Without the max-shift this overflows to inf/inf = nan, and a NaN
        # confidence would reach the UI as a rendered value rather than an error.
        result = softmax(np.array([1e308, 1.0, 2.0]))
        assert np.isfinite(result).all()
        assert result.sum() == pytest.approx(1.0)

    def test_degenerate_input_stays_finite(self) -> None:
        result = softmax(np.array([-np.inf, -np.inf]))
        assert np.isfinite(result).all()
        assert result.sum() == pytest.approx(1.0)

    def test_picks_the_largest(self) -> None:
        assert int(np.argmax(softmax(np.array([0.1, 9.9, 0.3])))) == 1


class TestTrainedHead:
    def test_accepts_consistent_shapes(self) -> None:
        head = TrainedHead(
            weights=np.zeros((1000, 3), dtype=np.float32),
            bias=np.zeros(3, dtype=np.float32),
            labels=["chicken", "fish", "prawn"],
        )
        assert len(head.labels) == 3

    def test_rejects_a_label_count_mismatch(self) -> None:
        # A head and a labels.txt that disagree would silently mislabel every
        # prediction, so this has to fail at load rather than at inference.
        with pytest.raises(ValueError, match="2 outputs but 3 labels"):
            TrainedHead(
                weights=np.zeros((1000, 2), dtype=np.float32),
                bias=np.zeros(2, dtype=np.float32),
                labels=["chicken", "fish", "prawn"],
            )

    def test_rejects_a_bias_mismatch(self) -> None:
        with pytest.raises(ValueError, match="bias has 5 entries"):
            TrainedHead(
                weights=np.zeros((1000, 2), dtype=np.float32),
                bias=np.zeros(5, dtype=np.float32),
                labels=["chicken", "fish"],
            )


class TestLoadHead:
    def test_returns_none_when_absent(self, tmp_path: Path) -> None:
        # No head is the normal state and must degrade to ImageNet mode.
        assert load_head(tmp_path) is None

    def test_returns_none_when_labels_are_missing(self, tmp_path: Path) -> None:
        np.savez(
            tmp_path / "head.npz",
            weights=np.zeros((1000, 2), dtype=np.float32),
            bias=np.zeros(2, dtype=np.float32),
        )
        assert load_head(tmp_path) is None

    def test_round_trips_a_saved_head(self, tmp_path: Path) -> None:
        weights = np.arange(2000, dtype=np.float32).reshape(1000, 2)
        np.savez(
            tmp_path / "head.npz", weights=weights, bias=np.array([0.5, -0.5], np.float32)
        )
        (tmp_path / "labels.txt").write_text("chicken\nfish\n", encoding="utf-8")

        head = load_head(tmp_path)

        assert head is not None
        assert head.labels == ["chicken", "fish"]
        assert head.weights.shape == (1000, 2)
        assert head.bias[0] == pytest.approx(0.5)

    def test_ignores_blank_label_lines(self, tmp_path: Path) -> None:
        np.savez(
            tmp_path / "head.npz",
            weights=np.zeros((1000, 2), dtype=np.float32),
            bias=np.zeros(2, dtype=np.float32),
        )
        (tmp_path / "labels.txt").write_text("chicken\n\nfish\n\n", encoding="utf-8")

        head = load_head(tmp_path)

        assert head is not None
        assert head.labels == ["chicken", "fish"]


class TestPreprocess:
    def test_produces_the_graph_input_shape(self) -> None:
        image = np.full((480, 640, 3), 128, dtype=np.uint8)
        assert preprocess(image).shape == (1, 3, 224, 224)

    def test_normalises_rather_than_passing_raw_bytes(self) -> None:
        # Feeding 0-255 straight in would not fail, it would just make every
        # prediction wrong, so assert the range actually moved.
        batch = preprocess(np.full((224, 224, 3), 255, dtype=np.uint8))
        assert batch.max() < 3.0
        assert batch.dtype == np.float32

    def test_handles_a_non_square_image(self) -> None:
        assert preprocess(np.zeros((100, 700, 3), np.uint8)).shape == (1, 3, 224, 224)


@needs_graph
class TestRealGraph:
    def test_loads_in_imagenet_mode_without_a_head(self) -> None:
        model = OnnxFoodModel()
        model.load()

        assert model.mode == "imagenet"
        assert model.version == "mobilenetv2-onnx-imagenet"
        assert len(model.class_index) == 1000
        assert model.class_index[954] == "banana"

    def test_predicts_a_probability_distribution(self) -> None:
        model = OnnxFoodModel()
        model.load()

        probs = model.predict(np.full((224, 224, 3), 200, dtype=np.uint8))

        assert probs.shape == (1000,)
        assert probs.sum() == pytest.approx(1.0, abs=1e-5)
        assert (probs >= 0).all()
