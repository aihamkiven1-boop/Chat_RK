"""Answer submission service with transactional scoring."""

from __future__ import annotations

import logging
import sqlite3
from typing import Callable, Optional

from app.constants import EventStatus, QuestionRunStatus
from app.database import Database
from app.exceptions import AnswerRejectedError, DomainError, NotFoundError
from app.games.game_registry import GameRegistry
from app.models import AnswerResult
from app.repositories.answer_repository import AnswerRepository
from app.repositories.event_repository import EventRepository
from app.repositories.participant_repository import ParticipantRepository
from app.repositories.question_repository import QuestionRepository
from app.repositories.question_run_repository import QuestionRunRepository
from app.repositories.score_repository import ScoreRepository
from app.repositories.user_repository import UserRepository
from app.services.scoring_service import score_correct_answer, score_wrong_answer
from app.utils.time_utils import seconds_between, utc_now_iso
from app.utils.validators import validate_answer_text

logger = logging.getLogger(__name__)

DUPLICATE_REASON = "لقد أجبت على هذا السؤال مسبقًا."
NOT_RUNNING_REASON = "لا توجد فعالية قيد التشغيل الآن."
NO_ACTIVE_QUESTION_REASON = "لا يوجد سؤال نشط الآن."
EXPIRED_REASON = "انتهى وقت الإجابة على هذا السؤال."
EMPTY_ANSWER_REASON = "الإجابة لا يمكن أن تكون فارغة."
TOO_LONG_ANSWER_REASON = "الإجابة طويلة جدًا."


class AnswerService:
    """Validates and records answers within a single transaction."""

    def __init__(
        self,
        db: Database,
        event_repository: EventRepository,
        question_repository: QuestionRepository,
        run_repository: QuestionRunRepository,
        answer_repository: AnswerRepository,
        score_repository: ScoreRepository,
        participant_repository: ParticipantRepository,
        user_repository: UserRepository,
        games: GameRegistry,
        now_fn: Callable[[], str] = utc_now_iso,
    ) -> None:
        self._db = db
        self._events = event_repository
        self._questions = question_repository
        self._runs = run_repository
        self._answers = answer_repository
        self._scores = score_repository
        self._participants = participant_repository
        self._users = user_repository
        self._games = games
        self._now_fn = now_fn

    def submit_text_answer(
        self,
        chat_id: int,
        user_id: int,
        answer_text: str,
        user_name: str = "",
        now: Optional[str] = None,
    ) -> AnswerResult:
        """Validate and record an answer, returning a structured result.

        The answer insert, event score update, and group member update happen
        inside a single SQLite transaction. Duplicate answers are rejected by
        the UNIQUE constraint, not only by Python checks.
        """
        now = now or self._now_fn()
        try:
            answer_text = validate_answer_text(answer_text)
        except DomainError:
            return AnswerResult(
                accepted=False,
                correct=False,
                points=0,
                rejection_reason=EMPTY_ANSWER_REASON,
            )

        with self._db.transaction() as conn:
            try:
                return self._submit_in_transaction(conn, chat_id, user_id, answer_text, user_name, now)
            except AnswerRejectedError as exc:
                return AnswerResult(
                    accepted=False,
                    correct=False,
                    points=0,
                    rejection_reason=str(exc),
                )
            except NotFoundError as exc:
                return AnswerResult(
                    accepted=False,
                    correct=False,
                    points=0,
                    rejection_reason=str(exc),
                )
            except sqlite3.IntegrityError as exc:
                if "answers.question_run_id" in str(exc) or "answers.user_id" in str(exc):
                    logger.info(
                        "Duplicate answer rejected: chat=%s user=%s run=%s",
                        chat_id,
                        user_id,
                        self._active_run_id(chat_id),
                    )
                    return AnswerResult(
                        accepted=False,
                        correct=False,
                        points=0,
                        rejection_reason=DUPLICATE_REASON,
                    )
                raise

    def _active_run_id(self, chat_id: int) -> Optional[int]:
        event = self._events.get_active_for_chat(chat_id)
        if event is None:
            return None
        run = self._runs.get_active_for_event(event.id)
        return run.id if run is not None else None

    def _submit_in_transaction(
        self,
        conn: sqlite3.Connection,
        chat_id: int,
        user_id: int,
        answer_text: str,
        user_name: str,
        now: str,
    ) -> AnswerResult:
        event = self._events.get_active_for_chat(chat_id)
        if event is None or event.status != EventStatus.RUNNING.value:
            raise AnswerRejectedError(NOT_RUNNING_REASON)
        if not event.active_question_id:
            raise AnswerRejectedError(NO_ACTIVE_QUESTION_REASON)

        run = self._runs.get_active_for_event(event.id)
        if run is None or run.status != QuestionRunStatus.ACTIVE.value:
            raise AnswerRejectedError(NO_ACTIVE_QUESTION_REASON)
        if now >= run.ends_at:
            raise AnswerRejectedError(EXPIRED_REASON)

        question = self._questions.get(run.question_id)
        if question is None:
            raise NotFoundError("السؤال غير موجود.")

        game = self._games.get(event.game_type)
        normalized = game.normalize_answer(answer_text)
        is_correct = game.check_answer(answer_text, question)
        if is_correct:
            elapsed = seconds_between(run.started_at, now)
            points = score_correct_answer(elapsed, question.duration_seconds, question.base_points)
        else:
            points = score_wrong_answer()

        if self._users.get(user_id) is None:
            self._users.upsert(user_id, user_name or "عضو", None, None, now)
        self._participants.add(conn, event.id, chat_id, user_id, now)

        earlier_correct = self._answers.count_correct_for_run(run.id)
        is_first_correct = is_correct and earlier_correct == 0

        self._answers.create(
            conn,
            event_id=event.id,
            question_id=question.id,
            question_run_id=run.id,
            chat_id=chat_id,
            user_id=user_id,
            answer_text=answer_text,
            normalized_answer=normalized,
            is_correct=is_correct,
            points=points,
            answered_at=now,
        )
        self._scores.apply_answer_transaction(
            conn,
            event_id=event.id,
            chat_id=chat_id,
            user_id=user_id,
            points=points,
            is_correct=is_correct,
            is_first_correct=is_first_correct,
            updated_at=now,
        )
        return AnswerResult(accepted=True, correct=is_correct, points=points)
