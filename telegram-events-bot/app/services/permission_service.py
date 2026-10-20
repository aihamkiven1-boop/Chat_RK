"""Permission checking with an injectable admin-checker.

The decision logic lives behind the ``PermissionChecker`` protocol so tests can
inject a fake checker without any Telegram API dependency. The Telegram adapter
implements the protocol and is wired in the composition root (main.py).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, Protocol

from app.exceptions import PermissionDeniedError

if TYPE_CHECKING:
    from telegram import ChatMember

_ADMIN_STATUSES = {"administrator", "creator"}


class PermissionChecker(Protocol):
    """Protocol for deciding whether a user is an admin of a group."""

    async def is_admin(self, chat_id: int, user_id: int) -> bool: ...


class PermissionService:
    """Service that guards administrative actions."""

    def __init__(self, checker: PermissionChecker) -> None:
        self._checker = checker

    async def is_admin(self, chat_id: int, user_id: int) -> bool:
        """Return True when the user is an admin of the group."""
        return await self._checker.is_admin(chat_id, user_id)

    async def ensure_admin(self, chat_id: int, user_id: int) -> None:
        """Raise PermissionDeniedError when the user is not an admin."""
        if not await self._checker.is_admin(chat_id, user_id):
            raise PermissionDeniedError(
                "هذا الإجراء متاح للمشرفين فقط في هذه المجموعة."
            )


class TelegramAdminChecker(ABC):
    """Base class for the Telegram API adapter (see main.py for usage)."""

    @abstractmethod
    def is_admin(self, chat_id: int, user_id: int) -> bool:
        """Return True when the user is an admin of the group."""


class TelegramPermissionChecker:
    """Telegram API adapter implementing the PermissionChecker protocol.

    Uses ``bot.get_chat_member``; a non-admin member or an error yields False.
    """

    def __init__(self, bot) -> None:
        self._bot = bot

    async def is_admin(self, chat_id: int, user_id: int) -> bool:
        try:
            member: ChatMember = await self._bot.get_chat_member(
                chat_id=chat_id, user_id=user_id
            )
        except Exception:
            return False
        return member.status in _ADMIN_STATUSES


class StaticPermissionChecker:
    """Deterministic checker for tests; returns a fixed result."""

    def __init__(self, result: bool = True) -> None:
        self._result = result

    async def is_admin(self, chat_id: int, user_id: int) -> bool:
        return self._result
