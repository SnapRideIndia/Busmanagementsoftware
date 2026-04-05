"""Idempotent registration of route-master list + health endpoints (avoids 404 when routes are missing)."""

from __future__ import annotations

from pathlib import Path

from fastapi import Depends, FastAPI, Query

from app.api.deps import get_current_user
from app.api.v1.routes import _list_bus_routes_filtered


def _has_method_on_path(application: FastAPI, path: str, method: str) -> bool:
    m = method.upper()
    for r in application.routes:
        if getattr(r, "path", None) != path:
            continue
        methods = getattr(r, "methods", None) or set()
        if m in methods:
            return True
    return False


def apply_route_master_routes(application: FastAPI, *, log: str | None = "route_patch") -> None:
    if not _has_method_on_path(application, "/api/health/route-master", "GET"):

        @application.get("/api/health/route-master", tags=["health"])
        async def _patch_health_route_master():
            import app.main as app_main_mod

            return {
                "ok": True,
                "patch_logged_as": log,
                "route_patch_py": str(Path(__file__).resolve()),
                "app_main_py": str(Path(app_main_mod.__file__).resolve()),
            }

    async def _list_route_master(
        depot: str = "",
        active: str = "",
        search: str = "",
        page: int = Query(1, ge=1),
        limit: int = Query(20, ge=1, le=100),
        user: dict = Depends(get_current_user),
    ):
        _ = user
        return await _list_bus_routes_filtered(depot, active, search, page, limit)

    for path in ("/api/route-master", "/api/bus-routes", "/api/routes"):
        if _has_method_on_path(application, path, "GET"):
            continue
        application.add_api_route(path, _list_route_master, methods=["GET"], tags=["routes"])
