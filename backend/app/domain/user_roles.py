"""Application roles aligned with tender / SRS scope (§9.2 style — ~4 actor classes, not a long RBAC laundry list)."""

from __future__ import annotations

# Tender / SRS consolidation:
# - Admin (HQ / IT): full configuration, users, masters parameters
# - Management: senior / regional / finance — MIS, approvals, billing chain, operational oversight
# - Depot: traffic, maintenance, DC — depot-scoped operations (responsibility matrix)
# - Vendor: concessionaire / operator — limited, contract-scoped access
ROLE_DEFINITIONS: list[dict[str, str | int]] = [
    {"id": "admin", "name": "Administrator (HQ / IT)", "level": 1},
    {"id": "management", "name": "Management (Senior / Regional / Finance)", "level": 2},
    {"id": "depot", "name": "Depot operations (Traffic / Maintenance / DC)", "level": 3},
    {"id": "vendor", "name": "Vendor / Concessionaire", "level": 4},
]

ALLOWED_ROLE_IDS = frozenset(str(r["id"]) for r in ROLE_DEFINITIONS)

# Roles that count as “platform admin” for last-admin safeguards and implicit full permissions.
PLATFORM_ADMIN_ROLES: frozenset[str] = frozenset({"admin"})

# Map legacy / demo role ids to tender-aligned ids (idempotent user migration in seed).
LEGACY_ROLE_TO_CANONICAL: dict[str, str] = {
    "super_admin": "admin",
    "senior_management": "management",
    "regional_manager": "management",
    "fleet_manager": "management",
    "operations_manager": "management",
    "finance_officer": "management",
    "depot_manager": "depot",
    "safety_officer": "depot",
    "officer": "depot",
    "auditor": "management",
    "viewer": "vendor",
}
