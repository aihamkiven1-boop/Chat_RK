"""Handlers for general commands: /start, /help, /rules, /status."""

from __future__ import annotations

from telegram.ext import CommandHandler

from app.constants import BotCommand
from app.container import Container
from app.models import EventRecord
from app.services.message_service import MessageService

WELCOME_TEXT = (
    "👋 أهلاً بك في بوت الفعاليات والمسابقات!\n"
    "يمكن للمشرفين إنشاء فعاليات أسئلة داخل المجموعات.\n"
    "اكتب /help لعرض الأوامر."
)


class CommonHandler:
    """Common bot commands."""

    def __init__(self, container: Container) -> None:
        self._container = container
        self._messages: MessageService = container.message_service

    def register(self, application) -> None:
        """Register command handlers with the application."""
        application.add_handler(
            CommandHandler(BotCommand.START.value, self.on_start)
        )
        application.add_handler(
            CommandHandler(BotCommand.HELP.value, self.on_help)
        )
        application.add_handler(
            CommandHandler(BotCommand.RULES.value, self.on_rules)
        )
        application.add_handler(
            CommandHandler(BotCommand.STATUS.value, self.on_status)
        )

    async def on_start(self, update, context) -> None:
        """Send a welcome message."""
        await self._messages.send_group_message(
            context, update.effective_chat.id, WELCOME_TEXT
        )

    async def on_help(self, update, context) -> None:
        """Send the list of commands."""
        text = (
            "*الأوامر المتاحة:*\n"
            "• /event [العنوان] — إنشاء فعالية (مشرف)\n"
            "• /add_demo_questions — إضافة أسئلة تجريبية (مشرف)\n"
            "• /start_event — بدء الفعالية (مشرف)\n"
            "• /cancel_event — إلغاء الفعالية (مشرف)\n"
            "• /status — حالة الفعالية الحالية\n"
            "• /points — نقاطك\n"
            "• /rank — مركزك في المجموعة\n"
            "• /leaderboard — المتصدرون\n"
            "• /rules — قواعد الفعاليات"
        )
        await self._messages.send_group_message(context, update.effective_chat.id, text)

    async def on_rules(self, update, context) -> None:
        """Send the rules."""
        await self._messages.send_group_message(
            context, update.effective_chat.id, self._messages.render_rules()
        )

    async def on_status(self, update, context) -> None:
        """Report the status of the active event in this group."""
        chat_id = update.effective_chat.id
        event = self._container.event_service.get_active_event(chat_id)
        status_text = event.status if isinstance(event, EventRecord) else "لا توجد فعالية نشطة"
        if event is None:
            await self._messages.send_group_message(
                context, chat_id, "لا توجد فعالية نشطة في هذه المجموعة."
            )
            return
        await self._messages.send_group_message(
            context, chat_id, self._messages.render_status(event, status_text)
        )
