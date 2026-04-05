from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
text = (ROOT / "server.py").read_text(encoding="utf-8")
if len(text) < 2000:
    raise SystemExit("server.py is slim; restore monolith from git to re-run extract_seed.")
start = text.index("async def seed_data():")
end = text.index("# ══════════════════════════════════════════════════════════\n# STARTUP", start)
body = text[start:end]

header = '''"""Database seeding for demos and local development."""

from __future__ import annotations

import logging
import os
import random
import uuid
from datetime import datetime, timedelta, timezone

from app.core.config import settings
from app.core.database import db
from app.core.security import hash_password, verify_password

logger = logging.getLogger(__name__)


'''

body = body.replace("async def seed_data():", "async def run_seed_data():")
# Credentials file: portable path (Windows + Linux)
old = '    os.makedirs("/app/memory", exist_ok=True)\n    with open("/app/memory/test_credentials.md", "w") as f:'
new = (
    "    settings.memory_dir.mkdir(parents=True, exist_ok=True)\n"
    "    cred_path = settings.memory_dir / \"test_credentials.md\"\n"
    "    with open(cred_path, \"w\", encoding=\"utf-8\") as f:"
)
body = body.replace(old, new)

(ROOT / "app" / "core" / "seed.py").write_text(header + body, encoding="utf-8")
print("Wrote seed.py")
