"""EBMS permission catalog: resource-scoped CRUD (view/create/update/delete) + admin scopes."""

from __future__ import annotations

from typing import Any

from app.domain.user_roles import ALLOWED_ROLE_IDS


def _perm(pid: str, label: str, group: str) -> dict[str, str]:
    return {"id": pid, "label": label, "group": group}


def _crud(prefix: str, title: str, group: str) -> list[dict[str, str]]:
    return [
        _perm(f"{prefix}.read", f"{title} — view", group),
        _perm(f"{prefix}.create", f"{title} — create", group),
        _perm(f"{prefix}.update", f"{title} — update", group),
        _perm(f"{prefix}.delete", f"{title} — delete", group),
    ]


# Single-action areas (read-only or one capability)
_SINGLE: list[dict[str, str]] = [
    _perm("overview.dashboard.read", "Dashboard", "Overview"),
    _perm("operations.live_tracking.read", "Live tracking — view", "Operations"),
    _perm("operations.trip_km.read", "Trip-wise kilometre verification — view queue", "Operations"),
    _perm("operations.trip_km.traffic_approve", "Trip-wise kilometre verification — first verification", "Operations"),
    _perm("operations.trip_km.maintenance_finalize", "Trip-wise kilometre verification — final verification (maintenance)", "Operations"),
    _perm("finance.kpi.read", "KPI & SLA — view", "Finance"),
    _perm("reports.read", "Reports — view", "Reports"),
    _perm("admin.users.read", "Users — view", "Admin"),
    _perm("admin.users.create", "Users — create", "Admin"),
    _perm("admin.users.update", "Users — update (incl. role)", "Admin"),
    _perm("admin.users.delete", "Users — delete", "Admin"),
    _perm("admin.permissions.read", "Permissions — view matrix", "Admin"),
    _perm("admin.permissions.update", "Permissions — edit matrix", "Admin"),
    _perm("admin.settings.update", "System settings — update", "Admin"),
]

_CRUD_BLOCKS: list[dict[str, str]] = []
for prefix, title, group in [
    ("operations.duties", "Duty roster", "Operations"),
    ("operations.incidents", "Incidents", "Operations"),
    ("operations.deductions", "Deductions", "Operations"),
    ("operations.infractions", "Infractions", "Operations"),
    ("operations.energy", "Energy", "Operations"),
    ("masters.tenders", "Tenders", "Master data"),
    ("masters.depots", "Depots", "Master data"),
    ("masters.routes", "Routes", "Master data"),
    ("masters.stops", "Stops", "Master data"),
    ("masters.buses", "Bus fleet", "Master data"),
    ("masters.drivers", "Drivers", "Master data"),
    ("masters.conductors", "Conductors", "Master data"),
    ("finance.billing", "Billing", "Finance"),
    ("finance.business_rules", "Business rules", "Finance"),
]:
    _CRUD_BLOCKS.extend(_crud(prefix, title, group))

PERMISSION_DEFINITIONS: list[dict[str, str]] = _SINGLE + _CRUD_BLOCKS

ALL_PERMISSION_IDS: frozenset[str] = frozenset(p["id"] for p in PERMISSION_DEFINITIONS)

# When True: every role receives the full permission catalog (DB matrix ignored for enforcement).
# Set False to restore tender-style role defaults and stored role_permissions rows.
OPEN_ACCESS_ALL_PERMISSIONS = True


def all_read_permission_ids() -> list[str]:
    return sorted(p["id"] for p in PERMISSION_DEFINITIONS if p["id"].endswith(".read"))


def crud(prefix: str) -> set[str]:
    return {f"{prefix}.{a}" for a in ("read", "create", "update", "delete")}


def default_permission_ids_for_role(role_id: str) -> list[str]:
    """Default matrix rows when none stored (also used by seed)."""
    every = [p["id"] for p in PERMISSION_DEFINITIONS]
    if OPEN_ACCESS_ALL_PERMISSIONS:
        return sorted(every)
    read_set = set(all_read_permission_ids())

    ops_crud = set().union(
        *[crud(p) for p in (
            "operations.duties",
            "operations.incidents",
            "operations.deductions",
            "operations.infractions",
            "operations.energy",
        )],
    )
    masters_crud = set().union(
        *[crud(p) for p in (
            "masters.tenders",
            "masters.depots",
            "masters.routes",
            "masters.stops",
            "masters.buses",
            "masters.drivers",
            "masters.conductors",
        )],
    )
    masters_reads = read_set & masters_crud
    finance_crud = crud("finance.billing") | crud("finance.business_rules") | {"finance.kpi.read"}

    trip_km_perms = {
        "operations.trip_km.read",
        "operations.trip_km.traffic_approve",
        "operations.trip_km.maintenance_finalize",
    }

    hub_read = {
        "overview.dashboard.read",
        "operations.live_tracking.read",
        "reports.read",
        "finance.kpi.read",
    }

    # Tender-aligned defaults (4 roles). DB `role_permissions` overrides when present.
    if role_id == "admin":
        return sorted(every)
    if role_id == "management":
        # Senior / RM / finance / MIS: full operational + financial oversight; user assignment; read-only matrix.
        return sorted(
            hub_read
            | read_set
            | ops_crud
            | masters_crud
            | finance_crud
            | trip_km_perms
            | {
                "admin.users.read",
                "admin.users.update",
                "admin.permissions.read",
            },
        )
    if role_id == "depot":
        # Depot traffic / maintenance / DC: hub + reports + full ops; masters read + ongoing fleet updates.
        return sorted(
            hub_read
            | masters_reads
            | ops_crud
            | trip_km_perms
            | crud("masters.buses")
            | crud("masters.drivers")
            | crud("masters.conductors")
            | crud("masters.routes")
            | crud("masters.stops"),
        )
    if role_id == "vendor":
        return sorted(
            {
                "overview.dashboard.read",
                "operations.live_tracking.read",
                "masters.tenders.read",
                "masters.buses.read",
                "masters.routes.read",
            },
        )
    return sorted({"overview.dashboard.read"})


def validate_permission_ids(permission_ids: list[str]) -> None:
    bad = [x for x in permission_ids if x not in ALL_PERMISSION_IDS]
    if bad:
        raise ValueError(f"Unknown permission ids: {bad}")


def permission_matrix_from_db_rows(
    rows: list[dict[str, Any]],
) -> dict[str, list[str]]:
    if OPEN_ACCESS_ALL_PERMISSIONS:
        full = sorted(ALL_PERMISSION_IDS)
        return {rid: list(full) for rid in sorted(ALLOWED_ROLE_IDS)}
    by_role = {r["role_id"]: list(r.get("permission_ids") or []) for r in rows}
    out: dict[str, list[str]] = {}
    for rid in sorted(ALLOWED_ROLE_IDS):
        if rid in by_role and by_role[rid]:
            cleaned = sorted(set(by_role[rid]) & ALL_PERMISSION_IDS)
            if cleaned:
                out[rid] = cleaned
                continue
        out[rid] = sorted(default_permission_ids_for_role(rid))
    return out
