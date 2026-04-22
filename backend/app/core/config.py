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
        return os.environ.get("FRONTEND_URL", "http://localhost:3000").strip().rstrip("/")

    @property
    def cors_origins(self) -> list[str]:
        raw = os.environ.get("CORS_ORIGINS", "").strip()
        if raw == "*":
            # Credentials mode cannot use wildcard origin; fall back to frontend URL.
            return [self.frontend_url]
        if raw:
            return [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]
        primary = self.frontend_url
        origins = [primary]
        # CRA often uses :3000; a second dev server bumps to :3001. Both need CORS.
        if "localhost" in primary or primary.startswith("http://127.0.0.1"):
            for origin in ("http://localhost:3000", "http://localhost:3001"):
                if origin not in origins:
                    origins.append(origin)
        return origins

    @property
    def backend_root(self) -> Path:
        return _backend_root()

    @property
    def memory_dir(self) -> Path:
        """Writable docs dir for dev credentials (works on Windows + Linux)."""
        return self.backend_root / "memory"

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

    @property
    def s3_bucket(self) -> str:
        """S3 bucket for incident attachments (required for upload; empty disables uploads)."""
        return os.environ.get("S3_INCIDENT_BUCKET", "").strip()

    @property
    def s3_region(self) -> str:
        return (
            os.environ.get("AWS_REGION")
            or os.environ.get("AWS_DEFAULT_REGION")
            or "us-east-1"
        ).strip()

    @property
    def s3_key_prefix(self) -> str:
        """Prefix for S3 keys, e.g. ebms-incidents/ — always ends with /."""
        p = os.environ.get("S3_INCIDENT_PREFIX", "ebms-incidents/").strip()
        return p if p.endswith("/") else f"{p}/"

    @property
    def incident_attachments_use_s3(self) -> bool:
        return bool(self.s3_bucket)


settings = Settings()
