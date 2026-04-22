"""Backfill routes.encoded_polyline from app/core/data/route_polylines.json."""

from __future__ import annotations

import json
import os
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient

root = Path(__file__).resolve().parents[2]
load_dotenv(root / "backend" / ".env")

DATA = Path(__file__).resolve().parents[1] / "app" / "core" / "data" / "route_polylines.json"


def main() -> None:
    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ["DB_NAME"]
    raw = json.loads(DATA.read_text(encoding="utf-8"))
    client = MongoClient(mongo_url)
    db = client[db_name]
    n = 0
    for rid, enc in raw.items():
        enc = str(enc or "").strip()
        if not enc:
            continue
        res = db.routes.update_one({"route_id": rid}, {"$set": {"encoded_polyline": enc}})
        if res.matched_count:
            n += 1
            print("updated", rid, "len", len(enc))
    print("done; matched", n, "routes")
    client.close()


if __name__ == "__main__":
    main()
