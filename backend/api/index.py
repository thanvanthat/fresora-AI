"""Vercel serverless entry point.

Vercel's Python runtime looks for a module-level ASGI application called
``app`` inside ``api/``. Re-exporting the real FastAPI instance keeps every
route, the CORS middleware and the startup logic identical to the container
deployment -- this file adds no behaviour of its own, so there is exactly one
implementation of the API to reason about.

The project root (``backend/``) is on ``sys.path`` at runtime, which is what
makes ``app.main`` importable from here.
"""

from __future__ import annotations

from app.main import app

__all__ = ["app"]
