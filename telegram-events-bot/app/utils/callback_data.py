"""Versioned and strict parser for inline keyboard callback data.

Format: ``v1:action:entity_id:extra``

Never place tokens, personal data, or question text inside callback data.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.exceptions import DomainError

CALLBACK_VERSION = "v1"
MAX_CALLBACK_DATA_LENGTH = 64


class InvalidCallbackDataError(DomainError):
    """Raised when callback data cannot be parsed."""


@dataclass(frozen=True)
class CallbackData:
    """Parsed callback data."""

    action: str
    entity_id: int | None = None
    extra: str = ""

    def to_data(self) -> str:
        """Serialize back to the wire format."""
        return self.__class__.build(self.action, self.entity_id, self.extra)

    @staticmethod
    def build(action: str, entity_id: int | None = None, extra: str = "") -> str:
        """Build a callback data string in the versioned format."""
        parts = [CALLBACK_VERSION, action]
        parts.append(str(entity_id) if entity_id is not None else "")
        parts.append(extra or "")
        data = ":".join(parts)
        if len(data) > MAX_CALLBACK_DATA_LENGTH:
            raise InvalidCallbackDataError("Callback data exceeds maximum length.")
        return data


def parse_callback_data(data: str) -> CallbackData:
    """Strictly parse a callback data string."""
    if not isinstance(data, str) or not data:
        raise InvalidCallbackDataError("Callback data is empty.")
    parts = data.split(":")
    if len(parts) != 4:
        raise InvalidCallbackDataError("Callback data has an invalid structure.")
    version, action, entity_id_raw, extra = parts
    if version != CALLBACK_VERSION:
        raise InvalidCallbackDataError(f"Unsupported callback version: {version}")
    if not action:
        raise InvalidCallbackDataError("Callback action is empty.")
    entity_id: int | None = None
    if entity_id_raw:
        if not entity_id_raw.isdigit():
            raise InvalidCallbackDataError("Callback entity id is not numeric.")
        entity_id = int(entity_id_raw)
    return CallbackData(action=action, entity_id=entity_id, extra=extra)
