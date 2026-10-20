"""Message formatting and Telegram output for events.

This is the only place that renders event-related user-facing text. It never
touches the database and never reads question answers; callers pass the
rendered data (question text, correct answer) explicitly.
"""

from __future__ import annotations

import logging
from typing import Optional

from app.models import AnswerResult, EventRecord, LeaderboardEntry
from app.services.leaderboard_service import LeaderboardService
from app.utils.text_utils import escape_html

logger = logging.getLogger(__name__)


class MessageService:
    """Renders and sends all event-related messages."""

    def __init__(self, leaderboard_service: LeaderboardService) -> None:
        self._leaderboards = leaderboard_service

    # -- formatting ---------------------------------------------------------
    @staticmethod
    def render_rules() -> str:
        return (
            "📋 *قواعد الفعاليات:*\n"
            "• المشرفون فقط يمكنهم إنشاء الفعاليات والتحكم بها.\n"
            "• عند بدء السؤال أرسل إجابتك كنص مباشر.\n"
            "• إجابة واحدة فقط لكل سؤال لكل عضو.\n"
            "• الإجابة الصحيحة السريعة تمنح نقاطًا أكثر.\n"
            "• لا تُقبل الإجابات بعد انتهاء الوقت."
        )

    @staticmethod
    def render_event_started(event: EventRecord) -> str:
        return (
            f"🎉 بدأت الفعالية: *{escape_html(event.title)}*\n"
            f"عدد الأسئلة: {event.total_questions}\n"
            "أرسل إجاباتك فور ظهور كل سؤال. بالتوفيق!"
        )

    @staticmethod
    def render_question(
        question_text: str, question_number: int, total_questions: int
    ) -> str:
        return (
            f"❓ السؤال {question_number} من {total_questions}:\n"
            f"*{escape_html(question_text)}*\n\n"
            f"⏱ لديك حتى نهاية المؤقت للإجابة."
        )

    @staticmethod
    def render_question_result(question_number: int, correct_answer: str) -> str:
        return (
            f"⏱ انتهى وقت السؤال {question_number}.\n"
            f"الإجابة الصحيحة: *{escape_html(correct_answer)}*"
        )

    @staticmethod
    def render_leaderboard(entries: list[LeaderboardEntry], title: str) -> str:
        if not entries:
            return f"{title}\nلا توجد نتائج بعد."
        lines = [title]
        medals = ["🥇", "🥈", "🥉"]
        for entry in entries:
            medal = medals[entry.rank - 1] if entry.rank <= len(medals) else f"{entry.rank}."
            name = escape_html(entry.first_name) or (entry.username or "عضو")
            lines.append(f"{medal} {name} — {entry.points} نقطة")
        return "\n".join(lines)

    @staticmethod
    def render_ranking(rank: Optional[int], points: int) -> str:
        if rank is None:
            return "لا يوجد ترتيب لك بعد في هذه المجموعة."
        return f"مركزك في المجموعة: {rank} — إجمالي النقاط: {points}"

    @staticmethod
    def render_answer_feedback(result: AnswerResult) -> Optional[str]:
        """Return short feedback for a submitted answer, if any."""
        if not result.accepted:
            return None
        if result.correct:
            return f"✅ إجابة صحيحة! +{result.points} نقطة"
        return "❌ إجابة خاطئة."

    @staticmethod
    def render_status(event: Optional[EventRecord], status_text: str) -> str:
        if event is None:
            return f"حالة الفعالية: {status_text}"
        return f"حالة الفعالية: *{escape_html(event.title)}* — {status_text}"

    # -- sending ------------------------------------------------------------
    async def send_group_message(self, context, chat_id: int, text: str) -> Optional[object]:
        """Send a plain text message to a group; returns None on failure.

        When ``context`` is None (e.g. in tests or dry runs), the message is
        only rendered and no Telegram call is made.
        """
        if context is None:
            return None
        try:
            return await context.bot.send_message(chat_id=chat_id, text=text)
        except Exception:
            logger.exception("Failed to send message to chat %s", chat_id)
            return None

    async def announce_event_started(self, context, event: EventRecord) -> None:
        await self.send_group_message(context, event.chat_id, self.render_event_started(event))

    async def send_question(
        self,
        context,
        chat_id: int,
        question_text: str,
        question_number: int,
        total_questions: int,
    ) -> Optional[object]:
        """Send a question to the group."""
        return await self.send_group_message(
            context,
            chat_id,
            self.render_question(question_text, question_number, total_questions),
        )

    async def announce_question_result(
        self, context, chat_id: int, question_number: int, correct_answer: str
    ) -> None:
        """Announce the correct answer after a question closes."""
        await self.send_group_message(
            context, chat_id, self.render_question_result(question_number, correct_answer)
        )

    async def announce_event_end(self, context, event: EventRecord) -> None:
        """Announce the final results of a finished event."""
        entries = self._leaderboards.event_leaderboard(event.id, event.chat_id)
        board = self.render_leaderboard(entries, f"🏁 انتهت الفعالية: {escape_html(event.title)}")
        await self.send_group_message(context, event.chat_id, board)
