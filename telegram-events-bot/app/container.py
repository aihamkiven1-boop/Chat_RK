"""Composition root: wires repositories, games, and services together.

Used by both main.py (production) and tests (with a temp database and an
injectable scheduler/checker).
"""

from __future__ import annotations

from typing import Callable, Optional

from app.database import Database
from app.games.game_registry import build_default_registry
from app.repositories.answer_repository import AnswerRepository
from app.repositories.event_repository import EventRepository
from app.repositories.group_repository import GroupRepository
from app.repositories.participant_repository import ParticipantRepository
from app.repositories.question_repository import QuestionRepository
from app.repositories.question_run_repository import QuestionRunRepository
from app.repositories.score_repository import ScoreRepository
from app.repositories.user_repository import UserRepository
from app.services.answer_service import AnswerService
from app.services.event_service import EventService
from app.services.leaderboard_service import LeaderboardService
from app.services.message_service import MessageService
from app.services.permission_service import (
    PermissionChecker,
    PermissionService,
    StaticPermissionChecker,
)
from app.services.question_service import QuestionService
from app.services.recovery_service import RecoveryService
from app.services.scheduler_service import (
    BaseScheduler,
    FakeScheduler,
    QuestionCloseDispatcher,
)
from app.utils.time_utils import utc_now_iso


class Container:
    """Holds all repositories, services, and the scheduler."""

    def __init__(
        self,
        db: Database,
        permission_checker: Optional[PermissionChecker] = None,
        scheduler: Optional[BaseScheduler] = None,
        now_fn: Callable[[], str] = utc_now_iso,
    ) -> None:
        self.db = db
        self.now_fn = now_fn

        # Games
        self.games = build_default_registry()

        # Repositories
        self.groups = GroupRepository(db)
        self.users = UserRepository(db)
        self.events = EventRepository(db)
        self.questions = QuestionRepository(db)
        self.runs = QuestionRunRepository(db)
        self.answers = AnswerRepository(db)
        self.scores = ScoreRepository(db)
        self.participants = ParticipantRepository(db)

        # Services
        self.leaderboards = LeaderboardService(self.events, self.scores, self.runs)
        self.message_service = MessageService(self.leaderboards)
        self.event_service = EventService(
            self.events, self.questions, self.groups, self.users, self.games
        )
        self.question_service = QuestionService(self.events, self.questions, self.runs)
        self.answer_service = AnswerService(
            db,
            self.events,
            self.questions,
            self.runs,
            self.answers,
            self.scores,
            self.participants,
            self.users,
            self.games,
            now_fn=now_fn,
        )
        self.dispatcher = QuestionCloseDispatcher(
            self.question_service,
            self.event_service,
            self.message_service,
            self.questions,
            self.runs,
            self.scores,
            self.games,
        )
        if scheduler is None:
            scheduler = FakeScheduler(self.dispatcher)
        self.scheduler = scheduler
        self.dispatcher.set_scheduler(self.scheduler)

        self.recovery = RecoveryService(
            self.event_service,
            self.question_service,
            self.runs,
            self.scheduler,
            self.dispatcher,
            now_fn=now_fn,
        )

        checker = permission_checker or StaticPermissionChecker(result=False)
        self.permission_service = PermissionService(checker)

    def use_job_queue_scheduler(self, job_queue) -> None:
        """Swap in a real JobQueue scheduler for production runs."""
        from app.services.scheduler_service import JobQueueScheduler

        scheduler = JobQueueScheduler(job_queue, self.dispatcher)
        self.scheduler = scheduler
        self.dispatcher.set_scheduler(scheduler)
        self.recovery.set_scheduler(scheduler)

    def close(self) -> None:
        """Close the underlying database connection."""
        self.db.close()


def build_container(
    db: Database,
    permission_checker: Optional[PermissionChecker] = None,
    scheduler: Optional[BaseScheduler] = None,
    now_fn: Callable[[], str] = utc_now_iso,
) -> Container:
    """Build a fully-wired container."""
    return Container(db, permission_checker, scheduler, now_fn)
