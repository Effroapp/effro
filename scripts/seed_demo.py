#!/usr/bin/env python3
"""
Seed a fresh demo database for showcasing Effro (the offline / file-based route).

Thin CLI wrapper around backend/demo_seed.py - the same dataset the in-app
"Load demo data" button uses, so the two never drift. Creates a fresh SQLite
file with one coherent persona's worth of Areas/Threads/Entries, Signals,
heartbeat work-sessions and links. Dates are relative to now, so re-run any time
to re-centre them.

Usage:
    python scripts/seed_demo.py [--out PATH]   (default: ~/Downloads/effro-demo.db)

Use the output by replacing the app's database:
  - Desktop: back up your effro.db and copy this in as effro.db.
  - Docker:  copy this in as ./data/department.db, then restart the container.
No users are created, so the desktop build (auth off) shows it with no login.
For an already-running instance, prefer Settings -> the "Load demo data" button.
"""
import argparse
import os
import sys

argp = argparse.ArgumentParser()
argp.add_argument("--out", default=os.path.join(os.path.expanduser("~"), "Downloads", "effro-demo.db"))
A = argp.parse_args()
OUT = os.path.abspath(A.out)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
# Always start fresh so re-runs re-centre the dates without duplicating.
for ext in ("", "-wal", "-shm", "-journal"):
    p = OUT + ext
    if os.path.exists(p):
        os.remove(p)

os.environ["DB_PATH"] = OUT
os.environ["DATA_DIR"] = os.path.dirname(OUT)
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))

import main          # noqa: E402  (sets up engine from DB_PATH)
import demo_seed     # noqa: E402
main._init_db()      # create schema + seed the daily nudges
from database import SessionLocal, engine  # noqa: E402

db = SessionLocal()
counts = demo_seed.seed(db)
db.close()
engine.dispose()
print("Seeded demo database ->", OUT)
for k, v in counts.items():
    print(f"  {k:14} {v}")
