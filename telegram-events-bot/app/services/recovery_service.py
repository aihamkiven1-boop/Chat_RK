"""Recovery service: safe restoration of running events after a restart."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Callable

from app.constants import EventStatus
from app.repositories.question_run_repository import QuestionRunRepository
from app.services.event_service import EventService
from app.services.question_service import QuestionService
from app.services.scheduler_service import BaseScheduler
from app.utils.time_utils import utc_now_iso

logger = logging.getLogger(__name__)


@dataclass
class RecoveryEntry:
    """Outcome of recovering a single event."""

    event_id: int
    action: str
    detail: str = ""


class RecoveryService:
    """Restores RUNNING events and re-schedules timers at startup.

    Idempotent: running recovery twice never re-awards points and never creates
    duplicate jobs.
    """

    def __init__(
        self,
        event_service: EventService,
        question_service: QuestionService,
        run_repository: QuestionRunRepository,
        scheduler: BaseScheduler,
        dispatcher,
        now_fn: Callable[[], str] = utc_now_iso,
    ) -> None:
        self._events = event_service
        self._questions = question_service
        self._runs = run_repository
        self._scheduler = scheduler
        self._dispatcher = dispatcher
        self._now_fn = now_fn

    def set_scheduler(self, scheduler: BaseScheduler) -> None:
        """Swap the scheduler used for re-scheduling (e.g. at production start)."""
        self._scheduler = scheduler

    async def recover(self) -> list[RecoveryEntry]:
        """Recover all RUNNING events. Safe to call multiple times."""
        report: list[RecoveryEntry] = []
        for event in self._events.get_running_events():
            try:
                report.append(await self._recover_event(event.id))
            except Exception:
                logger.exception("Failed to recover event %s", event.id)
                report.append(
                    RecoveryEntry(event.id, "FAILED", "تعذرت استعادة الفعالية.")
                )
        return report

    async def _recover_event(self, event_id: int) -> RecoveryEntry:
        now = self._now_fn()
        event = self._events.get_event(event_id)
        if event.status != EventStatus.RUNNING.value:
            return RecoveryEntry(event_id, "SKIPPED", "ليست قيد التشغيل.")

        active_run = self._runs.get_active_for_event(event_id)
        if active_run is None:
            if event.current_question_index >= event.total_questions:
                self._events.finish_event(event_id, event.chat_id, now)
                return RecoveryEntry(event_id, "FINISHED", "اكتملت الأسئلة دون إنهاء.")
            fresh = self._events.get_event(event_id)
            run = self._questions.start_next_question(fresh, now)
            self._scheduler.schedule_question_close(event_id, run.id, run.ends_at)
            return RecoveryEntry(
                event_id, "STARTED", f"بدء السؤال رقم {fresh.current_question_index + 1}."
            )

        if now >= active_run.ends_at:
            await self._dispatcher.run(event_id, active_run.id, now, context=None)
            fresh = self._events.get_event(event_id)
            action = "FINISHED" if fresh.status == EventStatus.FINISHED.value else "ADVANCED"
            return RecoveryEntry(event_id, action, "إغلاق سؤال منتهٍ والمضي قدمًا.")

        self._scheduler.schedule_question_close(event_id, active_run.id, active_run.ends_at)
        return RecoveryEntry(
            event_id, "RESCHEDULED", f"إعادة جدولة الإغلاق حتى {active_run.ends_at}."
        )
