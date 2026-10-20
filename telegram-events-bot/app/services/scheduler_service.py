"""Scheduler service built on the Telegram JobQueue.

Jobs are identified by deterministic names: ``event:{event_id}:question:{run_id}:close``.
The real implementation schedules a run_once job; a FakeScheduler is available
for tests.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Any, Optional

from app.constants import EventStatus
from app.models import QuestionRunRecord
from datetime import UTC

from app.services.event_service import EventService
from app.services.message_service import MessageService
from app.repositories.score_repository import ScoreRepository
from app.services.question_service import QuestionService
from app.utils.time_utils import parse_iso, utc_now_iso

logger = logging.getLogger(__name__)


def close_job_name(event_id: int, run_id: int) -> str:
    """Return the deterministic job name for closing a question run."""
    return f"event:{event_id}:question:{run_id}:close"


class BaseScheduler(ABC):
    """Abstract scheduler interface; swappable with a fake in tests."""

    @abstractmethod
    def schedule_question_close(self, event_id: int, run_id: int, ends_at: str) -> None:
        """Schedule a job to close the question at ``ends_at``."""

    @abstractmethod
    def cancel_event_jobs(self, event_id: int) -> None:
        """Remove all pending jobs of an event."""

    @abstractmethod
    def has_close_job(self, event_id: int, run_id: int) -> bool:
        """Return True when a close job is already scheduled."""


class QuestionCloseDispatcher:
    """Shared logic executed when a question closes."""

    def __init__(
        self,
        question_service: QuestionService,
        event_service: EventService,
        message_service: MessageService,
        question_repository,
        run_repository,
        score_repository: ScoreRepository,
        games,
        scheduler: Optional["BaseScheduler"] = None,
    ) -> None:
        self._questions = question_service
        self._events = event_service
        self._messages = message_service
        self._question_repo = question_repository
        self._run_repo = run_repository
        self._games = games
        self._scores = score_repository
        self._scheduler = scheduler

    def set_scheduler(self, scheduler: "BaseScheduler") -> None:
        """Attach the scheduler so the next question can be scheduled."""
        self._scheduler = scheduler

    async def begin_event(
        self, context, event: EventRecord, now: str
    ) -> Optional[QuestionRunRecord]:
        """Start the first question of a just-started event."""
        run = self._questions.start_next_question(event, now)
        if self._scheduler is not None:
            self._scheduler.schedule_question_close(event.id, run.id, run.ends_at)
        question = self._question_repo.get(run.question_id)
        game = self._games.get(event.game_type)
        await self._messages.send_question(
            context,
            chat_id=event.chat_id,
            question_text=game.render_question(question),
            question_number=event.current_question_index + 1,
            total_questions=event.total_questions,
        )
        return run

    async def run(self, event_id: int, run_id: int, now: str, context=None) -> None:
        """Close the question, announce the result, then advance or finish.

        Idempotent: safe to call more than once (e.g. a scheduled job firing
        after recovery already handled the run).
        """
        event = self._events.get_event(event_id)

        run = self._run_repo.get(run_id)
        question = self._question_repo.get(run.question_id) if run else None
        closed_question_number = (question.order_number + 1) if question else (event.current_question_index + 1)
        correct_answer = question.correct_answer if question else "—"

        result = self._questions.close_question(run_id, now, event_id)
        event = self._events.get_event(event_id)

        await self._messages.announce_question_result(
            context,
            chat_id=event.chat_id,
            question_number=closed_question_number,
            correct_answer=correct_answer,
        )
        if result.event_finished:
            if event.status == EventStatus.RUNNING.value:
                finished = self._events.finish_event(event_id, event.chat_id, now)
                winner = self._scores.leaderboard_for_event(event_id)
                if winner:
                    self._scores.record_win(event_id, event.chat_id, winner[0].user_id, now)
                await self._messages.announce_event_end(context, finished)
            return
        fresh = self._events.get_event(event_id)
        next_run = self._questions.start_next_question(fresh, now)
        if self._scheduler is not None:
            self._scheduler.schedule_question_close(fresh.id, next_run.id, next_run.ends_at)
        question = self._question_repo.get(next_run.question_id)
        game = self._games.get(event.game_type)
        await self._messages.send_question(
            context,
            chat_id=fresh.chat_id,
            question_text=game.render_question(question),
            question_number=fresh.current_question_index + 1,
            total_questions=fresh.total_questions,
        )


class JobQueueScheduler(BaseScheduler):
    """Scheduler backed by the python-telegram-bot JobQueue."""

    def __init__(
        self,
        job_queue,
        dispatcher: QuestionCloseDispatcher,
    ) -> None:
        self._queue = job_queue
        self._dispatcher = dispatcher

    async def _on_close(self, context: Any) -> None:
        job = context.job
        event_id = int(job.data["event_id"])
        run_id = int(job.data["run_id"])
        await self._dispatcher.run(event_id, run_id, utc_now_iso(), context)

    def schedule_question_close(self, event_id: int, run_id: int, ends_at: str) -> None:
        name = close_job_name(event_id, run_id)
        if self.has_close_job(event_id, run_id):
            logger.debug("Close job already scheduled: %s", name)
            return
        when = parse_iso(ends_at).astimezone(UTC)
        self._queue.run_once(
            self._on_close,
            when=when,
            name=name,
            data={"event_id": event_id, "run_id": run_id},
        )
        logger.info("Scheduled close job %s at %s", name, ends_at)

    def cancel_event_jobs(self, event_id: int) -> None:
        names = [
            job.name for job in self._queue.jobs() if self._job_belongs_to(job.name, event_id)
        ]
        for job in self._queue.jobs():
            if self._job_belongs_to(job.name, event_id):
                job.schedule_removal()
        if names:
            logger.info("Cancelled %d pending jobs for event %s", len(names), event_id)

    def has_close_job(self, event_id: int, run_id: int) -> bool:
        name = close_job_name(event_id, run_id)
        return any(job.name == name for job in self._queue.jobs())

    @staticmethod
    def _job_belongs_to(job_name: Optional[str], event_id: int) -> bool:
        if not job_name:
            return False
        prefix = f"event:{event_id}:"
        return job_name.startswith(prefix)


class FakeScheduler(BaseScheduler):
    """In-memory scheduler used by tests and dry-runs."""

    def __init__(self, dispatcher: QuestionCloseDispatcher) -> None:
        self._dispatcher = dispatcher
        self._jobs: dict[str, tuple[int, int, str]] = {}
        self.scheduled: list[tuple[int, int, str]] = []
        self.cancelled: list[int] = []

    def schedule_question_close(self, event_id: int, run_id: int, ends_at: str) -> None:
        name = close_job_name(event_id, run_id)
        if name in self._jobs:
            return
        self._jobs[name] = (event_id, run_id, ends_at)
        self.scheduled.append((event_id, run_id, ends_at))

    def cancel_event_jobs(self, event_id: int) -> None:
        to_remove = [name for name, (eid, _, _) in self._jobs.items() if eid == event_id]
        for name in to_remove:
            del self._jobs[name]
        if to_remove:
            self.cancelled.append(event_id)

    def has_close_job(self, event_id: int, run_id: int) -> bool:
        return close_job_name(event_id, run_id) in self._jobs

    def pending_count(self) -> int:
        """Number of scheduled but unfired jobs."""
        return len(self._jobs)

    async def fire(self, event_id: int, run_id: int, now: str, context=None) -> None:
        """Execute the close logic for a job (used by tests)."""
        name = close_job_name(event_id, run_id)
        self._jobs.pop(name, None)
        await self._dispatcher.run(event_id, run_id, now, context)

    def count_scheduled_for_event(self, event_id: int) -> int:
        """Number of jobs scheduled for an event."""
        return sum(1 for eid, _, _ in self.scheduled if eid == event_id)
