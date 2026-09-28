"""Analysis endpoints: identify, measure, score, recommend."""

from __future__ import annotations

import logging
import time

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from ..config import get_settings
from ..freshness import HIGH_RISK_CATEGORIES, assess, estimate_window
from ..knowledge.food_data import browning_applicable
from ..knowledge.service import knowledge
from ..narrative import action_for, build_narrative
from ..schemas import (
    SAFETY_NOTICE,
    AlternativeMatch,
    AnalysisResponse,
    BoundingBox,
    DetectedItem,
    DetectResponse,
    FreshnessWindow,
    IdentifyResponse,
    ShelfLifeRequest,
    ShelfLifeResponse,
    StorageRecommendation,
    StorageRequest,
    StorageResponse,
    VisionAnalysisResponse,
    VisualMetrics,
    VisualNarrative,
)
from ..vision.classifier import ModelUnavailableError, get_classifier
from ..vision.detector import get_detector
from ..vision.metrics import ImageDecodeError, decode_image, measure_surface

logger = logging.getLogger(__name__)

#: Offered when the raw-protein hint fires on an item ImageNet cannot name.
#:
#: Derived from the knowledge base rather than hardcoded names, so a food added
#: to a high-risk category appears here without anyone remembering to update a
#: list. Dairy is excluded: it is high-risk too, but it does not look like raw
#: meat and the hint was never trained to find it.
PROTEIN_SHORTLIST: list[str] = sorted(
    name
    for name in knowledge.known_names()
    if (record := knowledge.resolve(name)) is not None
    and record.category in {"meat", "poultry", "seafood"}
)
router = APIRouter(tags=["analysis"])


async def _read_upload(image: UploadFile) -> bytes:
    """Read and validate an upload before anything touches the pixels."""
    settings = get_settings()

    if image.content_type and not image.content_type.startswith("image/"):
        raise HTTPException(
            status_code=415,
            detail={
                "code": "unsupported_image",
                "message": "Only image uploads are supported.",
            },
        )

    data = await image.read()
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(
            status_code=413,
            detail={
                "code": "image_too_large",
                "message": (
                    f"Images must be under "
                    f"{settings.max_upload_bytes // (1024 * 1024)} MB."
                ),
            },
        )
    if not data:
        raise HTTPException(
            status_code=400,
            detail={"code": "empty_upload", "message": "No image data was received."},
        )
    return data


def _decode_or_400(data: bytes):
    settings = get_settings()
    try:
        return decode_image(data, max_edge=settings.max_image_edge)
    except ImageDecodeError as exc:
        raise HTTPException(
            status_code=400,
            detail={"code": "invalid_image", "message": str(exc)},
        ) from exc


@router.post("/food/identify", response_model=IdentifyResponse)
async def identify_food(image: UploadFile = File(...)) -> IdentifyResponse:
    """Identify the food in an image, without scoring it."""
    data = await _read_upload(image)
    frame = _decode_or_400(data)

    classifier = get_classifier(get_settings().model_path)
    try:
        identification = classifier.identify(frame)
    except ModelUnavailableError as exc:
        raise HTTPException(
            status_code=503,
            detail={"code": "model_unavailable", "message": str(exc)},
        ) from exc

    record = (
        knowledge.resolve(identification.food_name)
        if identification.food_name
        else None
    )

    return IdentifyResponse(
        identified=identification.identified,
        food_name=identification.food_name,
        category=record.category if record else None,  # type: ignore[arg-type]
        confidence=round(identification.confidence, 4),
        alternatives=[
            AlternativeMatch(food_name=p.food_name, confidence=round(p.confidence, 4))
            for p in identification.predictions[1:]
        ],
        raw_labels=[
            AlternativeMatch(food_name=name, confidence=round(score, 4))
            for name, score in identification.raw_labels
        ],
        looks_like_food=identification.looks_like_food,
        model_version=identification.model_version,
        note=identification.note,
    )


@router.post("/food/vision-analysis", response_model=VisionAnalysisResponse)
async def vision_analysis(
    image: UploadFile = File(...),
    food_name: str | None = Form(default=None),
) -> VisionAnalysisResponse:
    """Return the raw OpenCV measurements for an image.

    Passing ``food_name`` lets us measure discoloration against that food's
    reference hue; without it, discoloration is reported as null.
    """
    started = time.perf_counter()

    data = await _read_upload(image)
    frame = _decode_or_400(data)

    record = knowledge.resolve(food_name) if food_name else None
    metrics = measure_surface(
        frame,
        healthy_hue=record.healthy_hue if record else None,
        measure_browning=browning_applicable(record.name if record else None),
    )

    return VisionAnalysisResponse(
        visual_metrics=VisualMetrics(**metrics.as_dict()),
        mask_source=metrics.mask_source,
        mask_fraction=metrics.mask_fraction,
        notes=metrics.notes,
        processing_ms=int((time.perf_counter() - started) * 1000),
    )


@router.post("/analyze", response_model=AnalysisResponse)
async def analyze(
    image: UploadFile = File(...),
    food_name: str | None = Form(default=None),
    category_hint: str | None = Form(default=None),
    storage_type: str | None = Form(default=None),
) -> AnalysisResponse:
    """The main scan endpoint: identify, measure, score, recommend.

    ``food_name`` overrides identification. The app sends it when the user
    corrects the model, or when stock ImageNet weights had no class for the item.
    """
    started = time.perf_counter()

    data = await _read_upload(image)
    frame = _decode_or_400(data)

    # --- Identify ---------------------------------------------------------
    identified = True
    confidence = 1.0
    alternatives: list[AlternativeMatch] = []
    note: str | None = None
    model_version = "user-specified"

    if food_name and food_name.strip():
        resolved_name = food_name.strip()
    else:
        classifier = get_classifier(get_settings().model_path)
        try:
            identification = classifier.identify(frame)
        except ModelUnavailableError as exc:
            raise HTTPException(
                status_code=503,
                detail={"code": "model_unavailable", "message": str(exc)},
            ) from exc

        model_version = identification.model_version
        identified = identification.identified
        confidence = identification.confidence
        note = identification.note
        # Identified: the rest are alternatives. Unidentified: all are a shortlist.
        alternatives = [
            AlternativeMatch(food_name=p.food_name, confidence=round(p.confidence, 4))
            for p in identification.predictions[1 if identified else 0 :]
        ]

        # The classifier answers "what is this photo of", which assumes one
        # item filling the frame. It returns nothing for a fruit bowl, and for
        # an item that is small or off-centre. The detector answers a different
        # question -- "where is the food" -- and often succeeds on exactly
        # those photos, so ask it before giving up.
        detected_foods: list[str] = []
        detected_name: str | None = None
        if not identified:
            detector = get_detector()
            if detector is not None:
                try:
                    detected_foods = [
                        d.food_name for d in detector.detect(frame) if d.food_name
                    ]
                except Exception:  # pragma: no cover - never fail a scan for this
                    logger.exception("Detector fallback failed")

            unique_foods = list(dict.fromkeys(detected_foods))

            # Exactly one kind of food in frame: the classifier missed it but
            # the detector located it, which is a real identification and not a
            # guess. Adopt it and score normally.
            if len(unique_foods) == 1:
                identified = True
                detected_name = unique_foods[0]
                confidence = 0.0  # from detection, not the classifier
                model_version = f"{model_version}+ssd-mobilenet"
                note = (
                    "Identified by locating the food in the frame rather than "
                    "from the photo as a whole."
                )
                alternatives = []

        if not identified:
            # We still measured the surface, but without a food name there is
            # nothing to score against. Report that honestly.
            metrics = measure_surface(frame, healthy_hue=None)
            elapsed = int((time.perf_counter() - started) * 1000)

            # Several different foods in frame. Naming one would be arbitrary
            # and scoring the whole photo would average them, so offer them as
            # a shortlist and point at the scan built for this.
            unique_foods = list(dict.fromkeys(detected_foods))
            if len(unique_foods) > 1:
                alternatives = [
                    AlternativeMatch(food_name=name, confidence=0.0)
                    for name in unique_foods
                ]
                note = (
                    "This photo has several foods in it ("
                    + ", ".join(unique_foods)
                    + "). Use Scan several items to assess each one, or pick "
                    "one below to score the whole photo as that food."
                )

            # ImageNet has no class for raw meat, poultry or fish, which is
            # exactly the case that lands here most often. A small trained head
            # can still tell raw protein from everything else, so offer that as
            # a shortlist rather than leaving the user to scroll every food.
            # It is a hint, not an identification: the same data separates
            # protein from produce well and one species from another badly, so
            # the user still chooses, and the score still comes from that
            # choice and its high-risk cap.
            # Only when the detector found nothing. It names actual foods,
            # which is strictly better than "this looks like raw protein", and
            # running this unconditionally overwrote that shortlist with the
            # vaguer one.
            hint_confidence = (
                None if detected_foods else classifier.protein_hint(frame)
            )
            if hint_confidence is not None:
                alternatives = [
                    AlternativeMatch(food_name=name, confidence=round(hint_confidence, 4))
                    for name in PROTEIN_SHORTLIST
                ]
                note = (
                    "This looks like raw meat, poultry or seafood. Pick which one "
                    "and Fresora will assess it — the score is capped for these "
                    "foods because a photograph cannot establish their safety."
                )
            return AnalysisResponse(
                food_name="Unidentified item",
                category="other",
                status="unknown",
                score=0,
                confidence=0.0,
                identified=False,
                estimated_window=FreshnessWindow(min_days=0, max_days=0),
                visual_metrics=VisualMetrics(**metrics.as_dict()),
                visual_narrative=VisualNarrative(
                    color="Awaiting a food name before colour can be compared.",
                    texture="Not assessed.",
                    surface="Not assessed.",
                    ripeness="Not assessed.",
                ),
                storage_recommendation=StorageRecommendation(
                    headline="Tell us what this is",
                    details=[
                        "Choose the food name and Fresora will assess it and "
                        "recommend storage."
                    ],
                    storage_type="refrigerated",
                    preservation=[],
                ),
                recommended_action=(
                    "Set the food name to continue, or re-scan in better lighting."
                ),
                reasoning=metrics.notes,
                # Both of these carry the protein hint when it fired. Building
                # them from `identification` here instead would discard it.
                alternatives=alternatives,
                scoring_method="not-scored",
                processing_ms=elapsed,
                model_version=model_version,
                mask_source=metrics.mask_source,
                note=note or "The model could not identify this item.",
            )

        # detected_name wins: it is set only when the classifier found nothing
        # and the detector located exactly one food, so it is the more
        # informed answer, and identification.food_name is None in that case.
        resolved_name = detected_name or identification.food_name or "Unidentified item"

    # --- Knowledge --------------------------------------------------------
    record = knowledge.resolve(resolved_name)
    display_name = record.name if record else resolved_name

    if record is not None:
        category = record.category
    elif category_hint in {
        "fruit",
        "vegetable",
        "meat",
        "poultry",
        "seafood",
        "dairy",
        "bakery",
        "other",
    }:
        category = category_hint
    else:
        category = "other"

    if record is None:
        note = (
            note or ""
        ) + " Fresora has no reference data for this food, so storage advice and the freshness window are generic."
        note = note.strip()

    # --- Measure and score ------------------------------------------------
    metrics = measure_surface(
        frame,
        healthy_hue=record.healthy_hue if record else None,
        measure_browning=browning_applicable(display_name),
    )
    assessment = assess(metrics, category, record)

    chosen_storage = storage_type if storage_type in {
        "pantry",
        "refrigerated",
        "frozen",
        "counter",
    } else None
    typical = knowledge.get_typical_shelf_life(display_name, chosen_storage)
    window = estimate_window(assessment.score, assessment.status, typical)

    advice = knowledge.get_storage_advice(display_name)
    if advice is not None:
        recommendation = StorageRecommendation(
            headline=advice.headline,
            details=advice.details,
            storage_type=advice.storage_type,  # type: ignore[arg-type]
            preservation=advice.preservation,
        )
    else:
        recommendation = StorageRecommendation(
            headline="Refrigerate and use soon",
            details=[
                "We have no specific guidance on file for this food, so this is a "
                "conservative default."
            ],
            storage_type="refrigerated",
            preservation=[],
        )

    narrative = build_narrative(metrics, assessment, category, record)
    elapsed = int((time.perf_counter() - started) * 1000)

    return AnalysisResponse(
        food_name=display_name,
        category=category,  # type: ignore[arg-type]
        status=assessment.status,  # type: ignore[arg-type]
        score=assessment.score,
        confidence=round(confidence, 4),
        identified=identified,
        estimated_window=FreshnessWindow(min_days=window[0], max_days=window[1]),
        visual_metrics=VisualMetrics(**metrics.as_dict()),
        visual_narrative=VisualNarrative(**narrative),
        storage_recommendation=recommendation,
        recommended_action=action_for(
            assessment.status, category in HIGH_RISK_CATEGORIES
        ),
        reasoning=assessment.reasoning,
        alternatives=alternatives,
        scoring_method=assessment.scoring_method,
        processing_ms=elapsed,
        model_version=model_version,
        mask_source=metrics.mask_source,
        note=note or None,
    )


@router.post("/detect", response_model=DetectResponse)
async def detect_foods(image: UploadFile = File(...)) -> DetectResponse:
    """Find every food item in one photo and score each separately.

    This is the fridge-shelf case. ``/analyze`` assumes a single item filling
    the frame; here each detected object is cropped and measured on its own, so
    a bruised banana beside a sound apple produces two scores rather than one
    average that describes neither.

    Returns 200 with an empty list when nothing food-like is found. That is a
    real answer -- the photo may hold no food, or only foods COCO has no class
    for -- and the client shows it as such rather than as a failure.
    """
    started = time.perf_counter()
    data = await _read_upload(image)
    frame = _decode_or_400(data)

    detector = get_detector()
    if detector is None:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "model_unavailable",
                "message": "Object detection is not available in this deployment.",
            },
        )

    detections = detector.detect(frame)
    items: list[DetectedItem] = []

    for detection in detections:
        record = (
            knowledge.resolve(detection.food_name) if detection.food_name else None
        )

        if record is None:
            # Detected and locatable, but nothing to score it against. Say so
            # with nulls rather than inventing a number for an unknown food.
            items.append(
                DetectedItem(
                    food_name=detection.food_name,
                    raw_label=detection.raw_label,
                    detection_confidence=detection.confidence,
                    box=BoundingBox(
                        x1=detection.box[0],
                        y1=detection.box[1],
                        x2=detection.box[2],
                        y2=detection.box[3],
                    ),
                    known_food=False,
                )
            )
            continue

        # Measure the crop, not the whole frame: the surrounding shelf would
        # otherwise dominate the colour and texture statistics.
        crop = detection.crop(frame)
        metrics = measure_surface(
            crop,
            healthy_hue=record.healthy_hue,
            measure_browning=browning_applicable(record.name),
        )
        assessment = assess(metrics, record.category, record)
        typical = knowledge.get_typical_shelf_life(record.name)
        window = estimate_window(assessment.score, assessment.status, typical)

        items.append(
            DetectedItem(
                food_name=record.name,
                raw_label=detection.raw_label,
                category=record.category,  # type: ignore[arg-type]
                detection_confidence=detection.confidence,
                box=BoundingBox(
                    x1=detection.box[0],
                    y1=detection.box[1],
                    x2=detection.box[2],
                    y2=detection.box[3],
                ),
                known_food=True,
                status=assessment.status,  # type: ignore[arg-type]
                score=assessment.score,
                estimated_window=FreshnessWindow(
                    min_days=window[0], max_days=window[1]
                ),
                visual_metrics=VisualMetrics(**metrics.as_dict()),
                recommended_action=action_for(
                    assessment.status, record.category in HIGH_RISK_CATEGORIES
                ),
            )
        )

    unknown = [i.raw_label for i in items if not i.known_food]
    note = None
    if unknown:
        note = (
            "Found "
            + ", ".join(sorted(set(unknown)))
            + ", which Fresora has no reference data for. Name them to get a score."
        )
    elif not items:
        note = (
            "No food was found in this photo. Detection covers bananas, apples, "
            "oranges, broccoli and carrots; for anything else, scan it on its own "
            "and name it."
        )

    return DetectResponse(
        detected=bool(items),
        count=len(items),
        items=items,
        processing_ms=int((time.perf_counter() - started) * 1000),
        model_version="ssd-mobilenet-v1-coco",
        note=note,
        safety_notice=SAFETY_NOTICE,
    )


@router.post("/shelf-life", response_model=ShelfLifeResponse)
async def shelf_life(request: ShelfLifeRequest) -> ShelfLifeResponse:
    """Estimate a freshness window without re-analysing an image."""
    record = knowledge.resolve(request.food_name)
    display_name = record.name if record else request.food_name

    storage = request.storage_type or (
        record.preferred_storage if record else "refrigerated"
    )
    typical = knowledge.get_typical_shelf_life(display_name, storage)
    window = estimate_window(request.score, request.status, typical)

    return ShelfLifeResponse(
        food_name=display_name,
        estimated_window=FreshnessWindow(min_days=window[0], max_days=window[1]),
        typical_window=(
            FreshnessWindow(min_days=typical[0], max_days=typical[1])
            if typical
            else None
        ),
        storage_type=storage,  # type: ignore[arg-type]
        recommended_action=action_for(
            request.status, knowledge.is_high_risk(display_name)
        ),
        note=(
            None
            if record
            else "No reference data on file for this food; this window is a generic estimate."
        ),
    )


@router.post("/storage-recommendation", response_model=StorageResponse)
async def storage_recommendation(request: StorageRequest) -> StorageResponse:
    """Curated storage guidance for a food."""
    advice = knowledge.get_storage_advice(request.food_name)
    record = knowledge.resolve(request.food_name)

    if advice is None or record is None:
        return StorageResponse(
            food_name=request.food_name,
            recommendation=StorageRecommendation(
                headline="Refrigerate and use soon",
                details=[
                    "We have no specific guidance on file for this food, so this is "
                    "a conservative default."
                ],
                storage_type="refrigerated",
                preservation=[],
            ),
            known=False,
            note="This food is not in Fresora's reference data yet.",
        )

    return StorageResponse(
        food_name=record.name,
        recommendation=StorageRecommendation(
            headline=advice.headline,
            details=advice.details,
            storage_type=advice.storage_type,  # type: ignore[arg-type]
            preservation=advice.preservation,
        ),
        nutrition=record.nutrition,
        recipe_uses=list(record.recipe_uses),
        known=True,
    )
