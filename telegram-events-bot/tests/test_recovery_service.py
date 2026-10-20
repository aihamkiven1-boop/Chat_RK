"""Tests for recovery: re-scheduling, closing expired runs, and idempotency."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.container import build_container
from app.constants import EventStatus, QuestionRunStatus
from app.services.permission_service import StaticPermissionChecker

from tests.conftest import DEMO_CHAT_ID, make_running_event

BASE = datetime(2026, 1, 1, 12, 0, 0, tzinfo=UTC)
USER_A = 2001


class Clock:
    """Mutable clock controlling time during a test."""

    def __init__(self, start: datetime = BASE) -> None:
        self._t = start

    def now(self) -> str:
        return self._t.strftime("%Y-%m-%dT%H:%M:%S.%fZ")

    def advance(self, seconds: float) -> None:
        self._t += timedelta(seconds=seconds)


@pytest.fixture
def clocked(db):
    """A container with a controllable clock."""
    clock = Clock()
    container = build_container(
        db, permission_checker=StaticPermissionChecker(True), now_fn=clock.now
    )
    return container, clock


async def test_recovery_reschedules_unexpired_runs(clocked):
    container, clock = clocked
    event, run = make_running_event(container, now=clock.now())
    report = await container.recovery.recover()

    assert run.status == QuestionRunStatus.ACTIVE.value
    assert container.scheduler.has_close_job(event.id, run.id)
    assert any(entry.event_id == event.id for entry in report)
    assert any(entry.action == "RESCHEDULED" for entry in report)


async def test_recovery_twice_creates_no_duplicate_jobs(clocked):
    container, clock = clocked
    event, run = make_running_event(container, now=clock.now())

    await container.recovery.recover()
    await container.recovery.recover()

    assert container.scheduler.pending_count() == 1
    assert container.scheduler.count_scheduled_for_event(event.id) == 1


async def test_recovery_closes_expired_run_and_advances(clocked):
    container, clock = clocked
    event, run = make_running_event(container, now=clock.now())
    clock.advance(20)  # past the 15s window

    await container.recovery.recover()

    closed_run = container.runs.get(run.id)
    assert closed_run.status == QuestionRunStatus.CLOSED.value
    fresh = container.event_service.get_event(event.id, DEMO_CHAT_ID)
    assert fresh.status == EventStatus.RUNNING.value
    assert fresh.current_question_index == 1
    next_run = container.runs.get_active_for_event(event.id)
    assert next_run is not None
    assert container.scheduler.has_close_job(event.id, next_run.id)


async def test_recovery_finishes_event_after_last_question(clocked):
    container, clock = clocked
    event, run = make_running_event(container, now=clock.now(), question_count=1)
    clock.advance(20)

    await container.recovery.recover()

    fresh = container.event_service.get_event(event.id, DEMO_CHAT_ID)
    assert fresh.status == EventStatus.FINISHED.value
    assert container.scheduler.pending_count() == 0


async def test_recovery_does_not_award_additional_points(clocked):
    """Recovering after a crash must never double-award points."""
    container, clock = clocked
    event, run = make_running_event(container, now=clock.now())

    first = container.answer_service.submit_text_answer(
        chat_id=DEMO_CHAT_ID, user_id=USER_A, answer_text="الرياض",
        user_name="أحمد", now=clock.now(),
    )
    assert first.accepted is True
    points_before = container.scores.get_score(event.id, USER_A).points

    clock.advance(20)
    await container.recovery.recover()
    await container.recovery.recover()

    points_after = container.scores.get_score(event.id, USER_A).points
    assert points_before == points_after
    assert container.answers.count_for_run(run.id) == 1


async def test_recovery_restarts_missing_question_run(clocked):
    """A RUNNING event with no active run and remaining questions starts one."""
    container, clock = clocked
    event, run = make_running_event(container, now=clock.now())
    # Simulate a crash where the event is RUNNING but the run was lost.
    with container.db.transaction() as conn:
        conn.execute("DELETE FROM question_runs WHERE id = ?", (run.id,))

    await container.recovery.recover()

    fresh = container.event_service.get_event(event.id, DEMO_CHAT_ID)
    assert fresh.status == EventStatus.RUNNING.value
    next_run = container.runs.get_active_for_event(event.id)
    assert next_run is not None
    assert container.scheduler.has_close_job(event.id, next_run.id)
