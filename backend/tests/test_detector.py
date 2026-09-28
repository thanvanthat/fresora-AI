"""Tests for multi-item food detection.

The geometry is tested without the 29 MB graph, because the mistakes that
matter here are silent ones: SSD emits (ymin, xmin, ymax, xmax) while the rest
of the app uses (x1, y1, x2, y2), and swapping them rotates every crop without
raising anything.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from app.vision.detector import (
    COCO_OTHER_FOOD,
    COCO_TO_FOOD,
    MAX_IOU,
    MIN_AREA_FRACTION,
    MIN_CONFIDENCE,
    Detection,
    FoodDetector,
    _iou,
    deduplicate,
)

MODEL_PRESENT = (
    Path(__file__).resolve().parents[1] / "models" / "ssd_mobilenet_v1_coco.onnx"
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
