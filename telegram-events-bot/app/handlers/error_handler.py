"""Global error handler: logs without exposing secrets or stack traces to users."""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


class ErrorHandler:
    """Catches unhandled handler errors."""

    def register(self, application) -> None:
        """Register the error handler."""
        application.add_error_handler(self.on_error)

    async def on_error(self, update, context) -> None:
        """Log the error; never reply with tokens or internal traces."""
        logger.exception(
            "Unhandled error while processing update: %s", context.error
        )
