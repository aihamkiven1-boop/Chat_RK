#!/usr/bin/env python3
"""Seed a demo group/user/event/questions into a local database.

No Telegram token is required. The demo event is created in REGISTRATION
status so an admin can later start it.

Usage:
    python scripts/seed_demo_event.py [DATABASE_PATH]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.container import build_container
from app.database import open_database
from app.demo_data import build_demo_questions
from app.utils.time_utils import utc_now_iso

DEMO_CHAT_ID = -1001234567890
DEMO_CREATOR_ID = 111111111
DEMO_TITLE = "فعالية تجريبية"


def seed(database_path: str) -> None:
    """Create a demo event with five questions."""
    db = open_database(database_path)
    container = build_container(db)
    try:
        now = container.now_fn()
        event = container.event_service.create_event(
            chat_id=DEMO_CHAT_ID,
            created_by=DEMO_CREATOR_ID,
            title=DEMO_TITLE,
            group_title="مجموعة تجريبية",
            now=now,
            created_by_name="المشرف التجريبي",
            game_type="speed_quiz",
            total_questions=len(build_demo_questions()),
        )
        container.event_service.add_questions(
            event.id, DEMO_CHAT_ID, build_demo_questions(), now
        )
        print(f"تم إنشاء الفعالية التجريبية (id={event.id}) في {database_path}")
        print("الحالة: REGISTRATION — يمكن بدؤها من البوت أو تعديلها يدويًا.")
    finally:
        container.close()


def main(argv: list[str] | None = None) -> int:
    """Run the seeder from the command line."""
    parser = argparse.ArgumentParser(description="Seed a demo event.")
    parser.add_argument(
        "database",
        nargs="?",
        default="data/event_bot.sqlite3",
        help="Path to the database",
    )
    args = parser.parse_args(argv)
    try:
        seed(args.database)
    except Exception as exc:  # noqa: BLE001
        print(f"فشل إنشاء البيانات التجريبية: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
