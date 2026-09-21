"""Runtime configuration, read from the environment.

Nothing here has a secret default. If a key is absent the corresponding feature
reports itself as unconfigured rather than silently falling back to a stub that
would produce made-up output.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_list(name: str, default: list[str]) -> list[str]:
    raw = os.getenv(name)
    if not raw:
        return default
    return [item.strip() for item in raw.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    """Immutable settings snapshot."""

    app_name: str = "Fresora API"
    api_prefix: str = "/api/v1"
    debug: bool = field(default_factory=lambda: _env_bool("DEBUG", False))

    # --- Vision -----------------------------------------------------------
    # Optional path to a locally trained freshness model. When empty, the
    # freshness score comes from the documented OpenCV feature formula in
    # app/freshness.py instead of a trained classifier.
    model_path: str = field(default_factory=lambda: os.getenv("MODEL_PATH", ""))
    # Where Keras caches downloaded ImageNet weights.
    keras_home: str = field(default_factory=lambda: os.getenv("KERAS_HOME", ""))
    # Longest edge, in pixels, an uploaded image is resized to before analysis.
    max_image_edge: int = field(
        default_factory=lambda: int(os.getenv("MAX_IMAGE_EDGE", "1024"))
    )
    # Hard cap on upload size. Anything larger is rejected before decoding.
    max_upload_bytes: int = field(
        default_factory=lambda: int(os.getenv("MAX_UPLOAD_BYTES", str(12 * 1024 * 1024)))
    )

    # --- LLM provider -----------------------------------------------------
    llm_provider: str = field(
        default_factory=lambda: os.getenv("LLM_PROVIDER", "anthropic").strip().lower()
    )
    llm_api_key: str = field(default_factory=lambda: os.getenv("LLM_API_KEY", ""))
    llm_model: str = field(
        default_factory=lambda: os.getenv("LLM_MODEL", "claude-sonnet-5")
    )
    llm_timeout_seconds: float = field(
        default_factory=lambda: float(os.getenv("LLM_TIMEOUT_SECONDS", "45"))
    )
    llm_max_tokens: int = field(
        default_factory=lambda: int(os.getenv("LLM_MAX_TOKENS", "1600"))
    )

    # --- Supabase (server side; never shipped to the client) --------------
    supabase_url: str = field(default_factory=lambda: os.getenv("SUPABASE_URL", ""))
    supabase_service_role_key: str = field(
        default_factory=lambda: os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    )

    # --- HTTP -------------------------------------------------------------
    cors_origins: list[str] = field(
        default_factory=lambda: _env_list("CORS_ORIGINS", ["*"])
    )

    @property
    def llm_configured(self) -> bool:
        """True when the assistant and LLM recipe generation can actually run."""
        return bool(self.llm_api_key)

    @property
    def supabase_configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_role_key)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
