"""Stopping an agent that is not getting anywhere, from outcomes rather than requests.

Ported from `@memnox/core`'s circuit breaker, the two signals a guard can count on its own: the
same call failing the same way, and failure after failure with nothing succeeding in between.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

ERROR_LOOP = "error-loop"
NO_PROGRESS = "no-progress"
# The TypeScript breaker's defaults, so one loop pauses the same in either language.
ERROR_LOOP_AT = 5
NO_PROGRESS_AT = 8


@dataclass(frozen=True)
class Breach:
    signal: str
    reached: int
    ceiling: int
    reason: str


@dataclass
class _Session:
    consecutive_failures: int = 0
    failures: dict[str, int] = field(default_factory=dict)


@dataclass
class CircuitBreaker:
    error_loop: int = ERROR_LOOP_AT
    no_progress: int = NO_PROGRESS_AT
    _sessions: dict[str, _Session] = field(default_factory=dict)

    def observe(
        self, session_id: str, fingerprint: str, action: str, failed: bool, failure_kind: Optional[str] = None
    ) -> Optional[Breach]:
        """None while nothing tripped; the error loop is read first, as the more certain signal."""
        state = self._sessions.setdefault(session_id, _Session())
        if not failed:
            # Anything that worked is progress, and the same call working means its failures were passing.
            state.consecutive_failures = 0
            state.failures = {k: v for k, v in state.failures.items() if not k.startswith(f"{fingerprint}:")}
            return None
        state.consecutive_failures += 1
        key = f"{fingerprint}:{failure_kind or ''}"
        same = state.failures.get(key, 0) + 1
        state.failures[key] = same
        if same >= self.error_loop:
            exiting = "" if failure_kind is None else f", exiting {failure_kind}"
            return Breach(
                ERROR_LOOP, same, self.error_loop,
                f"{action} has failed the same way {same} times{exiting}; retrying it again will fail the same way",
            )
        if state.consecutive_failures >= self.no_progress:
            return Breach(
                NO_PROGRESS, state.consecutive_failures, self.no_progress,
                f"{state.consecutive_failures} actions in a row have failed and nothing has succeeded in between",
            )
        return None

    def forget(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)
