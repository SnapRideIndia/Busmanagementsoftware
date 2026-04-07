"""Environment-backed settings (extend with pydantic-settings when needed)."""

from __future__ import annotations

import os
from pathlib import Path
from functools import lru_cache


def _backend_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


@lru_cache
def get_env_path() -> Path:
    return _backend_root() / ".env"


class Settings:
    """Minimal settings facade; required keys raise at access if missing."""

    @property
    def mongo_url(self) -> str:
        return os.environ["MONGO_URL"]

    @property
    def db_name(self) -> str:
        return os.environ["DB_NAME"]

    @property
    def jwt_secret(self) -> str:
        return os.environ["JWT_SECRET"]

    @property
    def frontend_url(self) -> str:
        return os.environ.get("FRONTEND_URL", "http://localhost:3000")

    @property
    def cors_origins(self) -> list[str]:
        raw = os.environ.get("CORS_ORIGINS", "")
        if raw == "*":
            return ["*"]
        if raw.strip():
            return [o.strip() for o in raw.split(",") if o.strip()]
        return [self.frontend_url]

    @property
    def backend_root(self) -> Path:
        return _backend_root()

    @property
    def memory_dir(self) -> Path:
        """Writable docs dir for dev credentials (works on Windows + Linux)."""
        return self.backend_root / "memory"

    @property
    def upload_dir(self) -> Path:
        """Root directory for user uploads (incident attachments, etc.)."""
        raw = os.environ.get("UPLOAD_DIR", "").strip()
        if raw:
            return Path(raw)
        return self.backend_root / "uploads"

    @property
    def max_upload_bytes(self) -> int:
        return int(os.environ.get("MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))

    @property
    def allowed_upload_content_types(self) -> frozenset[str]:
        raw = os.environ.get("ALLOWED_UPLOAD_MIME", "").strip()
        if raw:
            return frozenset(x.strip() for x in raw.split(",") if x.strip())
        return frozenset(
            {
                "image/jpeg",
                "image/png",
                "image/webp",
                "application/pdf",
            }
        )


settings = Settings()
