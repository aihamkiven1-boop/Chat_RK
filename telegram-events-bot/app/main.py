"""Application entry point: wires everything and runs Long Polling.

Long Polling only starts here; tests never import this module in a way that
connects to Telegram.
"""

from __future__ import annotations

import logging

from telegram.ext import Application

from app.config import Settings
from app.container import Container, build_container
from app.database import open_database
from app.exceptions import ConfigurationError
from app.handlers.answer_handler import AnswerHandler
from app.handlers.callback_handler import CallbackHandler
from app.handlers.common_handler import CommonHandler
from app.handlers.error_handler import ErrorHandler
from app.handlers.event_handler import EventHandler
from app.handlers.member_handler import MemberHandler
from app.logging_config import configure_logging
from app.services.permission_service import TelegramPermissionChecker

logger = logging.getLogger(__name__)


def register_handlers(application: Application, container: Container) -> None:
    """Register all Telegram handlers with the application."""
    CommonHandler(container).register(application)
    EventHandler(container).register(application)
    MemberHandler(container).register(application)
    AnswerHandler(container).register(application)
    CallbackHandler(container).register(application)
    ErrorHandler().register(application)


def build_application(settings: Settings) -> Application:
    """Build the Application and run recovery inside post_init."""
    application = Application.builder().token(settings.bot_token).build()

    async def post_init(app: Application) -> None:
        db = open_database(settings.database_path)
        checker = TelegramPermissionChecker(app.bot)
        container = build_container(db, permission_checker=checker)
        app.bot_data["container"] = container
        container.use_job_queue_scheduler(app.job_queue)
        register_handlers(app, container)
        report = await container.recovery.recover()
        for entry in report:
            logger.info("Recovery event %s: %s — %s", entry.event_id, entry.action, entry.detail)

    application.post_init = post_init
    return application


def main() -> None:
    """Run the bot with Long Polling."""
    settings = Settings.load()
    try:
        settings.validate_for_run()
    except ConfigurationError:
        raise
    configure_logging(settings)
    application = build_application(settings)
    logger.info("Starting bot with Long Polling...")
    application.run_polling(allowed_updates=["message", "callback_query"])


if __name__ == "__main__":
    main()
