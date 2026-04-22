"""One-off: extract RT-* encoded polylines from agent transcript JSONL into app/core/data/route_polylines.json."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TRANSCRIPT = Path(
    r"C:\Users\Mani\.cursor\projects\c-Users-Mani-Desktop-RTC\agent-transcripts"
    r"\ac6e8c10-b44a-4487-84db-7411b7a72ce3\ac6e8c10-b44a-4487-84db-7411b7a72ce3.jsonl"
)


def main() -> None:
    lines = TRANSCRIPT.read_text(encoding="utf-8").splitlines()
    line = lines[344]
    obj = json.loads(line)
    text = obj["message"]["content"][0]["text"]
    if "<user_query>" in text:
        text = text.split("<user_query>", 1)[1]
    if "</user_query>" in text:
        text = text.split("</user_query>", 1)[0]

    out: dict[str, str] = {}
    for m in re.finditer(r'RT-(\d+)\s*(?:POLYLINE)?\s*:\s*"([^"]*)"', text):
        rid = f"RT-{m.group(1)}"
        poly = m.group(2)
        if poly.startswith("{"):
            poly = poly[1:]
        if poly.endswith("}"):
            poly = poly[:-1]
        out[rid] = poly

    data_dir = ROOT / "app" / "core" / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    out_path = data_dir / "route_polylines.json"
    out_path.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    print("wrote", out_path, "keys", sorted(out.keys()))
    for k, v in sorted(out.items()):
        print(k, "len", len(v))


if __name__ == "__main__":
    main()
