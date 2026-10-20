"""Question orchestration: starting runs and closing questions."""

from __future__ import annotations

import logging
from typing import Optional

from app.constants import EventStatus
from app.exceptions import DomainError, NotFoundError
from app.models import EventRecord, QuestionCloseResult, QuestionRunRecord
from app.repositories.event_repository import EventRepository
from app.repositories.question_repository import QuestionRepository
from app.repositories.question_run_repository import QuestionRunRepository
from app.utils.time_utils import add_seconds_iso, parse_iso

logger = logging.getLogger(__name__)


class QuestionService:
    """Determines the next question, creates runs, and closes questions."""

    def __init__(
        self,
        event_repository: EventRepository,
        question_repository: QuestionRepository,
        run_repository: QuestionRunRepository,
    ) -> None:
        self._events = event_repository
        self._questions = question_repository
        self._runs = run_repository

    def start_next_question(
        self, event: EventRecord, now: str, bot_message_id: Optional[int] = None
    ) -> QuestionRunRecord:
        """Start the question at ``event.current_question_index``.

        Idempotent: if the event already has an ACTIVE run, that run is reused
        and the event pointer is synchronized to its question.
        """
        if event.status != EventStatus.RUNNING.value:
            raise DomainError("لا يمكن بدء سؤال إلا أثناء تشغيل الفعالية.")
        existing = self._runs.get_active_for_event(event.id)
        if existing is not None:
            existing_question = self._questions.get(existing.question_id)
            if existing_question is not None:
                self._events.update_question_pointer(
                    event.id, existing_question.order_number, existing_question.id
                )
                return existing
        question = self._questions.get_by_order(event.id, event.current_question_index)
        if question is None:
            raise NotFoundError(
                f"لا يوجد سؤال بالترتيب {event.current_question_index}."
            )
        started_at = now
        ends_at = add_seconds_iso(parse_iso(now), question.duration_seconds)
        run = self._runs.create_active(
            event_id=event.id,
            question_id=question.id,
            started_at=started_at,
            ends_at=ends_at,
            now=now,
            bot_message_id=bot_message_id,
        )
        self._events.update_question_pointer(
            event.id, event.current_question_index, question.id
        )
        logger.info(
            "Event %s question %s run %s started (ends %s)",
            event.id,
            question.id,
            run.id,
            ends_at,
        )
        return run

    def close_question(
        self, run_id: int, now: str, event_id: Optional[int] = None
    ) -> QuestionCloseResult:
        """Idempotently close a question run and advance the pointer.

        Closing an already-closed run is a no-op that reports the current
        progress instead of advancing a second time.
        """
        run = self._runs.get(run_id)
        if run is None:
            raise NotFoundError("السؤال غير موجود.")
        event = self._events.get_required(run.event_id)
        if event.status != EventStatus.RUNNING.value:
            return QuestionCloseResult(closed=False, event_finished=True)
        question = self._questions.get(run.question_id)
        order = question.order_number if question else event.current_question_index
        closed = self._runs.close(run_id, now)
        if not closed and order < event.current_question_index:
            # Pointer already moved past this question; nothing to advance.
            if event.current_question_index >= event.total_questions:
                return QuestionCloseResult(closed=False, event_finished=True)
            return QuestionCloseResult(
                closed=False, next_question_index=event.current_question_index
            )
        next_index = order + 1
        if next_index >= event.total_questions:
            self._events.update_question_pointer(
                event.id, event.current_question_index, None
            )
            return QuestionCloseResult(closed=closed, event_finished=True)
        self._events.update_question_pointer(event.id, next_index, None)
        return QuestionCloseResult(closed=closed, next_question_index=next_index)
