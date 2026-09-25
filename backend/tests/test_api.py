"""HTTP-level tests: the real FastAPI app, real routes, real image bytes.

Nothing is mocked except the LLM provider (which would otherwise need a network
call and a key). Run with::

    pytest backend/tests/test_api.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

pytest.importorskip("fastapi", reason="backend requirements not installed")
cv2 = pytest.importorskip("cv2", reason="opencv not installed")

import numpy as np  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.main import app  # noqa: E402
from app.schemas import SAFETY_NOTICE  # noqa: E402

PREFIX = get_settings().api_prefix


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(app)


def _jpeg(colour: tuple[int, int, int] = (36, 28, 200), spots: int = 0) -> bytes:
    """A synthetic food photo: a coloured disc on a light background."""
    image = np.full((480, 480, 3), 225, dtype=np.uint8)
    cv2.circle(image, (240, 240), 150, colour, -1)

    if spots:
        rng = np.random.default_rng(99)
        for _ in range(spots):
            angle = rng.uniform(0, 2 * np.pi)
            distance = rng.uniform(0, 110)
            x = int(240 + np.cos(angle) * distance)
            y = int(240 + np.sin(angle) * distance)
            cv2.circle(image, (x, y), int(rng.uniform(10, 18)), (18, 16, 22), -1)

    ok, buffer = cv2.imencode(".jpg", image)
    assert ok
    return buffer.tobytes()


def _upload(data: bytes, name: str = "food.jpg") -> dict:
    return {"image": (name, data, "image/jpeg")}


# --- Meta -----------------------------------------------------------------


def test_health_reports_real_capability(client: TestClient) -> None:
    response = client.get(f"{PREFIX}/health")
    assert response.status_code == 200

    body = response.json()
    assert body["status"] == "ok"
    assert body["known_foods"] > 20
    # These must reflect reality, not optimism. Identification now ships with
    # the bundled ONNX graph, so it is genuinely available; no LLM key is set,
    # so that stays False.
    assert body["classifier_available"] is True
    assert body["llm_configured"] is False
    assert body["classifier_mode"] == "imagenet"


def test_root_points_at_the_docs(client: TestClient) -> None:
    body = client.get("/").json()
    assert body["docs"] == "/docs"


def test_openapi_schema_builds(client: TestClient) -> None:
    """A broken response model shows up here before it reaches the app."""
    response = client.get("/openapi.json")
    assert response.status_code == 200
    assert f"{PREFIX}/analyze" in response.json()["paths"]


# --- Analysis -------------------------------------------------------------


def test_analyze_with_a_named_food_returns_a_real_assessment(client: TestClient) -> None:
    response = client.post(
        f"{PREFIX}/analyze",
        files=_upload(_jpeg()),
        data={"food_name": "Tomato"},
    )
    assert response.status_code == 200, response.text

    body = response.json()
    assert body["food_name"] == "Tomato"
    assert body["category"] == "vegetable"
    assert body["status"] == "fresh"
    assert 80 <= body["score"] <= 100
    assert body["identified"] is True
    assert body["scoring_method"] == "opencv-heuristic-v1"
    assert body["safety_notice"] == SAFETY_NOTICE

    # Measured, not asserted: processing_ms must be a real elapsed figure.
    assert isinstance(body["processing_ms"], int)
    assert 0 <= body["processing_ms"] < 60_000

    metrics = body["visual_metrics"]
    assert metrics["defect_coverage"] is not None
    assert metrics["texture_uniformity"] is not None
    # Tomato is chromatic, so browning must be null rather than misleading.
    assert metrics["browning_index"] is None

    for key in ("color", "texture", "surface", "ripeness"):
        assert body["visual_narrative"][key]

    assert body["storage_recommendation"]["storage_type"] == "counter"
    assert body["recommended_action"]
    assert body["reasoning"]


def test_analyze_reflects_a_deteriorated_surface(client: TestClient) -> None:
    clean = client.post(
        f"{PREFIX}/analyze", files=_upload(_jpeg()), data={"food_name": "Tomato"}
    ).json()
    spotted = client.post(
        f"{PREFIX}/analyze", files=_upload(_jpeg(spots=26)), data={"food_name": "Tomato"}
    ).json()

    assert spotted["score"] < clean["score"]
    assert spotted["visual_metrics"]["defect_coverage"] > clean["visual_metrics"]["defect_coverage"]


def test_analyze_without_a_name_does_not_guess(client: TestClient) -> None:
    """A flat test image is not food, and the response must say so.

    The classifier runs, so this no longer 503s. What matters is that an
    unrecognised item comes back explicitly unidentified and unscored rather
    than being assigned a plausible-looking name and a freshness number.
    """
    response = client.post(f"{PREFIX}/analyze", files=_upload(_jpeg()))
    assert response.status_code == 200

    body = response.json()
    assert body["identified"] is False
    assert body["status"] == "unknown"
    assert body["score"] == 0
    assert body["confidence"] == 0.0
    assert body["scoring_method"] == "not-scored"
    # The user needs to know what to do next, not just that it failed.
    assert "name" in body["recommended_action"].lower()


def test_high_risk_food_is_capped_over_http(client: TestClient) -> None:
    """A pristine photo of chicken must never come back as Fresh."""
    response = client.post(
        f"{PREFIX}/analyze",
        files=_upload(_jpeg(colour=(150, 150, 225))),
        data={"food_name": "Chicken"},
    )
    body = response.json()
    assert body["score"] <= 72
    assert body["status"] != "fresh"
    assert "smell" in body["recommended_action"].lower()


def test_unknown_food_gets_generic_guidance_and_says_so(client: TestClient) -> None:
    response = client.post(
        f"{PREFIX}/analyze",
        files=_upload(_jpeg()),
        data={"food_name": "Dragonfruit", "category_hint": "fruit"},
    )
    assert response.status_code == 200

    body = response.json()
    assert body["food_name"] == "Dragonfruit"
    assert body["category"] == "fruit"
    assert body["note"] is not None
    assert "no reference data" in body["note"].lower()


def test_analyze_rejects_a_non_image(client: TestClient) -> None:
    response = client.post(
        f"{PREFIX}/analyze",
        files={"image": ("notes.txt", b"this is not an image", "text/plain")},
    )
    assert response.status_code == 415
    assert response.json()["detail"]["code"] == "unsupported_image"


def test_analyze_rejects_undecodable_bytes(client: TestClient) -> None:
    response = client.post(
        f"{PREFIX}/analyze",
        files={"image": ("broken.jpg", b"\xff\xd8\xff garbage", "image/jpeg")},
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_image"


def test_analyze_rejects_an_oversized_upload(client: TestClient) -> None:
    settings = get_settings()
    oversized = b"\xff\xd8\xff" + b"\x00" * (settings.max_upload_bytes + 1024)
    response = client.post(
        f"{PREFIX}/analyze", files={"image": ("big.jpg", oversized, "image/jpeg")}
    )
    assert response.status_code == 413
    assert response.json()["detail"]["code"] == "image_too_large"


def test_vision_analysis_returns_measurements_only(client: TestClient) -> None:
    response = client.post(
        f"{PREFIX}/food/vision-analysis",
        files=_upload(_jpeg()),
        data={"food_name": "Tomato"},
    )
    assert response.status_code == 200

    body = response.json()
    assert body["mask_source"] == "saturation-otsu"
    assert 0 < body["mask_fraction"] < 1
    assert body["visual_metrics"]["color_consistency"] is not None
    # No score and no status on this endpoint.
    assert "score" not in body
    assert "status" not in body


def test_identify_reports_an_unrecognised_item_rather_than_guessing(
    client: TestClient,
) -> None:
    """The bundled graph runs, so a flat colour must come back unidentified."""
    response = client.post(f"{PREFIX}/food/identify", files=_upload(_jpeg()))
    assert response.status_code == 200

    body = response.json()
    assert body["identified"] is False
    assert body["food_name"] is None or body["food_name"] == ""


# --- Shelf life and storage ----------------------------------------------


def test_shelf_life_for_a_known_food(client: TestClient) -> None:
    response = client.post(
        f"{PREFIX}/shelf-life",
        json={"food_name": "Spinach", "status": "fresh", "score": 92},
    )
    assert response.status_code == 200

    body = response.json()
    assert body["food_name"] == "Spinach"
    assert body["storage_type"] == "refrigerated"
    assert body["typical_window"] == {"min_days": 3, "max_days": 7}
    assert body["estimated_window"]["max_days"] <= 7
    assert body["is_estimate"] is True


def test_shelf_life_for_a_spoiled_item_is_zero(client: TestClient) -> None:
    body = client.post(
        f"{PREFIX}/shelf-life",
        json={"food_name": "Spinach", "status": "spoiled", "score": 8},
    ).json()
    assert body["estimated_window"] == {"min_days": 0, "max_days": 0}
    assert "not consume" in body["recommended_action"].lower()


def test_shelf_life_for_an_unknown_food_is_flagged(client: TestClient) -> None:
    body = client.post(f"{PREFIX}/shelf-life", json={"food_name": "Dragonfruit"}).json()
    assert body["typical_window"] is None
    assert body["note"] is not None


def test_storage_recommendation_is_curated(client: TestClient) -> None:
    body = client.post(f"{PREFIX}/storage-recommendation", json={"food_name": "Potato"}).json()
    assert body["known"] is True
    assert body["recommendation"]["storage_type"] == "pantry"
    # The curated warning about refrigerating potatoes must survive.
    joined = " ".join(body["recommendation"]["details"]).lower()
    assert "not refrigerate" in joined or "do not refrigerate" in joined
    assert body["nutrition"]
    assert body["recipe_uses"]


def test_storage_recommendation_for_unknown_food_is_conservative(client: TestClient) -> None:
    body = client.post(
        f"{PREFIX}/storage-recommendation", json={"food_name": "Dragonfruit"}
    ).json()
    assert body["known"] is False
    assert body["recommendation"]["storage_type"] == "refrigerated"
    assert body["note"] is not None


# --- Knowledge ------------------------------------------------------------


def test_knowledge_list(client: TestClient) -> None:
    body = client.get(f"{PREFIX}/knowledge/foods").json()
    assert body["count"] == len(body["foods"])
    assert "Tomato" in body["foods"]
    assert body["pantry"]


def test_knowledge_detail(client: TestClient) -> None:
    body = client.get(f"{PREFIX}/knowledge/foods/spinach").json()
    assert body["name"] == "Spinach"
    assert body["shelf_life_days"]["refrigerated"] == [3, 7]


def test_knowledge_detail_404s_for_unknown(client: TestClient) -> None:
    response = client.get(f"{PREFIX}/knowledge/foods/dragonfruit")
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "unknown_food"


# --- Recipes --------------------------------------------------------------


def test_recipes_generate_uses_the_rules_engine_without_a_key(client: TestClient) -> None:
    response = client.post(
        f"{PREFIX}/recipes/generate",
        json={
            "servings": 2,
            "inventory": [
                {"id": "1", "food_name": "Tomato", "status": "nearly_spoiled",
                 "estimated_remaining_days": 1},
                {"id": "2", "food_name": "Spinach", "status": "nearly_spoiled",
                 "estimated_remaining_days": 1},
                {"id": "3", "food_name": "Bread", "status": "fresh", "category": "bakery"},
            ],
        },
    )
    assert response.status_code == 200, response.text

    body = response.json()
    assert body["source"] == "rules"
    assert body["title"] == "Tomato Spinach Toast"
    assert sorted(body["rescued_item_ids"]) == ["1", "2"]
    assert body["instructions"]
    assert body["safety_notice"] == SAFETY_NOTICE


def test_recipes_exclude_spoiled_items_over_http(client: TestClient) -> None:
    body = client.post(
        f"{PREFIX}/recipes/generate",
        json={
            "inventory": [
                {"id": "1", "food_name": "Tomato", "status": "fresh"},
                {"id": "2", "food_name": "Spinach", "status": "spoiled"},
                {"id": "3", "food_name": "Bread", "status": "fresh", "category": "bakery"},
            ]
        },
    ).json()

    assert "2" in body["excluded_item_ids"]
    names = {ing["ingredient_name"].lower() for ing in body["ingredients"]}
    assert "spinach" not in names
    # The exclusion must always be communicated.
    assert body["note"] is not None and "spoiled" in body["note"].lower()


def test_recipes_reject_empty_inventory(client: TestClient) -> None:
    response = client.post(f"{PREFIX}/recipes/generate", json={"inventory": []})
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "empty_inventory"


def test_recipes_validate_the_payload(client: TestClient) -> None:
    response = client.post(
        f"{PREFIX}/recipes/generate",
        json={"inventory": [{"id": "1", "food_name": "   "}]},
    )
    assert response.status_code == 422


# --- Assistant ------------------------------------------------------------


def test_assistant_answers_from_knowledge_without_a_key(client: TestClient) -> None:
    response = client.post(
        f"{PREFIX}/assistant/chat",
        json={
            "message": "How should I store this?",
            "context": {"current_food": "Spinach", "current_status": "fresh"},
        },
    )
    assert response.status_code == 200

    body = response.json()
    assert body["source"] == "knowledge"
    assert "Spinach" in body["grounded_on"]
    # The curated advice, not invented advice.
    assert "dry" in body["reply"].lower()
    # And the standing caveat.
    assert "cannot verify food safety" in body["reply"].lower()


def test_assistant_handles_a_freezing_question(client: TestClient) -> None:
    body = client.post(
        f"{PREFIX}/assistant/chat",
        json={"message": "Can I freeze it?", "context": {"current_food": "Spinach"}},
    ).json()
    assert "240" in body["reply"] or "freez" in body["reply"].lower()


def test_assistant_admits_when_it_has_no_data(client: TestClient) -> None:
    body = client.post(
        f"{PREFIX}/assistant/chat",
        json={"message": "How do I store dragonfruit?"},
    ).json()
    assert body["grounded_on"] == []
    assert "do not have curated data" in body["reply"].lower()


def test_assistant_rejects_an_empty_message(client: TestClient) -> None:
    response = client.post(f"{PREFIX}/assistant/chat", json={"message": ""})
    assert response.status_code == 422
