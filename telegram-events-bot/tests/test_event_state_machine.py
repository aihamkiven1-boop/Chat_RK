"""Tests for the event state machine transitions."""

from __future__ import annotations

import pytest

from app.constants import EventStatus
from app.exceptions import InvalidStateTransitionError
from app.models import QuestionInput
from app.utils.time_utils import utc_now_iso

from tests.conftest import CREATOR_ID, DEMO_CHAT_ID


@pytest.fixture
def draft_event(container):
    """A REGISTRATION event (created directly, as /event does)."""
    now = utc_now_iso()
    return container.event_service.create_event(
        chat_id=DEMO_CHAT_ID,
        created_by=CREATOR_ID,
        title="فعالية",
        group_title="مجموعة",
        now=now,
    )


def _add_question(container, event_id, now, text="سؤال", answer="جواب", order=0):
    container.event_service.add_questions(
        event_id,
        DEMO_CHAT_ID,
        [QuestionInput(question_text=text, correct_answer=answer, order_number=order)],
        now,
    )


def test_allowed_transition_registration_to_running(container, draft_event):
    _add_question(container, draft_event.id, utc_now_iso())
    started = container.event_service.start_event(
        draft_event.id, DEMO_CHAT_ID, utc_now_iso()
    )
    assert started.status == EventStatus.RUNNING.value


def test_allowed_transition_running_to_finished(container, draft_event):
    now = utc_now_iso()
    _add_question(container, draft_event.id, now)
    event = container.event_service.start_event(draft_event.id, DEMO_CHAT_ID, now)
    finished = container.event_service.finish_event(event.id, DEMO_CHAT_ID, now)
    assert finished.status == EventStatus.FINISHED.value


def test_allowed_transition_registration_to_cancelled(container, draft_event):
    cancelled = container.event_service.cancel_event(
        draft_event.id, DEMO_CHAT_ID, utc_now_iso()
    )
    assert cancelled.status == EventStatus.CANCELLED.value


def test_running_to_running_next_question_allowed(container):
    """Moving to the next question keeps the event RUNNING."""
    from tests.conftest import make_running_event

    event, run = make_running_event(container)
    now = utc_now_iso()
    result = container.question_service.close_question(run.id, now, event.id)
    assert result.event_finished is False
    assert result.next_question_index == 1
    next_event = container.event_service.get_event(event.id, DEMO_CHAT_ID)
    assert next_event.status == EventStatus.RUNNING.value


def test_disallowed_finish_from_registration(container, draft_event):
    with pytest.raises(InvalidStateTransitionError):
        container.event_service.finish_event(draft_event.id, DEMO_CHAT_ID, utc_now_iso())


def test_disallowed_cancel_from_running(container):
    from tests.conftest import make_running_event

    event, _ = make_running_event(container)
    with pytest.raises(InvalidStateTransitionError):
        container.event_service.cancel_event(event.id, DEMO_CHAT_ID, utc_now_iso())


def test_disallowed_start_from_running(container):
    from tests.conftest import make_running_event

    event, _ = make_running_event(container)
    with pytest.raises(InvalidStateTransitionError):
        container.event_service.start_event(event.id, DEMO_CHAT_ID, utc_now_iso())


def test_disallowed_transition_from_finished(container):
    from tests.conftest import make_running_event

    event, run = make_running_event(container)
    now = utc_now_iso()
    container.question_service.close_question(run.id, now, event.id)
    container.event_service.finish_event(event.id, DEMO_CHAT_ID, now)
    with pytest.raises(InvalidStateTransitionError):
        container.event_service.start_event(event.id, DEMO_CHAT_ID, now)


async def test_question_close_announcement_uses_closed_question_number(container, monkeypatch):
    from tests.conftest import make_running_event

    event, run = make_running_event(container)
    messages: list[str] = []

    async def capture(_context, _chat_id, text):
        messages.append(text)
        return None

    monkeypatch.setattr(container.message_service, "send_group_message", capture)

    await container.dispatcher.run(event.id, run.id, utc_now_iso(), context=None)

    assert messages, "Expected the dispatcher to emit at least one message."
    assert messages[0].startswith("⏱ انتهى وقت السؤال 1.")
