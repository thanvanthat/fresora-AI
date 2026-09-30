"""Tests for multi-item food detection.

The geometry is tested without the 20 MB graph, because the mistakes that
matter here are silent ones. YOLOX emits grid-relative (cx, cy, w, h) that has
to be decoded with the right stride and mapped back through the letterbox
scale; every wrong variant still returns plausible-looking boxes in the wrong
places rather than raising.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from app.vision.detector import (
    COCO_OTHER_FOOD,
    COCO_TO_FOOD,
    INPUT_SIZE,
    MAX_IOU,
    MIN_AREA_FRACTION,
    MIN_CONFIDENCE,
    PAD_VALUE,
    STRIDES,
    Detection,
    FoodDetector,
    _iou,
    decode,
    deduplicate,
    letterbox,
)

MODEL_PRESENT = (
    Path(__file__).resolve().parents[1] / "models" / "yolox_tiny.onnx"
).exists()
needs_model = pytest.mark.skipif(not MODEL_PRESENT, reason="detector model not present")


def _detection(box: tuple[float, float, float, float], confidence: float = 0.9) -> Detection:
    return Detection(
        food_name="Banana", raw_label="banana", confidence=confidence, box=box
    )


class TestIou:
    def test_identical_boxes_overlap_completely(self) -> None:
        box = (0.1, 0.1, 0.5, 0.5)
        assert _iou(box, box) == pytest.approx(1.0)

    def test_disjoint_boxes_do_not_overlap(self) -> None:
        assert _iou((0.0, 0.0, 0.2, 0.2), (0.5, 0.5, 0.9, 0.9)) == 0.0

    def test_touching_edges_do_not_overlap(self) -> None:
        assert _iou((0.0, 0.0, 0.5, 0.5), (0.5, 0.0, 1.0, 0.5)) == 0.0

    def test_half_overlap(self) -> None:
        # Two unit-ish boxes sharing exactly half their area.
        value = _iou((0.0, 0.0, 0.4, 0.2), (0.2, 0.0, 0.6, 0.2))
        assert value == pytest.approx(1 / 3)

    def test_zero_area_box_does_not_divide_by_zero(self) -> None:
        assert _iou((0.5, 0.5, 0.5, 0.5), (0.0, 0.0, 1.0, 1.0)) == 0.0


class TestDeduplicate:
    def test_keeps_distinct_items(self) -> None:
        items = [
            _detection((0.0, 0.0, 0.3, 0.3), 0.9),
            _detection((0.6, 0.6, 0.9, 0.9), 0.8),
        ]
        assert len(deduplicate(items)) == 2

    def test_drops_a_box_overlapping_a_more_confident_one(self) -> None:
        """The same fruit returned under two classes must not be counted twice."""
        items = [
            _detection((0.10, 0.10, 0.50, 0.50), 0.9),
            _detection((0.11, 0.11, 0.51, 0.51), 0.5),
        ]
        kept = deduplicate(items)

        assert len(kept) == 1
        assert kept[0].confidence == 0.9  # the confident one survives

    def test_keeps_items_that_merely_touch(self) -> None:
        # Fruit in a bowl sits edge to edge; that is two items, not one.
        items = [
            _detection((0.0, 0.0, 0.40, 0.4), 0.9),
            _detection((0.38, 0.0, 0.78, 0.4), 0.8),
        ]
        assert len(deduplicate(items)) == 2

    def test_threshold_is_loose_enough_to_be_doing_work(self) -> None:
        assert 0.3 < MAX_IOU < 0.8

    def test_empty_input(self) -> None:
        assert deduplicate([]) == []


class TestCrop:
    def test_crops_the_right_region(self) -> None:
        # A frame that is black except for a white square in the bottom-right.
        frame = np.zeros((100, 100, 3), dtype=np.uint8)
        frame[50:100, 50:100] = 255

        crop = _detection((0.5, 0.5, 1.0, 1.0)).crop(frame, pad=0.0)

        assert crop.shape[0] == 50 and crop.shape[1] == 50
        assert crop.mean() == pytest.approx(255.0)

    def test_x_and_y_are_not_transposed(self) -> None:
        """A wide box must produce a wide crop.

        If (x1, y1, x2, y2) were read as (y1, x1, y2, x2) this crop would come
        back tall, and every measurement would describe the wrong region.
        """
        frame = np.zeros((200, 400, 3), dtype=np.uint8)

        crop = _detection((0.0, 0.0, 1.0, 0.5)).crop(frame, pad=0.0)

        assert crop.shape[1] > crop.shape[0]  # wider than tall

    def test_padding_expands_the_crop(self) -> None:
        """Bruising shows first at the edge, which a tight box clips."""
        frame = np.zeros((200, 200, 3), dtype=np.uint8)

        tight = _detection((0.25, 0.25, 0.75, 0.75)).crop(frame, pad=0.0)
        padded = _detection((0.25, 0.25, 0.75, 0.75)).crop(frame, pad=0.1)

        assert padded.shape[0] > tight.shape[0]

    def test_padding_is_clamped_to_the_frame(self) -> None:
        frame = np.zeros((100, 100, 3), dtype=np.uint8)

        crop = _detection((0.0, 0.0, 1.0, 1.0)).crop(frame, pad=0.5)

        assert crop.shape[0] <= 100 and crop.shape[1] <= 100

    def test_a_degenerate_box_returns_the_frame_not_an_empty_array(self) -> None:
        """An empty array would fail deep inside OpenCV instead of here."""
        frame = np.zeros((100, 100, 3), dtype=np.uint8)

        crop = _detection((0.5, 0.5, 0.5, 0.5)).crop(frame, pad=0.0)

        assert crop.size > 0


class TestClassMapping:
    def test_known_foods_map_to_knowledge_base_names(self) -> None:
        from app.knowledge.service import knowledge

        for name in COCO_TO_FOOD.values():
            assert knowledge.resolve(name) is not None, f"{name} not in knowledge base"

    def test_known_and_unknown_maps_do_not_overlap(self) -> None:
        assert not set(COCO_TO_FOOD) & set(COCO_OTHER_FOOD)

    def test_detection_reports_whether_it_is_known(self) -> None:
        known = Detection("Banana", "banana", 0.9, (0.0, 0.0, 1.0, 1.0))
        unknown = Detection(None, "pizza", 0.9, (0.0, 0.0, 1.0, 1.0))

        assert known.known is True
        assert unknown.known is False


class TestLetterbox:
    """Preprocessing failures here are silent: the model still returns boxes,
    they are just wrong."""

    def test_output_is_the_graph_input_shape(self) -> None:
        batch, _ = letterbox(np.zeros((480, 640, 3), np.uint8))
        assert batch.shape == (1, 3, INPUT_SIZE, INPUT_SIZE)

    def test_aspect_ratio_is_preserved(self) -> None:
        """Stretching a wide photo square would squash every object in it."""
        wide = np.zeros((100, 400, 3), np.uint8)
        _, ratio = letterbox(wide)
        # The long edge governs: 416/400, not 416/100.
        assert ratio == pytest.approx(INPUT_SIZE / 400)

    def test_padding_uses_the_trained_fill_value(self) -> None:
        # Bottom-right stays padding for a wide image.
        batch, _ = letterbox(np.zeros((100, 400, 3), np.uint8))
        assert batch[0, 0, INPUT_SIZE - 1, INPUT_SIZE - 1] == pytest.approx(PAD_VALUE)

    def test_pixels_are_not_normalised(self) -> None:
        """YOLOX takes raw 0-255. ImageNet normalisation would not error --
        it would just make every prediction wrong."""
        batch, _ = letterbox(np.full((416, 416, 3), 200, np.uint8))
        assert batch.max() > 1.5  # still in 0-255 space, not scaled to 0-1

    def test_square_input_is_not_scaled(self) -> None:
        _, ratio = letterbox(np.zeros((INPUT_SIZE, INPUT_SIZE, 3), np.uint8))
        assert ratio == pytest.approx(1.0)


class TestDecode:
    """YOLOX predicts an offset within a grid cell, not an absolute position.

    Skipping the grid/stride step clusters every box in the top-left corner,
    which reads as a broken model rather than a missing step.
    """

    def _anchors(self) -> int:
        return sum((INPUT_SIZE // s) ** 2 for s in STRIDES)

    def test_anchor_count_matches_the_graph_output(self) -> None:
        # 52^2 + 26^2 + 13^2 = 3549, the middle axis of the model's output.
        assert self._anchors() == 3549

    def test_the_first_cell_maps_to_the_origin(self) -> None:
        raw = np.zeros((self._anchors(), 85), dtype=np.float32)
        decoded = decode(raw)
        # Cell (0,0) at stride 8 with zero offset: centre stays at 0.
        assert decoded[0, 0] == pytest.approx(0.0)
        assert decoded[0, 1] == pytest.approx(0.0)

    def test_offsets_are_scaled_by_stride(self) -> None:
        raw = np.zeros((self._anchors(), 85), dtype=np.float32)
        raw[1, 0] = 0.5  # half a cell right, in the second stride-8 cell
        decoded = decode(raw)
        # Cell index 1 is x=1, so (0.5 + 1) * 8 = 12.
        assert decoded[1, 0] == pytest.approx(12.0)

    def test_width_and_height_are_exponentiated(self) -> None:
        raw = np.zeros((self._anchors(), 85), dtype=np.float32)
        decoded = decode(raw)
        # exp(0) * 8 = 8 for the first stride.
        assert decoded[0, 2] == pytest.approx(8.0)

    def test_later_strides_use_larger_cells(self) -> None:
        raw = np.zeros((self._anchors(), 85), dtype=np.float32)
        decoded = decode(raw)
        first_of_stride_32 = (INPUT_SIZE // 8) ** 2 + (INPUT_SIZE // 16) ** 2
        assert decoded[first_of_stride_32, 2] == pytest.approx(32.0)


class TestThresholds:
    def test_confidence_floor_is_set(self) -> None:
        assert 0.2 < MIN_CONFIDENCE < 0.7

    def test_tiny_boxes_are_excluded(self) -> None:
        # Too small a crop cannot support a surface measurement, so detecting
        # it would promise an assessment it cannot deliver.
        assert 0.0 < MIN_AREA_FRACTION < 0.1


@needs_model
class TestRealModel:
    def test_loads_and_finds_nothing_in_a_blank_frame(self) -> None:
        detector = FoodDetector()
        detector.load()

        assert detector.available
        # A flat grey frame holds no food; an empty list is the right answer.
        assert detector.detect(np.full((300, 300, 3), 128, np.uint8)) == []

    def test_respects_the_item_cap(self) -> None:
        detector = FoodDetector()
        detector.load()

        items = detector.detect(np.full((300, 300, 3), 128, np.uint8), max_items=3)

        assert len(items) <= 3
