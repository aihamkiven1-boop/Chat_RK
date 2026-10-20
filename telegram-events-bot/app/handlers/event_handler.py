"""Handlers for admin event commands."""

from __future__ import annotations

from telegram import InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import CommandHandler

from app.constants import BotCommand, EventStatus
from app.container import Container
from app.demo_data import build_demo_questions
from app.exceptions import DomainError
from app.utils.callback_data import CallbackData
from app.utils.validators import strip_command_args

DEFAULT_EVENT_TITLE = "فعالية سرعة الأسئلة"


class EventHandler:
    """Admin commands for event lifecycle."""

    def __init__(self, container: Container) -> None:
        self._container = container
        self._messages = container.message_service

    def register(self, application) -> None:
        """Register event command handlers."""
        application.add_handler(
            CommandHandler(BotCommand.EVENT.value, self.on_create_event)
        )
        application.add_handler(
            CommandHandler(
                BotCommand.ADD_DEMO_QUESTIONS.value, self.on_add_demo_questions
            )
        )
        application.add_handler(
            CommandHandler(BotCommand.START_EVENT.value, self.on_start_event)
        )
        application.add_handler(
            CommandHandler(BotCommand.CANCEL_EVENT.value, self.on_cancel_event)
        )

    # -- helpers ------------------------------------------------------------
    def _chat_title(self, update) -> str:
        chat = update.effective_chat
        return getattr(chat, "title", None) or chat.type

    def _user_name(self, update) -> str:
        user = update.effective_user
        if user is None:
            return ""
        return user.full_name or user.username or ""

    async def _admin_check(self, update) -> bool:
        """Raise nothing; return True if the user is an admin."""
        user = update.effective_user
        if user is None:
            return False
        return await self._container.permission_service.is_admin(
            update.effective_chat.id, user.id
        )

    async def _require_admin(self, update, context) -> bool:
        """Check admin permission and reply on failure."""
        if await self._admin_check(update):
            return True
        await self._messages.send_group_message(
            context,
            update.effective_chat.id,
            "هذا الأمر متاح للمشرفين فقط في هذه المجموعة.",
        )
        return False

    # -- commands -----------------------------------------------------------
    async def on_create_event(self, update, context) -> None:
        """Create a new event in REGISTRATION status (admin only)."""
        if not await self._require_admin(update, context):
            return
        chat_id = update.effective_chat.id
        user_id = update.effective_user.id
        args = strip_command_args(update.effective_message.text)
        title = args or DEFAULT_EVENT_TITLE
        try:
            event = self._container.event_service.create_event(
                chat_id=chat_id,
                created_by=user_id,
                title=title,
                group_title=self._chat_title(update),
                now=self._container.now_fn(),
                created_by_name=self._user_name(update),
            )
        except DomainError as exc:
            await self._messages.send_group_message(context, chat_id, str(exc))
            return
        keyboard = InlineKeyboardMarkup(
            [
                [
                    InlineKeyboardButton(
                        "▶️ بدء الفعالية",
                        callback_data=CallbackData.build("start_event", event.id),
                    ),
                    InlineKeyboardButton(
                        "❌ إلغاء",
                        callback_data=CallbackData.build("cancel_event", event.id),
                    ),
                ]
            ]
        )
        await self._messages.send_group_message(
            context,
            chat_id,
            f"تم إنشاء الفعالية: *{event.title}*\n"
            "استخدم /add_demo_questions لإضافة أسئلة تجريبية، ثم اضغط بدء أو /start_event.",
        )
        if context is not None:
            try:
                await context.bot.send_message(
                    chat_id=chat_id,
                    text="تحكم بالفعالية من هنا:",
                    reply_markup=keyboard,
                )
            except Exception:
                pass

    async def on_add_demo_questions(self, update, context) -> None:
        """Add demo questions to the active REGISTRATION event (admin only)."""
        if not await self._require_admin(update, context):
            return
        chat_id = update.effective_chat.id
        event = self._container.event_service.get_active_event(chat_id)
        if event is None or event.status != EventStatus.REGISTRATION.value:
            await self._messages.send_group_message(
                context,
                chat_id,
                "لا توجد فعالية في مرحلة التسجيل لإضافة أسئلة إليها.",
            )
            return
        try:
            self._container.event_service.add_questions(
                event.id, chat_id, build_demo_questions(), self._container.now_fn()
            )
        except DomainError as exc:
            await self._messages.send_group_message(context, chat_id, str(exc))
            return
        await self._messages.send_group_message(
            context,
            chat_id,
            "تمت إضافة 5 أسئلة تجريبية. استخدم /start_event لبدء الفعالية.",
        )

    async def on_start_event(self, update, context) -> None:
        """Start the active REGISTRATION event and begin the first question."""
        if not await self._require_admin(update, context):
            return
        chat_id = update.effective_chat.id
        event = self._container.event_service.get_active_event(chat_id)
        if event is None or event.status != EventStatus.REGISTRATION.value:
            await self._messages.send_group_message(
                context,
                chat_id,
                "لا توجد فعالية جاهزة للبدء في هذه المجموعة.",
            )
            return
        try:
            started = self._container.event_service.start_event(
                event.id, chat_id, self._container.now_fn()
            )
            await self._messages.announce_event_started(context, started)
            await self._container.dispatcher.begin_event(
                context, started, self._container.now_fn()
            )
        except DomainError as exc:
            await self._messages.send_group_message(context, chat_id, str(exc))

    async def on_cancel_event(self, update, context) -> None:
        """Cancel the active REGISTRATION event (admin only)."""
        if not await self._require_admin(update, context):
            return
        chat_id = update.effective_chat.id
        event = self._container.event_service.get_active_event(chat_id)
        if event is None or event.status != EventStatus.REGISTRATION.value:
            await self._messages.send_group_message(
                context,
                chat_id,
                "لا توجد فعالية في مرحلة التسجيل يمكن إلغاؤها.",
            )
            return
        try:
            self._container.event_service.cancel_event(
                event.id, chat_id, self._container.now_fn()
            )
        except DomainError as exc:
            await self._messages.send_group_message(context, chat_id, str(exc))
            return
        await self._messages.send_group_message(
            context, chat_id, "تم إلغاء الفعالية."
        )
