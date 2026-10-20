"""Handler for inline keyboard callback queries.

The handler always answers the callback query, even when the action is
unsupported, and only executes administrative actions after an admin check.
"""

from __future__ import annotations

import logging

from telegram import Update
from telegram.ext import CallbackQueryHandler

from app.container import Container
from app.utils.callback_data import InvalidCallbackDataError, parse_callback_data

logger = logging.getLogger(__name__)

ACTIONS_START = "start_event"
ACTIONS_CANCEL = "cancel_event"


class CallbackHandler:
    """Parses and dispatches safe callback data."""

    def __init__(self, container: Container) -> None:
        self._container = container

    def register(self, application) -> None:
        """Register the callback query handler."""
        application.add_handler(CallbackQueryHandler(self.on_callback_query))

    async def on_callback_query(self, update: Update, context) -> None:
        """Parse the callback data and execute the action if authorized."""
        query = update.callback_query
        chat = update.effective_chat
        user = update.effective_user
        if query is None or chat is None or user is None:
            return
        try:
            data = parse_callback_data(query.data)
        except InvalidCallbackDataError:
            await query.answer(text="رابط أو زر غير صالح.", show_alert=False)
            return

        if not await self._container.permission_service.is_admin(chat.id, user.id):
            await query.answer(text="هذا الإجراء للمشرفين فقط.", show_alert=False)
            return

        try:
            if data.action == ACTIONS_START:
                await self._handle_start(query, context, chat.id, data.entity_id)
            elif data.action == ACTIONS_CANCEL:
                await self._handle_cancel(query, context, chat.id, data.entity_id)
            else:
                await query.answer(text="إجراء غير معروف.", show_alert=False)
        except Exception:
            logger.exception("Callback action failed: %s", data.action)
            await query.answer(text="حدث خطأ أثناء تنفيذ الإجراء.", show_alert=False)

    async def _handle_start(self, query, context, chat_id: int, entity_id: int | None) -> None:
        event_id = entity_id
        if event_id is None:
            event = self._container.event_service.get_active_event(chat_id)
            event_id = event.id if event is not None else None
        if event_id is None:
            await query.answer(text="لا توجد فعالية لبدءها.", show_alert=False)
            return
        from app.constants import EventStatus

        event = self._container.event_service.get_event(event_id, chat_id)
        if event.status != EventStatus.REGISTRATION.value:
            await query.answer(text="لا يمكن بدء هذه الفعالية حاليًا.", show_alert=False)
            return
        started = self._container.event_service.start_event(event_id, chat_id, self._container.now_fn())
        await self._container.message_service.announce_event_started(context, started)
        await self._container.dispatcher.begin_event(context, started, self._container.now_fn())
        await query.answer(text="تم بدء الفعالية.", show_alert=False)

    async def _handle_cancel(self, query, context, chat_id: int, entity_id: int | None) -> None:
        event_id = entity_id
        if event_id is None:
            event = self._container.event_service.get_active_event(chat_id)
            event_id = event.id if event is not None else None
        if event_id is None:
            await query.answer(text="لا توجد فعالية لإلغائها.", show_alert=False)
            return
        self._container.event_service.cancel_event(event_id, chat_id, self._container.now_fn())
        await self._container.message_service.send_group_message(
            context, chat_id, "تم إلغاء الفعالية."
        )
        await query.answer(text="تم إلغاء الفعالية.", show_alert=False)
