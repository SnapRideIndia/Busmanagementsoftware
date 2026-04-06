"""Async MongoDB client (Motor) — single shared instance per process."""

from __future__ import annotations

from motor.motor_asyncio import AsyncIOMotorClient

from app.core.config import settings

mongo_url = settings.mongo_url
# Only use TLS if connecting to Atlas or remote MongoDB (not localhost)
if "localhost" in mongo_url or "127.0.0.1" in mongo_url:
    client = AsyncIOMotorClient(mongo_url)
else:
    import certifi
    client = AsyncIOMotorClient(mongo_url, tlsCAFile=certifi.where())
db = client[settings.db_name]
