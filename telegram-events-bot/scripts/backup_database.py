#!/usr/bin/env python3
"""Create a consistent SQLite backup using the SQLite backup API.

Usage:
    python scripts/backup_database.py [SOURCE_DB] [BACKUP_DIR]

Defaults to data/event_bot.sqlite3 and backups/.
Backups are named with a UTC timestamp; old backups are never deleted.
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

DEFAULT_SOURCE = Path("data/event_bot.sqlite3")
DEFAULT_DEST_DIR = Path("backups")


def make_backup(source_path: Path, dest_dir: Path) -> Path:
    """Back up ``source_path`` into ``dest_dir`` via the backup API.

    The backup API guarantees a consistent snapshot even while WAL is active.
    """
    if not source_path.is_file():
        raise FileNotFoundError(f"قاعدة البيانات غير موجودة: {source_path}")
    dest_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    dest_path = dest_dir / f"event_bot_{timestamp}.sqlite3"

    source = sqlite3.connect(str(source_path))
    dest = sqlite3.connect(str(dest_path))
    try:
        source.backup(dest)
    finally:
        dest.close()
        source.close()
    return dest_path


def main(argv: list[str] | None = None) -> int:
    """Run the backup from the command line."""
    parser = argparse.ArgumentParser(description="Backup the SQLite database.")
    parser.add_argument("source", nargs="?", default=str(DEFAULT_SOURCE), help="Path to the database")
    parser.add_argument("dest_dir", nargs="?", default=str(DEFAULT_DEST_DIR), help="Backup destination directory")
    args = parser.parse_args(argv)

    try:
        dest = make_backup(Path(args.source), Path(args.dest_dir))
    except Exception as exc:  # noqa: BLE001
        print(f"فشل إنشاء النسخة الاحتياطية: {exc}", file=sys.stderr)
        return 1
    print(f"تم إنشاء النسخة الاحتياطية: {dest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
