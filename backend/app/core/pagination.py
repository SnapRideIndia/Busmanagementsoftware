"""Shared list pagination for API responses."""

from __future__ import annotations

from math import ceil
from typing import Any

DEFAULT_LIMIT = 20
MAX_LIMIT = 100


def normalize_page_limit(page: int, limit: int) -> tuple[int, int]:
    p = max(1, int(page) if page else 1)
    lim = int(limit) if limit else DEFAULT_LIMIT
    lim = max(1, min(lim, MAX_LIMIT))
    return p, lim


def skip_for_page(page: int, limit: int) -> int:
    p, lim = normalize_page_limit(page, limit)
    return (p - 1) * lim


def paged_payload(items: list[Any], *, total: int, page: int, limit: int) -> dict[str, Any]:
    """Standard list envelope: { items, total, page, limit, pages }."""
    p, lim = normalize_page_limit(page, limit)
    pages = max(1, ceil(total / lim)) if total > 0 else 1
    return {"items": items, "total": total, "page": p, "limit": lim, "pages": pages}


def slice_rows(rows: list[Any], page: int, limit: int) -> tuple[list[Any], dict[str, Any]]:
    """Slice an in-memory list; returns (slice, meta dict with total, page, limit, pages)."""
    p, lim = normalize_page_limit(page, limit)
    total = len(rows)
    sk = (p - 1) * lim
    chunk = rows[sk : sk + lim]
    pages = max(1, ceil(total / lim)) if total > 0 else 1
    meta = {"total": total, "page": p, "limit": lim, "pages": pages}
    return chunk, meta
