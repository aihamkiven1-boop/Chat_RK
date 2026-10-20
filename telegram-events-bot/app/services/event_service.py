"""Event lifecycle service: state machine and event management."""

from __future__ import annotations

import json
import logging
from typing import Optional

from app.constants import DEFAULT_QUESTIONS_PER_EVENT, EventStatus
from app.exceptions import (
    EventConflictError,
    InvalidStateTransitionError,
    NotFoundError,
)
from app.games.game_registry import GameRegistry
from app.models import EventRecord, QuestionInput, QuestionRecord
from app.repositories.event_repository import EventRepository
from app.repositories.group_repository import GroupRepository
from app.repositories.question_repository import QuestionRepository
from app.repositories.user_repository import UserRepository
from app.utils.validators import (
    validate_duration,
    validate_event_title,
    validate_question_count,
)

logger = logging.getLogger(__name__)

# Allowed state transitions for an event.
_ALLOWED_TRANSITIONS: dict[EventStatus, set[EventStatus]] = {
    EventStatus.DRAFT: {EventStatus.REGISTRATION},
    EventStatus.REGISTRATION: {EventStatus.RUNNING, EventStatus.CANCELLED},
    EventStatus.RUNNING: {EventStatus.RUNNING, EventStatus.FINISHED, EventStatus.FAILED},
    EventStatus.FINISHED: set(),
    EventStatus.CANCELLED: set(),
    EventStatus.FAILED: set(),
}


class EventService:
    """Implements the event lifecycle and its state machine."""

    def __init__(
        self,
        event_repository: EventRepository,
        question_repository: QuestionRepository,
        group_repository: GroupRepository,
        user_repository: UserRepository,
        games: GameRegistry,
    ) -> None:
        self._events = event_repository
        self._questions = question_repository
        self._groups = group_repository
        self._users = user_repository
        self._games = games

    # -- helpers ------------------------------------------------------------
    def _ensure_group_and_user(
        self, chat_id: int, title: str, user_id: int, user_name: str, now: str
    ) -> None:
        self._groups.upsert(chat_id, title, now)
        if self._users.get(user_id) is None:
            self._users.upsert(user_id, user_name, None, None, now)

    @staticmethod
    def _status(value: str) -> EventStatus:
        return EventStatus(value)

    def assert_transition_allowed(
        self, current: EventStatus, target: EventStatus
    ) -> None:
        """Raise InvalidStateTransitionError for a disallowed transition."""
        allowed = _ALLOWED_TRANSITIONS.get(current, set())
        if target not in allowed:
            raise InvalidStateTransitionError(
                f"لا يمكن الانتقال من {current.value} إلى {target.value}."
            )

    # -- creation -----------------------------------------------------------
    def create_event(
        self,
        chat_id: int,
        created_by: int,
        title: str,
        group_title: str,
        now: str,
        created_by_name: str = "",
        game_type: str = "speed_quiz",
        total_questions: int = DEFAULT_QUESTIONS_PER_EVENT,
    ) -> EventRecord:
        """Create a new event in REGISTRATION status.

        Only one active event is allowed per group; enforced by the partial
        unique index as a final gate.
        """
        title = validate_event_title(title)
        validate_question_count(total_questions)
        if not self._games.is_supported(game_type):
            raise NotFoundError(f"نوع اللعبة غير مدعوم: {game_type}")
        self._ensure_group_and_user(chat_id, group_title, created_by, created_by_name, now)
        if self._events.has_active_event(chat_id):
            raise EventConflictError(
                "يوجد فعالية نشطة في هذه المجموعة. أنهِ الفعالية الحالية أولًا."
            )
        event = self._events.create(
            chat_id=chat_id,
            created_by=created_by,
            game_type=game_type,
            title=title,
            total_questions=total_questions,
            status=EventStatus.REGISTRATION,
            now=now,
        )
        logger.info("Event %s created in chat %s", event.id, chat_id)
        return event

    def add_questions(
        self, event_id: int, chat_id: int, questions: list[QuestionInput], now: str
    ) -> list[QuestionRecord]:
        """Register questions to an event in REGISTRATION status."""
        event = self._events.get_required(event_id, chat_id)
        if event.status != EventStatus.REGISTRATION.value:
            raise InvalidStateTransitionError(
                "لا يمكن إضافة أسئلة إلا أثناء حالة التسجيل."
            )
        if not questions:
            raise NotFoundError("لا توجد أسئلة لإضافتها.")
        validate_question_count(len(questions) + self._questions.count_for_event(event_id))
        game = self._games.get(event.game_type)
        created: list[QuestionRecord] = []
        for q in questions:
            record = QuestionRecord(
                id=0,
                event_id=event_id,
                question_text=q.question_text,
                correct_answer=q.correct_answer,
                options_json=json.dumps(q.options) if q.options else None,
                base_points=q.base_points,
                duration_seconds=validate_duration(q.duration_seconds),
                order_number=q.order_number,
                created_at=now,
            )
            game.validate_question(record)
            created.append(
                self._questions.create(
                    event_id=event_id,
                    question_text=q.question_text,
                    correct_answer=q.correct_answer,
                    order_number=q.order_number,
                    now=now,
                    options_json=record.options_json,
                    base_points=q.base_points,
                    duration_seconds=q.duration_seconds,
                )
            )
        return created

    # -- lifecycle ----------------------------------------------------------
    def start_event(self, event_id: int, chat_id: int, now: str) -> EventRecord:
        """Transition REGISTRATION -> RUNNING and record the start time."""
        event = self._events.get_required(event_id, chat_id)
        self.assert_transition_allowed(self._status(event.status), EventStatus.RUNNING)
        if self._questions.count_for_event(event_id) == 0:
            raise NotFoundError("لا يمكن بدء فعالية بدون أسئلة.")
        self._events.transition(
            event_id, EventStatus.REGISTRATION, EventStatus.RUNNING, now, chat_id
        )
        self._events.mark_started(event_id, now)
        logger.info("Event %s started in chat %s", event_id, chat_id)
        return self._events.get_required(event_id, chat_id)

    def cancel_event(self, event_id: int, chat_id: int, now: str) -> EventRecord:
        """Transition REGISTRATION -> CANCELLED."""
        event = self._events.get_required(event_id, chat_id)
        self.assert_transition_allowed(self._status(event.status), EventStatus.CANCELLED)
        self._events.transition(
            event_id, EventStatus.REGISTRATION, EventStatus.CANCELLED, now, chat_id
        )
        self._events.mark_cancelled(event_id, now)
        logger.info("Event %s cancelled in chat %s", event_id, chat_id)
        return self._events.get_required(event_id, chat_id)

    def finish_event(self, event_id: int, chat_id: int, now: str) -> EventRecord:
        """Transition RUNNING -> FINISHED and record the finish time."""
        event = self._events.get_required(event_id, chat_id)
        self.assert_transition_allowed(self._status(event.status), EventStatus.FINISHED)
        self._events.transition(
            event_id, EventStatus.RUNNING, EventStatus.FINISHED, now, chat_id
        )
        self._events.mark_finished(event_id, now)
        logger.info("Event %s finished in chat %s", event_id, chat_id)
        return self._events.get_required(event_id, chat_id)

    def fail_event(self, event_id: int, chat_id: int, reason: str, now: str) -> EventRecord:
        """Transition RUNNING -> FAILED when the event cannot be recovered."""
        event = self._events.get_required(event_id, chat_id)
        self.assert_transition_allowed(self._status(event.status), EventStatus.FAILED)
        self._events.mark_failed(event_id, reason, now)
        logger.error("Event %s failed in chat %s: %s", event_id, chat_id, reason)
        return self._events.get_required(event_id, chat_id)

    # -- queries ------------------------------------------------------------
    def get_event(self, event_id: int, chat_id: int | None = None) -> EventRecord:
        """Fetch an event or raise NotFoundError."""
        return self._events.get_required(event_id, chat_id)

    def get_active_event(self, chat_id: int) -> Optional[EventRecord]:
        """Return the active event of a group, if any."""
        return self._events.get_active_for_chat(chat_id)

    def get_event_status(self, event_id: int, chat_id: int) -> str:
        """Return the status string of an event."""
        return self.get_event(event_id, chat_id).status

    def get_running_events(self) -> list[EventRecord]:
        """Return all RUNNING events (used by recovery)."""
        return self._events.get_running_events()
