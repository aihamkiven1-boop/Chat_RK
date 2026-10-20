"""Tests for answer submission, validation, and transactional scoring."""

from __future__ import annotations

import pytest
import sqlite3
from datetime import UTC, datetime, timedelta

from app.services.answer_service import (
    DUPLICATE_REASON,
    EXPIRED_REASON,
    NO_ACTIVE_QUESTION_REASON,
    NOT_RUNNING_REASON,
)

from tests.conftest import (
    CREATOR_ID,
    DEMO_CHAT_ID,
    OTHER_CHAT_ID,
    make_running_event,
)

BASE = datetime(2026, 1, 1, 12, 0, 0, tzinfo=UTC)


def iso(offset_seconds: float) -> str:
    """Return an ISO timestamp offset from BASE."""
    return (BASE + timedelta(seconds=offset_seconds)).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


USER_A = 2001
USER_B = 2002


@pytest.fixture
def running(container):
    """A RUNNING event whose first question is active."""
    event, run = make_running_event(container, now=iso(0))
    return event, run


def test_correct_answer_accepted_with_points(container, running):
    event, run = running
    result = container.answer_service.submit_text_answer(
        chat_id=DEMO_CHAT_ID,
        user_id=USER_A,
        answer_text="الرياض",
        user_name="أحمد",
        now=iso(2),
    )
    assert result.accepted is True
    assert result.correct is True
    assert 100 <= result.points <= 150

    score = container.scores.get_score(event.id, USER_A)
    assert score is not None
    assert score.points == result.points
    assert score.correct_answers == 1
    assert container.scores.group_member_points(DEMO_CHAT_ID, USER_A) == result.points


def test_scores_update_transactionally(container, running):
    """Points and counts must land in event_scores and group_members together."""
    event, run = running
    container.answer_service.submit_text_answer(
        chat_id=DEMO_CHAT_ID, user_id=USER_A, answer_text="الرياض",
        user_name="أحمد", now=iso(0),
    )
    container.answer_service.submit_text_answer(
        chat_id=DEMO_CHAT_ID, user_id=USER_A, answer_text="خطأ", user_name="أحمد", now=iso(3),
    )
    score = container.scores.get_score(event.id, USER_A)
    assert score.points == 150  # first answer at elapsed=0s
    assert score.correct_answers == 1
    assert container.scores.group_member_points(DEMO_CHAT_ID, USER_A) == 150


def test_wrong_answer_recorded_with_zero_points(container, running):
    event, run = running
    result = container.answer_service.submit_text_answer(
        chat_id=DEMO_CHAT_ID, user_id=USER_A, answer_text="إجابة خاطئة",
        user_name="أحمد", now=iso(2),
    )
    assert result.accepted is True
    assert result.correct is False
    assert result.points == 0
    score = container.scores.get_score(event.id, USER_A)
    assert score.points == 0
    assert score.correct_answers == 0


def test_answer_after_ends_at_rejected(container, running):
    event, run = running
    result = container.answer_service.submit_text_answer(
        chat_id=DEMO_CHAT_ID, user_id=USER_A, answer_text="الرياض",
        user_name="أحمد", now=iso(16),
    )
    assert result.accepted is False
    assert result.rejection_reason == EXPIRED_REASON
    assert container.answers.count_for_run(run.id) == 0


def test_answer_with_no_active_question_rejected(container, running):
    event, run = running
    now = iso(5)
    container.question_service.close_question(run.id, now, event.id)
    result = container.answer_service.submit_text_answer(
        chat_id=DEMO_CHAT_ID, user_id=USER_A, answer_text="الرياض",
        user_name="أحمد", now=iso(6),
    )
    assert result.accepted is False
    assert result.rejection_reason == NO_ACTIVE_QUESTION_REASON


def test_answer_when_no_event_running_rejected(container):
    event, run = make_running_event(container, now=iso(0))
    container.event_service.finish_event(event.id, DEMO_CHAT_ID, iso(2))
    result = container.answer_service.submit_text_answer(
        chat_id=DEMO_CHAT_ID, user_id=USER_A, answer_text="الرياض",
        user_name="أحمد", now=iso(3),
    )
    assert result.accepted is False
    assert result.rejection_reason == NOT_RUNNING_REASON


def test_two_users_can_answer_same_question(container, running):
    event, run = running
    first = container.answer_service.submit_text_answer(
        chat_id=DEMO_CHAT_ID, user_id=USER_A, answer_text="الرياض",
        user_name="أحمد", now=iso(0),
    )
    second = container.answer_service.submit_text_answer(
        chat_id=DEMO_CHAT_ID, user_id=USER_B, answer_text="الرياض",
        user_name="سارة", now=iso(2),
    )
    assert first.accepted is True
    assert second.accepted is True
    assert container.answers.count_for_run(run.id) == 2
    score_a = container.scores.get_score(event.id, USER_A)
    score_b = container.scores.get_score(event.id, USER_B)
    assert score_a.points == 150
    assert score_b.points == 143  # elapsed=2s -> bonus floor(50*13/15)=43
    assert score_a.first_correct_count == 1
    assert score_b.first_correct_count == 0


def test_answer_accepted_creates_user_and_participant(container, running):
    event, run = running
    container.answer_service.submit_text_answer(
        chat_id=DEMO_CHAT_ID, user_id=USER_A, answer_text="الرياض",
        user_name="أحمد", now=iso(2),
    )
    assert container.users.get(USER_A) is not None
    participant = container.participants.get(event.id, USER_A)
    assert participant is not None
    assert participant.chat_id == DEMO_CHAT_ID


def test_events_are_independent_per_group(container):
    """An answer in one group must never affect another group's event."""
    now = iso(0)
    event_a, run_a = make_running_event(container, chat_id=DEMO_CHAT_ID, now=now)
    event_b, run_b = make_running_event(container, chat_id=OTHER_CHAT_ID, now=now)
    container.answer_service.submit_text_answer(
        chat_id=DEMO_CHAT_ID, user_id=USER_A, answer_text="الرياض",
        user_name="أحمد", now=iso(2),
    )
    score_a = container.scores.get_score(event_a.id, USER_A)
    score_b = container.scores.get_score(event_b.id, USER_A)
    assert score_a is not None and score_a.points > 0
    assert score_b is None
