"""Tests for the single-active-event-per-group rule."""

from __future__ import annotations

import pytest

from app.constants import EventStatus
from app.exceptions import EventConflictError
from app.utils.time_utils import utc_now_iso

from tests.conftest import CREATOR_ID, DEMO_CHAT_ID, OTHER_CHAT_ID


def _create(container, chat_id, now):
    return container.event_service.create_event(
        chat_id=chat_id,
        created_by=CREATOR_ID,
        title="فعالية",
        group_title="مجموعة",
        now=now,
    )


def test_second_active_event_same_group_rejected(container):
    now = utc_now_iso()
    _create(container, DEMO_CHAT_ID, now)
    with pytest.raises(EventConflictError):
        _create(container, DEMO_CHAT_ID, now)


def test_database_constraint_rejects_second_active_event(container):
    """The partial unique index is the final gate even without the service check."""
    now = utc_now_iso()
    _create(container, DEMO_CHAT_ID, now)
    with pytest.raises(EventConflictError):
        container.events.create(
            chat_id=DEMO_CHAT_ID,
            created_by=CREATOR_ID,
            game_type="speed_quiz",
            title="ثانية",
            total_questions=5,
            status=EventStatus.REGISTRATION,
            now=now,
        )


def test_active_event_allowed_in_two_different_groups(container):
    now = utc_now_iso()
    event_a = _create(container, DEMO_CHAT_ID, now)
    event_b = _create(container, OTHER_CHAT_ID, now)
    assert event_a.chat_id == DEMO_CHAT_ID
    assert event_b.chat_id == OTHER_CHAT_ID


def test_new_event_allowed_after_finished(container):
    from tests.conftest import make_running_event

    event, run = make_running_event(container, now=utc_now_iso())
    now = utc_now_iso()
    container.question_service.close_question(run.id, now, event.id)
    container.event_service.finish_event(event.id, DEMO_CHAT_ID, now)
    _create(container, DEMO_CHAT_ID, now)  # must not raise


def test_active_count_is_one(container):
    now = utc_now_iso()
    _create(container, DEMO_CHAT_ID, now)
    assert container.events.count_active(DEMO_CHAT_ID) == 1
