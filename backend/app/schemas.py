"""Pydantic request/response models.

These mirror the TypeScript types in ``mobile/src/types/food.ts``. When you
change a field here, change it there too -- the mobile app is a direct consumer.
"""

from __future__ import annotations

from typing import Literal, get_args

from pydantic import BaseModel, Field, field_validator

FoodStatus = Literal["fresh", "nearly_spoiled", "overripe", "spoiled", "unknown"]
FoodCategory = Literal[
    "fruit", "vegetable", "meat", "poultry", "seafood", "dairy", "bakery", "other"
]
StorageType = Literal["pantry", "refrigerated", "frozen", "counter"]

#: The same names as a runtime set, for validating values that arrive as plain
#: strings (a form field, or a vision model's JSON). Derived from the Literal so
#: the two can never drift apart.
FOOD_CATEGORIES: frozenset[str] = frozenset(get_args(FoodCategory))
STORAGE_TYPES: frozenset[str] = frozenset(get_args(StorageType))

#: The single safety notice shown wherever an assessment is displayed.
SAFETY_NOTICE = (
    "Fresora analyzes visible food characteristics from images. It cannot "
    "detect microscopic bacteria, odorless toxins, or all internal food-safety "
    "hazards. Results are AI-assisted estimates, not official food-safety "
    "guarantees."
)


# --- Analysis -------------------------------------------------------------


class FreshnessWindow(BaseModel):
    min_days: int = Field(ge=0)
    max_days: int = Field(ge=0)


class VisualMetrics(BaseModel):
    """All fields nullable: ``None`` means the metric was not measurable."""

    defect_coverage: float | None = None
    browning_index: float | None = None
    discoloration: float | None = None
    texture_uniformity: float | None = None
    color_consistency: float | None = None
    mean_lightness: float | None = None
    mean_saturation: float | None = None


class VisualNarrative(BaseModel):
    color: str
    texture: str
    surface: str
    ripeness: str


class AlternativeMatch(BaseModel):
    food_name: str
    confidence: float


class StorageRecommendation(BaseModel):
    headline: str
    details: list[str] = Field(default_factory=list)
    storage_type: StorageType
    preservation: list[str] = Field(default_factory=list)


class AnalysisResponse(BaseModel):
    food_name: str
    category: FoodCategory
    status: FoodStatus
    score: int = Field(ge=0, le=100)
    #: Identification confidence, 0..1. Not the freshness score.
    confidence: float = Field(ge=0.0, le=1.0)
    #: False when the model could not name the food and the user must pick.
    identified: bool = True
    estimated_window: FreshnessWindow
    visual_metrics: VisualMetrics
    visual_narrative: VisualNarrative
    storage_recommendation: StorageRecommendation
    recommended_action: str
    reasoning: list[str] = Field(default_factory=list)
    alternatives: list[AlternativeMatch] = Field(default_factory=list)
    safety_notice: str = SAFETY_NOTICE
    #: How the score was produced, e.g. 'opencv-heuristic-v1'.
    scoring_method: str
    #: Measured, never hard-coded.
    processing_ms: int
    model_version: str
    #: Which segmentation path ran, for transparency.
    mask_source: str
    #: Present when the food is unknown to the knowledge base or the model.
    note: str | None = None


class IdentifyResponse(BaseModel):
    identified: bool
    food_name: str | None
    category: FoodCategory | None
    confidence: float
    alternatives: list[AlternativeMatch] = Field(default_factory=list)
    raw_labels: list[AlternativeMatch] = Field(default_factory=list)
    looks_like_food: bool
    model_version: str
    note: str | None = None


class BoundingBox(BaseModel):
    """Normalised to 0-1 of the frame, so a client can draw it at any preview
    size without knowing the resolution the analysis ran at."""

    x1: float = Field(ge=0.0, le=1.0)
    y1: float = Field(ge=0.0, le=1.0)
    x2: float = Field(ge=0.0, le=1.0)
    y2: float = Field(ge=0.0, le=1.0)


class DetectedItem(BaseModel):
    """One food object located in a multi-item photo.

    Scoring fields are null for a food with no reference data: the object was
    found and can be named by the user, but nothing has been scored against it.
    Reporting the box without a score is honest; inventing a score is not.
    """

    food_name: str | None = None
    raw_label: str
    category: FoodCategory | None = None
    detection_confidence: float = Field(ge=0.0, le=1.0)
    box: BoundingBox
    known_food: bool

    status: FoodStatus | None = None
    score: int | None = Field(default=None, ge=0, le=100)
    estimated_window: FreshnessWindow | None = None
    visual_metrics: VisualMetrics | None = None
    recommended_action: str | None = None


class DetectResponse(BaseModel):
    detected: bool
    count: int = Field(ge=0)
    items: list[DetectedItem] = Field(default_factory=list)
    processing_ms: int = Field(ge=0)
    model_version: str
    note: str | None = None
    safety_notice: str


class VisionAnalysisResponse(BaseModel):
    """Raw measurements only -- no identification, no score."""

    visual_metrics: VisualMetrics
    mask_source: str
    mask_fraction: float | None
    notes: list[str] = Field(default_factory=list)
    processing_ms: int


# --- Shelf life and storage ----------------------------------------------


class ShelfLifeRequest(BaseModel):
    food_name: str
    status: FoodStatus = "fresh"
    score: int = Field(default=100, ge=0, le=100)
    storage_type: StorageType | None = None


class ShelfLifeResponse(BaseModel):
    food_name: str
    estimated_window: FreshnessWindow
    #: The curated figure for a sound example, for context.
    typical_window: FreshnessWindow | None
    storage_type: StorageType
    recommended_action: str
    is_estimate: bool = True
    safety_notice: str = SAFETY_NOTICE
    note: str | None = None


class StorageRequest(BaseModel):
    food_name: str
    storage_type: StorageType | None = None


class StorageResponse(BaseModel):
    food_name: str
    recommendation: StorageRecommendation
    nutrition: str | None = None
    recipe_uses: list[str] = Field(default_factory=list)
    known: bool
    note: str | None = None


# --- Recipes --------------------------------------------------------------


class RecipeInventoryItem(BaseModel):
    """An inventory entry offered to the recipe engine."""

    id: str
    food_name: str
    category: FoodCategory = "other"
    status: FoodStatus = "fresh"
    estimated_remaining_days: int | None = None
    quantity: float = 1
    unit: str = "item"

    @field_validator("food_name")
    @classmethod
    def _non_empty(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("food_name cannot be empty")
        return cleaned


class RecipeRequest(BaseModel):
    inventory: list[RecipeInventoryItem]
    servings: int = Field(default=2, ge=1, le=12)
    language: str = "en"
    dietary_preferences: list[str] = Field(default_factory=list)
    #: Restrict generation to these inventory ids. Empty means "decide for me".
    selected_item_ids: list[str] = Field(default_factory=list)


class RecipeIngredientOut(BaseModel):
    ingredient_name: str
    quantity: str
    is_rescued: bool = False
    inventory_item_id: str | None = None


class RecipeResponse(BaseModel):
    title: str
    description: str
    prep_minutes: int = Field(ge=0)
    cook_minutes: int = Field(ge=0)
    servings: int = Field(ge=1)
    ingredients: list[RecipeIngredientOut]
    instructions: list[str]
    rescued_item_ids: list[str] = Field(default_factory=list)
    tips: list[str] = Field(default_factory=list)
    #: 'llm' when the configured provider generated it, 'rules' for the
    #: built-in matcher. The app tells the user which one ran.
    source: Literal["llm", "rules"]
    #: Items excluded because they were assessed as spoiled.
    excluded_item_ids: list[str] = Field(default_factory=list)
    safety_notice: str = SAFETY_NOTICE
    note: str | None = None


# --- Assistant ------------------------------------------------------------


class AssistantTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class AssistantContext(BaseModel):
    """What the assistant is allowed to know about the user's kitchen."""

    current_food: str | None = None
    current_status: FoodStatus | None = None
    current_score: int | None = None
    inventory: list[RecipeInventoryItem] = Field(default_factory=list)
    language: str = "en"


class AssistantRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    history: list[AssistantTurn] = Field(default_factory=list)
    context: AssistantContext = Field(default_factory=AssistantContext)


class AssistantResponse(BaseModel):
    reply: str
    #: 'llm' or 'knowledge' (the deterministic knowledge-base answer).
    source: Literal["llm", "knowledge"]
    #: Food names whose curated records were used to ground the reply.
    grounded_on: list[str] = Field(default_factory=list)
    suggested_actions: list[str] = Field(default_factory=list)
    safety_notice: str = SAFETY_NOTICE


# --- Meta -----------------------------------------------------------------


class HealthResponse(BaseModel):
    status: Literal["ok"]
    version: str
    classifier_available: bool
    classifier_mode: str
    llm_configured: bool
    known_foods: int


class ErrorResponse(BaseModel):
    """Consistent error envelope.

    ``code`` is a stable machine key the mobile app maps to a localised message,
    so user-facing error copy lives in the app's dictionary, not on the server.
    """

    code: str
    message: str
    detail: str | None = None
