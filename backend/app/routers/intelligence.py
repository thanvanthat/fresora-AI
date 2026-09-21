"""Recipe generation, the assistant, and knowledge lookups."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..ai.assistant import ask
from ..ai.provider import get_provider
from ..ai.recipes import generate_recipe
from ..config import get_settings
from ..knowledge.service import knowledge
from ..schemas import (
    AssistantRequest,
    AssistantResponse,
    RecipeRequest,
    RecipeResponse,
)

router = APIRouter(tags=["intelligence"])


@router.post("/recipes/generate", response_model=RecipeResponse)
async def recipes_generate(request: RecipeRequest) -> RecipeResponse:
    """Generate a zero-waste recipe from the caller's inventory.

    Spoiled items are filtered out before generation and listed in
    ``excluded_item_ids``.
    """
    if not request.inventory:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "empty_inventory",
                "message": "Send at least one inventory item to generate a recipe.",
            },
        )

    provider = get_provider(get_settings())
    return await generate_recipe(request, provider)


@router.post("/assistant/chat", response_model=AssistantResponse)
async def assistant_chat(request: AssistantRequest) -> AssistantResponse:
    """Answer a food question, grounded on curated data and the user's kitchen."""
    provider = get_provider(get_settings())
    return await ask(request, provider)


@router.get("/knowledge/foods")
async def list_known_foods() -> dict[str, list[str] | int]:
    """Every food FreshcoAI holds reference data for.

    The app uses this to populate the manual-entry picker and the "not a X?"
    correction list, so the two never drift out of sync with the server.
    """
    names = knowledge.known_names()
    return {"foods": names, "count": len(names), "pantry": knowledge.pantry_staples()}


@router.get("/knowledge/foods/{food_name}")
async def describe_food(food_name: str) -> dict[str, object]:
    """Full reference record for one food."""
    record = knowledge.resolve(food_name)
    if record is None:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "unknown_food",
                "message": f"No reference data for {food_name!r}.",
            },
        )

    shelf = record.shelf_life
    return {
        "name": record.name,
        "category": record.category,
        "preferred_storage": record.preferred_storage,
        "storage": {
            "headline": record.storage_headline,
            "details": record.storage_details,
        },
        "shelf_life_days": {
            mode: getattr(shelf, mode)
            for mode in ("counter", "pantry", "refrigerated", "frozen")
            if getattr(shelf, mode) is not None
        },
        "preservation": record.preservation,
        "nutrition": record.nutrition,
        "recipe_uses": record.recipe_uses,
        "high_risk": record.high_risk,
    }
