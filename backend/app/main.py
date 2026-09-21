"""FreshcoAI API entry point.

Run locally with::

    uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

Binding 0.0.0.0 matters: a phone on the same Wi-Fi needs to reach the machine's
LAN address, not localhost.

Inventory, history and analytics deliberately do not live here. Those are plain
CRUD over the user's own rows, which the mobile app reads and writes directly
through Supabase with row-level security -- routing them through this service
would add a hop and a second place to enforce ownership. This API owns the
things that need a server: the model, OpenCV, and the LLM key.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import get_settings
from .knowledge.service import knowledge
from .routers import analyze, intelligence
from .schemas import HealthResponse
from .vision.classifier import get_classifier

logging.basicConfig(
    level=logging.DEBUG if get_settings().debug else logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

API_VERSION = "1.0.0"

settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    version=API_VERSION,
    description=(
        "AI-assisted food freshness assessment. All freshness output is an "
        "estimate from visible characteristics, never a food-safety guarantee."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(analyze.router, prefix=settings.api_prefix)
app.include_router(intelligence.router, prefix=settings.api_prefix)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Log the detail, return a generic envelope.

    Stack traces and internal messages never reach the client (rule 37).
    """
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={
            "code": "internal_error",
            "message": "Something went wrong handling that request.",
        },
    )


@app.get(f"{settings.api_prefix}/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """Readiness, including whether the model and LLM are actually usable.

    The mobile app calls this on launch so it can degrade honestly -- hiding the
    Ask AI entry point when no provider is configured, for instance, rather than
    offering a button that always fails.
    """
    classifier = get_classifier(settings.model_path)
    return HealthResponse(
        status="ok",
        version=API_VERSION,
        classifier_available=classifier.is_available(),
        classifier_mode=classifier.mode,
        llm_configured=settings.llm_configured,
        known_foods=len(knowledge.known_names()),
    )


@app.get("/")
async def root() -> dict[str, str]:
    return {
        "name": settings.app_name,
        "version": API_VERSION,
        "docs": "/docs",
        "health": f"{settings.api_prefix}/health",
    }
