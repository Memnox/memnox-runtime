"""The workspace's published rules decided in process, ported from the TypeScript engine.

Deterministic: a rule table and a matcher, no model and no network. A rule carrying a condition
this port does not read refuses rather than allows: a deny or ask holds, an allow is left out.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Mapping, Optional, Sequence

WILDCARD = "*"
EXCLUDE = "!"
SEGMENT = "."
WORKSPACE_TOKEN = "{workspace}"
NO_WORKSPACE = "\u0000no-workspace"
MACHINE_CLASSES = "machineClasses"
OBSERVE = "observe"

ALLOW = "allow"
ASK = "ask"
DENY = "deny"
STRICTNESS = {ALLOW: 0, ASK: 1, DENY: 2}

# Characters that are invisible or reorder what a rule author sees: a trailing one was a bypass.
INVISIBLE = re.compile(
    "[\u0000-\u001f\u007f-\u009f​-‏  ‪-‮⁠-⁤﻿]"
)

# Every condition the TypeScript engine honours; a rule naming another is skipped there too.
HONOURED = {
    "environments", "roles", "principals", "models", "providers", "dataClassifications",
    "jurisdictions", "branches", "arguments", "content", "aboveAmount", "windows", "scope",
    "state", "unless",
}
# Conditions read from fields a Python guard reports, each against what the call says.
READ_HERE = {"environments", "roles", "principals", "models", "providers", "jurisdictions",
             "branches", "dataClassifications", "unless"}

MCP_PREFIX = "mcp__"
MCP_SEPARATOR = "__"
FUNCTION_TOOL_PREFIX = "tool."


class BundleRefused(ValueError):
    """A bundle no rule can be read from, which must never become no rules."""


def normalize(value: str) -> str:
    return INVISIBLE.sub("", value).strip()


_compiled: dict[str, re.Pattern[str]] = {}


def matches_pattern(pattern: str, value: str) -> bool:
    compiled = _compiled.get(pattern)
    if compiled is None:
        escaped = ".*".join(re.escape(part) for part in pattern.lower().split(WILDCARD))
        compiled = re.compile(f"^{escaped}$", re.DOTALL)
        _compiled[pattern] = compiled
    return compiled.match(value.lower()) is not None


def matches_any(patterns: Optional[Sequence[str]], value: Optional[str]) -> bool:
    """Any pattern matches and no `!` pattern does; no list matches everything."""
    if not patterns:
        return True
    excluded = [each for each in patterns if each.startswith(EXCLUDE)]
    included = [each for each in patterns if not each.startswith(EXCLUDE)]
    if value is None:
        return len(included) == 0 or WILDCARD in included
    if any(matches_pattern(each[len(EXCLUDE):], value) for each in excluded):
        return False
    return len(included) == 0 or any(matches_pattern(each, value) for each in included)


def with_workspace(patterns: Optional[Sequence[str]], cwd: Optional[str]) -> Optional[list[str]]:
    if patterns is None or not any(WORKSPACE_TOKEN in each for each in patterns):
        return None if patterns is None else list(patterns)
    root = NO_WORKSPACE if cwd is None else cwd.rstrip("/")
    return [each.replace(WORKSPACE_TOKEN, root) for each in patterns]


@dataclass(frozen=True)
class Request:
    action: str
    target: Optional[str] = None
    principal: Optional[str] = None
    working_directory: Optional[str] = None


@dataclass(frozen=True)
class Rule:
    id: str
    effect: str
    actions: list[str]
    reason: Optional[str]
    alternative: Optional[str]
    targets: Optional[list[str]]
    agents: Optional[list[str]]
    working_directories: Optional[list[str]]
    unless: list[Mapping[str, Any]]
    conditions: Mapping[str, Any]
    observed: bool
    project: Optional[str]


@dataclass(frozen=True)
class Verdict:
    effect: str
    reason: str
    rule: Optional[str] = None
    alternative: Optional[str] = None


def rules_from_bundle(bundle: Mapping[str, Any], machine_class: Optional[str] = None) -> list[Rule]:
    raw = bundle.get("rules")
    if not isinstance(raw, list):
        raise BundleRefused("the bundle carries no list of rules")
    rules = [rule_of(each) for each in raw]
    return [
        rule for rule, source in zip(rules, raw)
        if set(rule.conditions).issubset(HONOURED) and holds_on(source, machine_class)
    ]


def rule_of(raw: Any) -> Rule:
    if not isinstance(raw, dict) or not isinstance(raw.get("id"), str):
        raise BundleRefused("a rule with no id")
    decision = raw.get("decision") if isinstance(raw.get("decision"), dict) else {}
    effect = decision.get("effect") if isinstance(decision.get("effect"), str) else raw.get("effect")
    if effect not in STRICTNESS:
        raise BundleRefused(f"rule {raw['id']} has no effect this guard knows")
    actions = raw.get("actions") or [raw.get("scopedMatch") or raw.get("match")]
    if not all(isinstance(each, str) and each != "" for each in actions):
        raise BundleRefused(f"rule {raw['id']} matches no action")
    conditions = {k: v for k, v in (raw.get("conditions") or {}).items() if k != MACHINE_CLASSES}
    unless = [*(conditions.get("unless") or []), *(raw.get("unless") or [])]
    alternative = decision.get("alternative") if isinstance(decision.get("alternative"), str) else raw.get("alternative")
    return Rule(
        id=raw["id"], effect=effect, actions=list(actions), reason=raw.get("reason"),
        alternative=alternative or None, targets=raw.get("targets"), agents=raw.get("agents"),
        working_directories=raw.get("workingDirectories"), unless=unless,
        conditions={k: v for k, v in conditions.items() if k != "unless"},
        observed=decision.get("mode") == OBSERVE, project=raw.get("project"),
    )


def holds_on(raw: Mapping[str, Any], machine_class: Optional[str]) -> bool:
    listed = (raw.get("conditions") or {}).get(MACHINE_CLASSES)
    classes = [*(raw.get("machineClasses") or []), *(listed if isinstance(listed, list) else [])]
    return len(classes) == 0 or (machine_class is not None and machine_class in classes)


def mcp_tool_parts(tool: str) -> Optional[tuple[str, str]]:
    if not tool.startswith(MCP_PREFIX) or "\n" in tool:
        return None
    split = tool.find(MCP_SEPARATOR, len(MCP_PREFIX) + 1)
    if split == -1 or split + len(MCP_SEPARATOR) >= len(tool):
        return None
    return tool[len(MCP_PREFIX):split], tool[split + len(MCP_SEPARATOR):]


def requests_for(tool: str, agent: str) -> list[Request]:
    """Both spellings of an MCP call, or one function tool under `tool.`, as the runtime names them."""
    parts = mcp_tool_parts(tool)
    if parts is None:
        return [Request(action=f"{FUNCTION_TOOL_PREFIX}{tool}", principal=agent)]
    server, name = parts
    return [
        Request(action=f"mcp.{server}.{name}", target=server, principal=agent),
        Request(action=f"mcp.{name}", target=server, principal=agent),
    ]


@dataclass
class Engine:
    rules: list[Rule]
    _by_prefix: dict[str, list[Rule]] = field(default_factory=dict)
    _unindexed: list[Rule] = field(default_factory=list)

    def __post_init__(self) -> None:
        for rule in self.rules:
            prefixes = literal_prefixes(rule.actions)
            if prefixes is None:
                self._unindexed.append(rule)
                continue
            for prefix in prefixes:
                self._by_prefix.setdefault(prefix, []).append(rule)

    @classmethod
    def from_bundle(cls, bundle: Mapping[str, Any], machine_class: Optional[str] = None) -> "Engine":
        return cls(rules_from_bundle(bundle, machine_class))

    def evaluate(self, request: Request, agent: str) -> Verdict:
        action = normalize(request.action)
        target = None if request.target is None else normalize(request.target)
        bucket = self._by_prefix.get(first_segment(action).lower(), [])
        matched = [
            rule for rule in [*bucket, *self._unindexed]
            if self._matches(rule, Request(action, target, request.principal, request.working_directory), agent)
        ]
        winner: Optional[Rule] = None
        for rule in matched:
            if rule.observed:
                continue
            if winner is None or STRICTNESS[rule.effect] > STRICTNESS[winner.effect]:
                winner = rule
        if winner is None:
            return Verdict(effect=ALLOW, reason="no rule matched")
        return Verdict(
            effect=winner.effect,
            reason=winner.reason or "the workspace publishes this rule",
            rule=winner.id,
            alternative=winner.alternative,
        )

    def decide(self, tool: str, agent: str) -> Verdict:
        """The strictest verdict over every action the call is, the first of equals winning."""
        worst: Optional[Verdict] = None
        for request in requests_for(tool, agent):
            verdict = self.evaluate(request, agent)
            if worst is None or STRICTNESS[verdict.effect] > STRICTNESS[worst.effect]:
                worst = verdict
        return worst if worst is not None else Verdict(effect=ALLOW, reason="nothing to rule on")

    def _matches(self, rule: Rule, request: Request, agent: str) -> bool:
        if rule.project is not None:
            return False
        if not (
            matches_any(rule.actions, request.action)
            and matches_any(with_workspace(rule.targets, request.working_directory), request.target)
            and matches_any(rule.agents, agent)
            and matches_any(rule.working_directories, request.working_directory)
            and self._conditions_hold(rule, request)
        ):
            return False
        return not carved_out(rule.unless, request, agent)

    def _conditions_hold(self, rule: Rule, request: Request) -> bool:
        unread = [key for key in rule.conditions if key not in READ_HERE]
        if unread:
            # Fail closed: a refusal this port cannot read still refuses, an allow it cannot read does not allow.
            return rule.effect != ALLOW
        values = {"principals": request.principal}
        for key, patterns in rule.conditions.items():
            listed = patterns if isinstance(patterns, list) else None
            if not matches_any(listed, values.get(key)):
                return False
        return True


def carved_out(unless: Sequence[Mapping[str, Any]], request: Request, agent: str) -> bool:
    for carve in unless:
        named = any(key in carve for key in ("project", "agents", "workingDirectories"))
        if not named or "expiresAt" in carve or "project" in carve:
            # An end this port does not read, or a project it is never told, keeps the rule in force.
            continue
        if "workingDirectories" in carve and request.working_directory is None:
            continue
        if matches_any(carve.get("agents"), agent) and matches_any(
            carve.get("workingDirectories"), request.working_directory
        ):
            return True
    return False


def first_segment(value: str) -> str:
    index = value.find(SEGMENT)
    return value if index == -1 else value[:index]


def literal_prefixes(patterns: Sequence[str]) -> Optional[set[str]]:
    prefixes: set[str] = set()
    for pattern in patterns:
        prefix = first_segment(pattern)
        if WILDCARD in prefix or prefix == "":
            return None
        prefixes.add(prefix.lower())
    return prefixes or None
