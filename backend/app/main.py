"""
FastAPI application entry. Load order: dotenv → imports that read os.environ.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_BACKEND_ROOT / ".env")

from app.api.v1.routes import router as api_router
from app.route_patch import apply_route_master_routes
from app.core.config import settings
from app.core.database import client, db
from app.core.seed import run_seed_data


async def _ensure_indexes() -> None:
    await db.users.create_index("email", unique=True)
    await db.password_reset_tokens.create_index("expires_at", expireAfterSeconds=0)
    await db.login_attempts.create_index("identifier")
    await db.tenders.create_index("tender_id", unique=True)
    await db.buses.create_index("bus_id", unique=True)
    await db.drivers.create_index("license_number", unique=True)
    await db.incidents.create_index("id", unique=True)
    await db.routes.create_index("route_id", unique=True)
    await db.stop_master.create_index("stop_id", unique=True)
    await db.role_permissions.create_index("role_id", unique=True)
    await db.conductors.create_index("conductor_id", unique=True)
    await db.conductors.create_index("badge_no", unique=True)
    await db.trip_data.create_index([("bus_id", 1), ("date", 1)])
    await db.trip_data.create_index("trip_id")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await _ensure_indexes()
    await run_seed_data()
    yield
    client.close()


def create_app() -> FastAPI:
    application = FastAPI(
        title="Bus Management System",
        lifespan=lifespan,
    )

    # Route-master GET list + health (before /api/bus-routes/{route_id} from the big router).
    apply_route_master_routes(application, log="create_app")
    application.include_router(api_router)

    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    return application


app = create_app()
