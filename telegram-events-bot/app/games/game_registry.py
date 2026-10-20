"""Registry mapping game type identifiers to their strategies."""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.constants import GameType
from app.exceptions import NotFoundError

if TYPE_CHECKING:
    from app.games.base_game import BaseGame
    from app.games.speed_quiz import SpeedQuiz


class GameRegistry:
    """Registry of available game strategies."""

    def __init__(self) -> None:
        self._games: dict[GameType, BaseGame] = {}

    def register(self, game: BaseGame) -> None:
        """Register a game strategy under its type."""
        self._games[game.game_type] = game

    def get(self, game_type: GameType | str) -> BaseGame:
        """Return the strategy for a game type or raise NotFoundError."""
        key = GameType(game_type)
        game = self._games.get(key)
        if game is None:
            raise NotFoundError(f"نوع اللعبة غير مدعوم: {key.value}")
        return game

    def is_supported(self, game_type: GameType | str) -> bool:
        """Return True when the game type is registered."""
        try:
            GameType(game_type)
        except ValueError:
            return False
        return game_type in self._games

    def registered_types(self) -> list[str]:
        """List of registered game type values."""
        return [game_type.value for game_type in self._games]


def build_default_registry() -> GameRegistry:
    """Build a registry with the currently supported games (SpeedQuiz only)."""
    from app.games.speed_quiz import SpeedQuiz

    registry = GameRegistry()
    registry.register(SpeedQuiz())
    return registry
