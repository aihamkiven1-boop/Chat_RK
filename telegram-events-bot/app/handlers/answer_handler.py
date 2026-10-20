"""Handler for plain-text answers in groups."""

from __future__ import annotations

import logging

from telegram.ext import MessageHandler, filters

from app.container import Container
from app.utils.time_utils import utc_now_iso

logger = logging.getLogger(__name__)


class AnswerHandler:
    """Accepts text answers sent in groups while an event is running.

    Commands are never treated as answers.
    """

    def __init__(self, container: Container) -> None:
        self._container = container

    def register(self, application) -> None:
        """Register the text-answer handler."""
        application.add_handler(
            MessageHandler(
                filters.TEXT & ~filters.COMMAND & filters.ChatType.GROUPS,
                self.on_answer,
            )
        )

    async def on_answer(self, update, context) -> None:
        """Submit the incoming text as an answer, if any event is running."""
        chat = update.effective_chat
        user = update.effective_user
        if chat is None or user is None:
            return
        text = (update.effective_message.text or "").strip()
        if not text:
            return
        user_name = user.full_name or user.username or ""
        result = self._container.answer_service.submit_text_answer(
            chat_id=chat.id,
            user_id=user.id,
            answer_text=text,
            user_name=user_name,
            now=utc_now_iso(),
        )
        if result.accepted:
            logger.debug(
                "Answer recorded: chat=%s user=%s correct=%s points=%s",
                chat.id,
                user.id,
                result.correct,
                result.points,
            )
