"""Shared fixtures: a temp SQLite database and a wired container.

All tests use a temporary SQLite database inside the test run; the real
data/event_bot.sqlite3 file is never touched.
"""

from __future__ import annotations

import pytest

from app.container import Container, build_container
from app.database import open_database
from app.demo_data import build_demo_questions
from app.services.permission_service import StaticPermissionChecker

DEMO_CHAT_ID = -1001111111111
OTHER_CHAT_ID = -1002222222222
CREATOR_ID = 1001


@pytest.fixture
def db(tmp_path):
    """Open a fresh temporary database with migrations applied."""
    database = open_database(tmp_path / "test.sqlite3")
    yield database
    database.close()


@pytest.fixture
def container(db: object) -> Container:
    """Build a fully-wired container over the temp database.

    Permissions default to "everyone is admin" so tests exercise business
    logic, not Telegram access.
    """
    return build_container(
        db, permission_checker=StaticPermissionChecker(result=True)
    )


@pytest.fixture
def admin_checker_allowed() -> StaticPermissionChecker:
    return StaticPermissionChecker(result=True)


@pytest.fixture
def admin_checker_denied() -> StaticPermissionChecker:
    return StaticPermissionChecker(result=False)


def make_running_event(
    container: Container,
    chat_id: int = DEMO_CHAT_ID,
    now: str | None = None,
    question_count: int | None = None,
) -> tuple[object, object]:
    """Create a RUNNING event with questions and an active first question.

    Returns (event, active_question_run).
    """
    from app.utils.time_utils import utc_now_iso

    now = now or utc_now_iso()
    questions = build_demo_questions()
    if question_count is not None:
        questions = questions[:question_count]
    event = container.event_service.create_event(
        chat_id=chat_id,
        created_by=CREATOR_ID,
        title="فعالية اختبار",
        group_title="مجموعة اختبار",
        now=now,
        created_by_name="مشرف",
        game_type="speed_quiz",
        total_questions=len(questions),
    )
    container.event_service.add_questions(event.id, chat_id, questions, now)
    started = container.event_service.start_event(event.id, chat_id, now)
    run = container.question_service.start_next_question(started, now)
    return started, run


def create_user(container: Container, user_id: int, name: str = "عضو") -> None:
    """Ensure a user row exists (services upsert users lazily)."""
    from app.utils.time_utils import utc_now_iso

    container.users.upsert(user_id, name, None, None, utc_now_iso())
