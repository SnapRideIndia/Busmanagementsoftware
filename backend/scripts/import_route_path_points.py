"""Parse RT-xxx : [ {lat,lng}, ... ] sections from a text export into route_path_points.json."""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "app" / "core" / "data" / "route_path_points.json"


def parse_points_file(path: Path) -> dict[str, list[dict[str, float]]]:
    text = path.read_text(encoding="utf-8")
    # Split before each "RT-NNN :" at line start (allow optional space before colon)
    parts = re.split(r"(?=^RT-\d+\s*:)", text.strip(), flags=re.MULTILINE)
    out: dict[str, list[dict[str, float]]] = {}
    for part in parts:
        part = part.strip()
        if not part:
            continue
        m = re.match(r"^(RT-\d+)\s*:\s*(\[.*\])\s*$", part, re.DOTALL)
        if not m:
            # Try: header line + rest
            m2 = re.match(r"^(RT-\d+)\s*:\s*", part, re.DOTALL)
            if not m2:
                continue
            rid = m2.group(1)
            rest = part[m2.end() :].strip()
            if not rest.startswith("["):
                continue
            # Balance brackets for JSON array
            depth = 0
            end_i = -1
            for i, ch in enumerate(rest):
                if ch == "[":
                    depth += 1
                elif ch == "]":
                    depth -= 1
                    if depth == 0:
                        end_i = i + 1
                        break
            if end_i < 0:
                continue
            arr_s = rest[:end_i]
        else:
            rid = m.group(1)
            arr_s = m.group(2)
        try:
            raw = json.loads(arr_s)
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON array for {rid}: {e}") from e
        pts: list[dict[str, float]] = []
        for p in raw:
            if not isinstance(p, dict):
                continue
            pts.append({"lat": float(p["lat"]), "lng": float(p["lng"])})
        out[rid] = pts
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("input", type=Path, help="Path to points.txt export")
    ap.add_argument("-o", "--output", type=Path, default=DEFAULT_OUT, help="Output JSON path")
    args = ap.parse_args()
    data = parse_points_file(args.input)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    for k in sorted(data.keys()):
        print(k, "points", len(data[k]))
    print("wrote", args.output)


if __name__ == "__main__":
    main()
