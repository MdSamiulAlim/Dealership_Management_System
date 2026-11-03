"""Take an online-consistent SQLite backup without exposing business records."""

from datetime import datetime
from pathlib import Path
import sqlite3

from app import DATA_DIR, DB_PATH


def main() -> None:
    if not DB_PATH.is_file():
        raise SystemExit("No dealership database found; no backup created.")
    target_dir = DATA_DIR / "backups"
    target_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    target = target_dir / f"dealership_{stamp}.db"
    # Create privately, then use SQLite's backup API instead of copying a live file.
    with target.open("xb"):
        target.chmod(0o600)
    with sqlite3.connect(DB_PATH.as_uri() + "?mode=ro", uri=True) as source:
        with sqlite3.connect(target) as destination:
            source.backup(destination)
            if destination.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise SystemExit("Backup integrity check failed.")
    print(f"Backup saved: {target}")


if __name__ == "__main__":
    main()
