"""
Entrypoint for `uvicorn server:app`.

Imports `app` from `app.main`, then runs an idempotent patch so route-master health/list
routes exist even if an older `create_app` was cached. Use this file when starting the API.
"""

from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

from app.main import app
from app.route_patch import apply_route_master_routes

apply_route_master_routes(app, log="server.py")

__all__ = ["app"]
