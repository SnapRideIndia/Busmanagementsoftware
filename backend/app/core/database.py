"""Async MongoDB client (Motor) — single shared instance per process."""

from __future__ import annotations

import certifi
from motor.motor_asyncio import AsyncIOMotorClient

from app.core.config import settings

mongo_url = settings.mongo_url
client = AsyncIOMotorClient(mongo_url, tlsCAFile=certifi.where())
db = client[settings.db_name]
