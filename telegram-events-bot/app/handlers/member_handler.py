"""Handlers for member commands: /points, /rank, /leaderboard."""

from __future__ import annotations

from telegram.ext import CommandHandler

from app.constants import BotCommand
from app.container import Container
from app.services.message_service import MessageService


class MemberHandler:
    """Member-facing ranking commands."""

    def __init__(self, container: Container) -> None:
        self._container = container
        self._messages: MessageService = container.message_service

    def register(self, application) -> None:
        """Register member command handlers."""
        application.add_handler(
            CommandHandler(BotCommand.POINTS.value, self.on_points)
        )
        application.add_handler(
            CommandHandler(BotCommand.RANK.value, self.on_rank)
        )
        application.add_handler(
            CommandHandler(BotCommand.LEADERBOARD.value, self.on_leaderboard)
        )

    async def on_points(self, update, context) -> None:
        """Show the member's points in the current group."""
        chat_id = update.effective_chat.id
        user_id = update.effective_user.id
        points = self._container.leaderboards.member_points(chat_id, user_id)
        await self._messages.send_group_message(
            context, chat_id, f"إجمالي نقاطك في هذه المجموعة: {points}"
        )

    async def on_rank(self, update, context) -> None:
        """Show the member's rank in the current group."""
        chat_id = update.effective_chat.id
        user_id = update.effective_user.id
        rank = self._container.leaderboards.member_rank(chat_id, user_id)
        points = self._container.leaderboards.member_points(chat_id, user_id)
        await self._messages.send_group_message(
            context, chat_id, self._messages.render_ranking(rank, points)
        )

    async def on_leaderboard(self, update, context) -> None:
        """Show the all-time group leaderboard."""
        chat_id = update.effective_chat.id
        entries = self._container.leaderboards.group_leaderboard(chat_id)
        await self._messages.send_group_message(
            context,
            chat_id,
            self._messages.render_leaderboard(entries, "🏆 *متوسطو المجموعة*"),
        )
