"""
One-off: normalize incident_type on all `incidents` documents to canonical codes.

Dry-run by default. Writes with --apply.

Run from backend directory (loads .env like the API):

  cd Busmanagementsoftware/backend
  python scripts/migrate_incident_types.py
  python scripts/migrate_incident_types.py --apply
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent


def _setup_path_and_env() -> None:
    sys.path.insert(0, str(BACKEND_ROOT))
    from dotenv import load_dotenv

    load_dotenv(BACKEND_ROOT / ".env")


async def run(*, dry_run: bool) -> None:
    _setup_path_and_env()
    from app.core.database import db
    from app.domain.incident_types import creatable_incident_type_codes, normalize_incident_type

    creatable = creatable_incident_type_codes()
    cursor = db.incidents.find({}, {"_id": 1, "id": 1, "incident_type": 1})
    updates: list[tuple[object, str | None, str, str]] = []
    async for doc in cursor:
        raw = doc.get("incident_type")
        raw_s = raw if isinstance(raw, str) else ("" if raw is None else str(raw))
        canon = normalize_incident_type(raw_s)
        if raw_s == canon:
            continue
        updates.append((doc["_id"], doc.get("id"), raw_s, canon))

    non_creatable_after = [u for u in updates if u[3] not in creatable]

    print(f"Documents to update: {len(updates)}")
    for _oid, iid, raw, canon in updates[:40]:
        print(f"  {iid}: {raw!r} -> {canon!r}")
    if len(updates) > 40:
        print(f"  ... and {len(updates) - 40} more")

    if non_creatable_after:
        print(
            f"\n{len(non_creatable_after)} update(s) target OTHER or non-creatable codes; "
            "edit descriptions and re-classify in IRMS if needed."
        )

    if dry_run:
        print("\nDry run only. Pass --apply to write.")
        return

    for oid, _iid, _raw, canon in updates:
        await db.incidents.update_one({"_id": oid}, {"$set": {"incident_type": canon}})
    print(f"\nApplied {len(updates)} update(s).")


def main() -> None:
    ap = argparse.ArgumentParser(description="Normalize incident_type values in MongoDB.")
    ap.add_argument("--apply", action="store_true", help="Persist updates (default is dry-run).")
    args = ap.parse_args()
    asyncio.run(run(dry_run=not args.apply))


if __name__ == "__main__":
    main()
