"""A guard on a Python agent: before each tool call allow, ask or deny, from the workspace's rules.

Allow and deny are decided in process from a signed bundle. An ask waits on a person, and only an
answer the control plane signed for this very call is believed. Nothing here asks a model anything.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Mapping, Optional, Sequence

from .cloud import (
    WORK_TOOL_MY_WORK,
    WORK_TOOL_REPORT_PROGRESS,
    WORK_TOOL_REQUEST_HANDOFF,
    CloudPort,
    FetchCloud,
)
from .breaker import Breach, CircuitBreaker
from .matcher import ALLOW, ASK, DENY, BundleRefused, Engine, Verdict
from .signing import bundle_signed, verifies
from .steering import answer_has_instruction_shape, redact_secrets, steerable

ACTION_RECORDED = "agent.action.recorded"
SESSION_STARTED = "agent.session.started"
# Who may say a session is for an issue: the agent's own code, or the flow that started it.
WORK_REF_SOURCES = ("sdk", "automation")
WORK_REF_FORMS = ("key", "number", "url")
SESSION_PAUSED = "agent.session.paused"
# How often a paused session asks whether a person lifted the pause, as the TypeScript guard does.
RESUME_CHECK_SECONDS = 10
TAINTED_REASON = (
    "this agent recently read text written to give it instructions, so a person decides before it "
    "speaks or loses anything"
)
ENV_TOKEN = "MEMNOX_TOKEN"
ENV_WORKSPACE = "MEMNOX_WORKSPACE"
ENV_URL = "MEMNOX_URL"
ENV_AGENT = "MEMNOX_AGENT"
ENV_PROFILE = "MEMNOX_PROFILE"
DEFAULT_URL = "https://api.memnox.com"
DEFAULT_WAIT_SECONDS = 120
LONG_POLL_SECONDS = 25
ANSWERED = "answered"
EXPIRED = "expired"
ONCE = "once"
SESSION = "session"


@dataclass(frozen=True)
class Decision:
    verdict: str
    allowed: bool
    reason: str
    rule: Optional[str] = None
    alternative: Optional[str] = None
    answered_by: Optional[str] = None
    held_id: Optional[str] = None


class ToolRefused(Exception):
    """What a refused call raises, carrying the decision so a caller can say why."""

    def __init__(self, decision: Decision) -> None:
        super().__init__(refusal_text(decision))
        self.decision = decision


def refusal_text(decision: Decision) -> str:
    instead = "" if decision.alternative is None else f" Instead: {decision.alternative}"
    return f"Memnox refused this: {decision.reason}.{instead}"


def args_digest_of(arguments: Mapping[str, Any]) -> str:
    canonical = json.dumps(dict(arguments), sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


@dataclass
class Guard:
    cloud: CloudPort
    agent: str
    profile_id: Optional[str] = None
    machine_class: Optional[str] = None
    wait_seconds: int = DEFAULT_WAIT_SECONDS
    require_signed: bool = True
    now: Callable[[], float] = time.time
    _engine: Engine = field(default_factory=lambda: Engine([]))
    _etag: Optional[str] = None
    _bundle_hash: Optional[str] = None
    _keys: dict[str, str] = field(default_factory=dict)
    _grants: set[str] = field(default_factory=set)
    _breaker: CircuitBreaker = field(default_factory=CircuitBreaker)
    # A paused session, with when it was paused and when the plane was last asked about it.
    _paused: dict[str, tuple[Breach, float, float]] = field(default_factory=dict)
    # Sessions that read instruction-shaped text, and the tool it came through.
    _tainted: dict[str, str] = field(default_factory=dict)
    pending: list[dict[str, Any]] = field(default_factory=list)
    # The issues this agent's work is for, by key or link, matched exactly in the workspace.
    work_refs: list[dict[str, str]] = field(default_factory=list)
    _sessions_declared: set[str] = field(default_factory=set)

    def refresh(self) -> bool:
        """Fetch the rules again; True when new signed rules are now in force, False otherwise."""
        fetched = self.cloud.bundle(self._etag)
        if fetched is None:
            return False
        if self.require_signed and not bundle_signed(fetched.signature, fetched.body, self._keys_now()):
            return False
        try:
            engine = Engine.from_bundle(fetched.bundle, self.machine_class)
        except BundleRefused:
            # Rules nobody can read must never become no rules: the ones in memory keep deciding.
            return False
        self._engine = engine
        self._etag = fetched.etag
        self._bundle_hash = fetched.bundle.get("hash")
        return True

    def authorize(
        self, tool: str, arguments: Mapping[str, Any], session_id: str, profile_id: Optional[str] = None,
        work_refs: Optional[Sequence[Mapping[str, str]]] = None,
    ) -> Decision:
        self._declare_session(session_id, profile_id, work_refs)
        paused = self._still_paused(session_id)
        if paused is not None:
            verdict = Verdict(DENY, f"Memnox paused this session: {paused.reason}")
            decision = Decision(
                DENY, False,
                f"{verdict.reason}. Nothing further will run until a person looks at it.",
            )
            self._record(tool, arguments, session_id, verdict, decision, profile_id)
            return decision
        verdict = self._steered(self._engine.decide(tool, self.agent), tool, session_id)
        if verdict.effect == ASK:
            grant = f"{session_id}\u0000{tool}"
            decision = (
                Decision(ALLOW, True, "allowed for this session by an earlier answer", verdict.rule)
                if grant in self._grants
                else self._ask(tool, arguments, session_id, verdict)
            )
        else:
            allowed = verdict.effect == ALLOW
            decision = Decision(ALLOW if allowed else DENY, allowed, verdict.reason, verdict.rule, verdict.alternative)
        self._record(tool, arguments, session_id, verdict, decision, profile_id)
        return decision

    def outcome(
        self,
        tool: str,
        session_id: str,
        failed: bool,
        arguments: Optional[Mapping[str, Any]] = None,
        failure_kind: Optional[str] = None,
        output: Any = None,
        profile_id: Optional[str] = None,
    ) -> None:
        """How a call ended: read for steering text, counted by the breaker, and kept with the record."""
        if output is not None and answer_has_instruction_shape(output):
            self.taint(session_id, tool)
        self.pending.append(self._row(session_id, {"operation": tool, "failed": failed}, profile_id))
        digest = args_digest_of(arguments or {})
        fingerprint = hashlib.sha256(f"{tool}\u0000{digest}".encode("utf-8")).hexdigest()
        breach = self._breaker.observe(session_id, fingerprint, tool, failed, failure_kind)
        if breach is None:
            return
        at = self.now()
        self._paused[session_id] = (breach, at, at)
        row = self._row(session_id, {"reason": redact_secrets(breach.reason)}, profile_id)
        row.update({"kind": SESSION_PAUSED, "dedupKey": f"pause:{session_id}:{int(at * 1000)}",
                    "subjectId": session_id})
        self.pending.append(row)

    def taint(self, session_id: str, source: str) -> None:
        """From now on this session's sends and losses ask a person, even where a rule allows them."""
        self._tainted.setdefault(session_id, source)

    def tainted_by(self, session_id: str) -> Optional[str]:
        return self._tainted.get(session_id)

    def resume(self, session_id: str) -> None:
        """Lift a pause, as a person resuming the session does."""
        self._paused.pop(session_id, None)
        self._breaker.forget(session_id)

    def flush(self) -> None:
        rows, self.pending = self.pending, []
        try:
            self.cloud.record(rows)
        except Exception:  # noqa: BLE001 because a failed send is put back, so the record catches up when the plane does
            self.pending = rows + self.pending

    def my_work(self) -> list[dict[str, Any]]:
        answer = self.cloud.tool(WORK_TOOL_MY_WORK, {})
        listed = answer if isinstance(answer, list) else (answer or {}).get("work", [])
        return [each for each in listed if isinstance(each, dict) and isinstance(each.get("id"), str)]

    def report_progress(
        self, work_id: str, note: str, state: Optional[str] = None, refs: Sequence[Mapping[str, str]] = ()
    ) -> None:
        """A line for the person; an agent can claim done and never close its own work."""
        self.cloud.tool(
            WORK_TOOL_REPORT_PROGRESS,
            {"workId": work_id, "note": redact_secrets(note), **({} if state is None else {"state": state}), "refs": list(refs)},
        )

    def request_handoff(
        self,
        work_id: str,
        reason: str,
        to_profile: Optional[str] = None,
        to_person: Optional[str] = None,
        refs: Sequence[Mapping[str, str]] = (),
    ) -> None:
        """Asks the person to hand the work on; nothing moves until they accept."""
        self.cloud.tool(
            WORK_TOOL_REQUEST_HANDOFF,
            {
                "workId": work_id,
                "reason": redact_secrets(reason),
                **({} if to_profile is None else {"toProfileId": to_profile}),
                **({} if to_person is None else {"toPersonId": to_person}),
                "refs": list(refs),
            },
        )

    def _steered(self, verdict: Verdict, tool: str, session_id: str) -> Verdict:
        """An allow turned into an ask where a tainted session is about to speak or lose something."""
        if verdict.effect != ALLOW or session_id not in self._tainted or not steerable(tool):
            return verdict
        return Verdict(ASK, TAINTED_REASON, verdict.rule, verdict.alternative)

    def _still_paused(self, session_id: str) -> Optional[Breach]:
        """The pause, unless a person lifted it since; a plane that cannot be reached leaves it in place."""
        held = self._paused.get(session_id)
        if held is None:
            return None
        breach, at, checked = held
        now = self.now()
        if now - checked < RESUME_CHECK_SECONDS:
            return breach
        self._paused[session_id] = (breach, at, now)
        resumed_since = getattr(self.cloud, "resumed_since", None)
        if resumed_since is None:
            return breach
        try:
            if resumed_since(session_id, int(at * 1000)) is True:
                self.resume(session_id)
                return None
        except Exception:  # noqa: BLE001 because unreachable is not a resume, so a stuck loop stays stopped
            return breach
        return breach

    def _keys_now(self) -> dict[str, str]:
        if not self._keys:
            self._keys = self.cloud.keys()
        return self._keys

    def _ask(self, tool: str, arguments: Mapping[str, Any], session_id: str, verdict: Verdict) -> Decision:
        digest = args_digest_of(arguments)
        try:
            raised = self.cloud.raise_held({
                "operation": tool, "argsDigest": digest, "agent": self.agent, "sessionId": session_id,
                "reason": redact_secrets(verdict.reason), "waitMinutes": max(1, -(-self.wait_seconds // 60)),
                "operationId": hashlib.sha256(f"{session_id}\u0000{tool}\u0000{digest}".encode()).hexdigest(),
                **({} if verdict.rule is None else {"ruleId": verdict.rule}),
            })
            return self._wait(raised["id"], digest, session_id, tool, verdict)
        except Exception:  # noqa: BLE001 since it fails closed: an ask nobody can be reached for is refused
            return Decision(DENY, False, "a person could not be asked", verdict.rule, held_id=None)

    def _wait(self, held_id: str, digest: str, session_id: str, tool: str, verdict: Verdict) -> Decision:
        deadline = self.now() + self.wait_seconds
        while self.now() < deadline:
            left = int(min(LONG_POLL_SECONDS, max(1, deadline - self.now())))
            state = self.cloud.status(held_id, left)
            if state.get("status") == EXPIRED:
                break
            if state.get("status") == ANSWERED:
                return self._answered(state, held_id, digest, session_id, tool, verdict)
        return Decision(DENY, False, "nobody answered in time", verdict.rule, held_id=held_id)

    def _answered(
        self, state: Mapping[str, Any], held_id: str, digest: str, session_id: str, tool: str, verdict: Verdict
    ) -> Decision:
        answer = state.get("answer")
        if answer in (ONCE, SESSION) and not self._answer_signed(state.get("signed"), held_id, answer, digest):
            return Decision(DENY, False, "the yes was not signed for this call", verdict.rule, held_id=held_id)
        if answer == SESSION:
            self._grants.add(f"{session_id}\u0000{tool}")
        allowed = answer in (ONCE, SESSION)
        return Decision(
            ALLOW if allowed else DENY, allowed,
            f"{'allowed' if allowed else 'refused'} by {state.get('by', 'a person')}",
            verdict.rule, answered_by=state.get("by"), held_id=held_id,
        )

    def _answer_signed(self, signed: Any, held_id: str, answer: str, digest: str) -> bool:
        if not self.require_signed:
            return True
        if not isinstance(signed, dict):
            return False
        key = self._keys_now().get(signed.get("keyId", ""))
        payload = signed.get("payload")
        if key is None or not isinstance(payload, str):
            return False
        if not verifies(key, payload.encode("utf-8"), str(signed.get("signature", ""))):
            return False
        try:
            claims = json.loads(payload)
        except ValueError:
            return False
        return claims.get("callId") == held_id and claims.get("answer") == answer and claims.get("argsDigest") == digest

    def _record(
        self, tool: str, arguments: Mapping[str, Any], session_id: str,
        verdict: Verdict, decision: Decision, profile_id: Optional[str],
    ) -> None:
        payload = {
            "surface": "cloud", "operation": tool, "argsDigest": args_digest_of(arguments),
            "effect": verdict.effect, "finalEffect": decision.verdict, "reason": decision.reason,
            **({} if decision.rule is None else {"ruleId": decision.rule}),
            **({} if self._bundle_hash is None else {"bundleHash": self._bundle_hash}),
        }
        self.pending.append(self._row(session_id, payload, profile_id))

    def _declare_session(
        self, session_id: str, profile_id: Optional[str], work_refs: Optional[Sequence[Mapping[str, str]]],
    ) -> None:
        """Says once per session which issues it is for; a session that names none sends nothing."""
        if session_id in self._sessions_declared:
            return
        refs = work_refs_of(work_refs if work_refs is not None else self.work_refs)
        if not refs:
            return
        self._sessions_declared.add(session_id)
        row = self._row(session_id, {"agentKind": self.agent, "workRefs": refs}, profile_id)
        self.pending.append({**row, "kind": SESSION_STARTED, "dedupKey": f"session:{session_id}", "subjectId": session_id})

    def _row(self, session_id: str, payload: dict[str, Any], profile_id: Optional[str]) -> dict[str, Any]:
        profile = profile_id or self.profile_id
        identity = str(uuid.uuid4())
        return {
            "kind": ACTION_RECORDED, "dedupKey": identity, "subjectId": identity, "actorType": "agent",
            "occurredAt": int(self.now() * 1000), "agentSessionId": session_id,
            "payload": {"agentId": self.agent, **({} if profile is None else {"profileId": profile}), **payload},
        }


def create_guard(
    agent: Optional[str] = None,
    profile_id: Optional[str] = None,
    workspace: Optional[str] = None,
    token: Optional[str] = None,
    base_url: Optional[str] = None,
    cloud: Optional[CloudPort] = None,
) -> Guard:
    """A guard with its settings read from the environment where they are not passed."""
    named = agent or os.environ.get(ENV_AGENT)
    if not named:
        raise ValueError(f"Name the agent, as create_guard(agent=...) or {ENV_AGENT}.")
    if cloud is None:
        key = token or os.environ.get(ENV_TOKEN)
        space = workspace or os.environ.get(ENV_WORKSPACE)
        if not key or not space:
            raise ValueError(f"A guard needs {ENV_TOKEN} and {ENV_WORKSPACE}, or them passed.")
        cloud = FetchCloud(base_url or os.environ.get(ENV_URL) or DEFAULT_URL, space, key)
    guard = Guard(cloud=cloud, agent=named, profile_id=profile_id or os.environ.get(ENV_PROFILE))
    guard.refresh()
    return guard


def work_refs_of(refs: Sequence[Mapping[str, str]]) -> list[dict[str, str]]:
    """Each ref with a form and a source the workspace reads; anything else is dropped, not guessed."""
    kept: list[dict[str, str]] = []
    for ref in refs:
        value, form = ref.get("value"), ref.get("form")
        source = ref.get("source") or "sdk"
        if not isinstance(value, str) or form not in WORK_REF_FORMS or source not in WORK_REF_SOURCES:
            continue
        provider = ref.get("provider")
        kept.append({"value": value, "form": form, "source": source, **({"provider": provider} if provider else {})})
    return kept
