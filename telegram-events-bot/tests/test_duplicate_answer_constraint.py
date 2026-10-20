"""Tests that duplicate answers are rejected by the SQLite UNIQUE constraint."""

from __future__ import annotations

import pytest
import sqlite3

from app.services.answer_service import DUPLICATE_REASON

from tests.conftest import DEMO_CHAT_ID, make_running_event

USER_A = 2001
USER_B = 2002


def _iso(offset: float) -> str:
    from datetime import UTC, datetime, timedelta

    base = datetime(2026, 1, 1, 12, 0, 0, tzinfo=UTC)
    return (base + timedelta(seconds=offset)).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def test_duplicate_answer_rejected_by_service(container):
    event, run = make_running_event(container, now=_iso(0))
    first = container.answer_service.submit_text_answer(
        chat_id=DEMO_CHAT_ID, user_id=USER_A, answer_text="الرياض",
        user_name="أحمد", now=_iso(2),
    )
    second = container.answer_service.submit_text_answer(
        chat_id=DEMO_CHAT_ID, user_id=USER_A, answer_text="الرياض",
        user_name="أحمد", now=_iso(4),
    )
    assert first.accepted is True
    assert second.accepted is False
    assert second.rejection_reason == DUPLICATE_REASON
    assert container.answers.count_for_run(run.id) == 1


def test_duplicate_rejected_even_with_different_text(container):
    """A second answer with different text is still a duplicate."""
    event, run = make_running_event(container, now=_iso(0))
    container.answer_service.submit_text_answer(
        chat_id=DEMO_CHAT_ID, user_id=USER_A, answer_text="الرياض",
        user_name="أحمد", now=_iso(2),
    )
    second = container.answer_service.submit_text_answer(
        chat_id=DEMO_CHAT_ID, user_id=USER_A, answer_text="طوكيو",
        user_name="أحمد", now=_iso(4),
    )
    assert second.accepted is False
    assert second.rejection_reason == DUPLICATE_REASON


def test_sqlite_unique_constraint_is_final_gate(container):
    """Inserting the same (run, user) directly must raise IntegrityError."""
    event, run = make_running_event(container, now=_iso(0))
    container.users.upsert(USER_A, "أحمد", None, None, _iso(0))
    with container.db.transaction() as conn:
        container.answers.create(
            conn,
            event_id=event.id,
            question_id=run.question_id,
            question_run_id=run.id,
            chat_id=DEMO_CHAT_ID,
            user_id=USER_A,
            answer_text="جواب",
            normalized_answer="جواب",
            is_correct=True,
            points=150,
            answered_at=_iso(2),
        )
    with pytest.raises(sqlite3.IntegrityError):
        with container.db.transaction() as conn:
            container.answers.create(
                conn,
                event_id=event.id,
                question_id=run.question_id,
                question_run_id=run.id,
                chat_id=DEMO_CHAT_ID,
                user_id=USER_A,
                answer_text="مرة أخرى",
                normalized_answer="مرة اخرى",
                is_correct=False,
                points=0,
                answered_at=_iso(4),
            )


def test_different_users_same_question_both_allowed(container):
    event, run = make_running_event(container, now=_iso(0))
    a = container.answer_service.submit_text_answer(
        chat_id=DEMO_CHAT_ID, user_id=USER_A, answer_text="الرياض",
        user_name="أحمد", now=_iso(2),
    )
    b = container.answer_service.submit_text_answer(
        chat_id=DEMO_CHAT_ID, user_id=USER_B, answer_text="الرياض",
        user_name="سارة", now=_iso(3),
    )
    assert a.accepted is True
    assert b.accepted is True
    assert container.answers.count_for_run(run.id) == 2
