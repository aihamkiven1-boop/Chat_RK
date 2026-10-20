"""Tests for leaderboard ordering and tie-breaking.

Tie-break order: points desc, correct_answers desc, first-correct time asc,
user_id asc.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from tests.conftest import DEMO_CHAT_ID, make_running_event

BASE = datetime(2026, 1, 1, 12, 0, 0, tzinfo=UTC)


def iso(offset: float) -> str:
    return (BASE + timedelta(seconds=offset)).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _make_scored_event(container, players):
    """Create a running event and seed per-user scores/answers directly.

    ``players`` is a list of dicts with user_id, points, correct_answers,
    first_answer_at. The answers reference the real active question run.
    """
    event, run = make_running_event(container, now=iso(0))
    with container.db.transaction() as conn:
        for player in players:
            user_id = player["user_id"]
            conn.execute(
                "INSERT OR IGNORE INTO users (user_id, username, first_name, last_name, created_at, updated_at)"
                " VALUES (?, NULL, ?, NULL, ?, ?)",
                (user_id, f"عضو{user_id}", iso(0), iso(0)),
            )
            conn.execute(
                "INSERT INTO event_scores (event_id, chat_id, user_id, points, correct_answers, first_correct_count, updated_at)"
                " VALUES (?, ?, ?, ?, ?, 0, ?)",
                (event.id, DEMO_CHAT_ID, user_id, player["points"], player["correct_answers"], iso(0)),
            )
            conn.execute(
                "INSERT INTO answers (event_id, question_id, question_run_id, chat_id, user_id, answer_text, normalized_answer, is_correct, points, answered_at)"
                " VALUES (?, ?, ?, ?, ?, 'جواب', 'جواب', 1, ?, ?)",
                (event.id, run.question_id, run.id, DEMO_CHAT_ID, user_id, player["points"], player["first_answer_at"]),
            )
    return event


def test_leaderboard_orders_by_points_desc(container):
    event = _make_scored_event(
        container,
        [
            {"user_id": 1, "points": 150, "correct_answers": 1, "first_answer_at": iso(5)},
            {"user_id": 2, "points": 125, "correct_answers": 1, "first_answer_at": iso(3)},
        ],
    )
    entries = container.leaderboards.event_leaderboard(event.id, DEMO_CHAT_ID)
    assert [e.user_id for e in entries] == [1, 2]


def test_leaderboard_tiebreak_by_first_correct_time(container):
    """Equal points and correct answers -> earlier first-correct ranks first."""
    event = _make_scored_event(
        container,
        [
            {"user_id": 10, "points": 100, "correct_answers": 1, "first_answer_at": iso(8)},
            {"user_id": 20, "points": 100, "correct_answers": 1, "first_answer_at": iso(2)},
        ],
    )
    entries = container.leaderboards.event_leaderboard(event.id, DEMO_CHAT_ID)
    assert [e.user_id for e in entries] == [20, 10]
    assert entries[0].rank == 1
    assert entries[1].rank == 2


def test_leaderboard_tiebreak_by_user_id_last(container):
    """Identical scores and times -> lower user_id ranks first."""
    event = _make_scored_event(
        container,
        [
            {"user_id": 30, "points": 100, "correct_answers": 1, "first_answer_at": iso(3)},
            {"user_id": 20, "points": 100, "correct_answers": 1, "first_answer_at": iso(3)},
        ],
    )
    entries = container.leaderboards.event_leaderboard(event.id, DEMO_CHAT_ID)
    assert [e.user_id for e in entries] == [20, 30]


def test_group_leaderboard_orders_by_total_points(container):
    event, run = make_running_event(container, now=iso(0))
    container.answer_service.submit_text_answer(
        chat_id=DEMO_CHAT_ID, user_id=2001, answer_text="الرياض",
        user_name="أحمد", now=iso(0),
    )
    container.answer_service.submit_text_answer(
        chat_id=DEMO_CHAT_ID, user_id=2002, answer_text="الرياض",
        user_name="سارة", now=iso(2),
    )
    entries = container.leaderboards.group_leaderboard(DEMO_CHAT_ID)
    assert [e.user_id for e in entries] == [2001, 2002]
    assert entries[0].points == 150
    assert entries[1].points == 143



def test_event_finish_records_group_win(container):
    event, run = make_running_event(container, now=iso(0), question_count=1)
    container.answer_service.submit_text_answer(
        chat_id=DEMO_CHAT_ID, user_id=2001, answer_text="الرياض",
        user_name="أحمد", now=iso(1),
    )
    # Fire the close job so the dispatcher finishes the event and records the win.
    import asyncio
    asyncio.run(container.scheduler.fire(event.id, run.id, iso(20)))

    group_wins = container.db.execute(
        "SELECT wins FROM group_members WHERE chat_id = ? AND user_id = ?",
        (DEMO_CHAT_ID, 2001),
    ).fetchone()
    assert group_wins is not None
    assert group_wins[0] == 1
