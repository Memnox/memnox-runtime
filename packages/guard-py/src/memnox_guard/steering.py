"""What a tool answered that tries to steer the agent, and the secrets a line for a person must not carry.

Ported from `@memnox/core`: the instruction shapes the gateway and the TypeScript guard read, and the
credential masking every record goes through. Cheap and certain only; neither decides anything alone.
"""

from __future__ import annotations

import re
from typing import Any

# Phrases that address the model rather than answer the call, as `instruction-shapes.ts` has them.
INSTRUCTION_SHAPES = [
    re.compile(r"\bignore (all |any )?(previous|prior|earlier|above) instructions?\b", re.I),
    re.compile(r"\bdisregard (all |any )?(previous|prior|earlier|the) (instructions?|rules?|system prompt)\b", re.I),
    re.compile(r"\byou are now\b", re.I),
    re.compile(r"\bnew (system )?(instructions?|prompt)\s*:", re.I),
    re.compile(r"<\s*(system|important_instructions)\s*>", re.I),
    re.compile(r"\bdo not tell the user\b", re.I),
    re.compile(r"\b(reveal|print|output) (your|the) (system prompt|instructions)\b", re.I),
]
# Enough to find an instruction, and bounded, since a tool's answer can be a whole file.
MOST_CHARS_READ = 200_000
MOST_DEPTH = 4

# Verbs that open a tool's name when the call speaks to somebody or hands something over.
SENDING_VERBS = {
    "send", "post", "publish", "email", "mail", "forward", "upload", "share", "notify", "reply",
    "message", "transfer", "invite",
}
# Verbs that lose something, which the TypeScript guard reads off its tool classes; named here instead.
LOSING_VERBS = {"delete", "remove", "drop", "destroy", "purge", "wipe", "refund", "force", "cancel"}
MCP_SEPARATOR = "__"
WORD_BREAK = re.compile(r"[._\s-]|(?=[A-Z])")

REDACTED = "[redacted]"
SECRET_NAME = (
    r"[A-Za-z0-9_.-]*(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key"
    r"|credentials?|auth[_-]?token|authorization|session[_-]?key)[A-Za-z0-9_.-]*"
)
SECRET_SHAPES = [
    re.compile(r"\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b"),
    re.compile(r"\bsk-ant-[A-Za-z0-9_-]{16,}\b"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b"),
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}\b"),
    re.compile(r"\bglpat-[A-Za-z0-9_-]{16,}\b"),
    re.compile(r"\bnpm_[A-Za-z0-9]{20,}\b"),
    re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}\b"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bAIza[0-9A-Za-z_-]{30,}\b"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"),
]
URL_PASSWORD = re.compile(r"(\b[a-z][a-z0-9+.-]*://[^\s:/@]+:)[^\s@/]+@", re.I)
AUTH_SCHEME = re.compile(r"\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}", re.I)
# `--token=XYZ`, `TOKEN=XYZ`, `"api_key": "XYZ"` and `password: XYZ`, the name and any quotes kept.
# A quoted value runs to its closing quote on the same line, so a passphrase masks whole.
NAMED_VALUE = re.compile(
    rf"((?:^|[\s\"'{{,;&|(])-{{0,2}}{SECRET_NAME}[\"']?\s*[=:]\s*)"
    rf"(?:([\"'])((?:(?!\2)[^\n])*)\2|([^\s\"',;&|)]+))",
    re.I,
)
# `--token XYZ`, where the value is the next word.
FLAG_THEN_VALUE = re.compile(rf"((?:^|\s)--?{SECRET_NAME}\s+)([^\s-][^\s]*)", re.I)
SCHEME_WORDS = {"bearer", "basic", "token"}


def has_instruction_shape(text: str) -> bool:
    return any(shape.search(text) for shape in INSTRUCTION_SHAPES)


def answer_has_instruction_shape(answer: Any) -> bool:
    """The same check over whatever a tool answered: a string, or the strings inside a structure."""
    return has_instruction_shape(_answer_text(answer, 0))


def _answer_text(answer: Any, depth: int) -> str:
    if isinstance(answer, str):
        return answer[:MOST_CHARS_READ]
    if depth >= MOST_DEPTH:
        return ""
    if isinstance(answer, dict):
        values = list(answer.values())
    elif isinstance(answer, (list, tuple)):
        values = list(answer)
    else:
        return ""
    text = ""
    for value in values:
        text += _answer_text(value, depth + 1) + "\n"
        if len(text) >= MOST_CHARS_READ:
            break
    return text[:MOST_CHARS_READ]


def leading_verb(tool: str) -> str:
    """The verb a tool's own name opens with, past an MCP server's prefix and in any case style."""
    name = tool.split(MCP_SEPARATOR)[-1]
    return (WORD_BREAK.split(name)[0] if name else "").lower()


def steerable(tool: str) -> bool:
    """What a steered agent could be talked into: speaking to somebody, or losing something."""
    verb = leading_verb(tool)
    return verb in SENDING_VERBS or verb in LOSING_VERBS


def _masked(match: re.Match[str]) -> str:
    name, quote = match.group(1), match.group(2)
    value = match.group(3) if quote is not None else match.group(4)
    if not value or value.lower() in SCHEME_WORDS or value == REDACTED:
        return match.group(0)
    return f"{name}{REDACTED}" if quote is None else f"{name}{quote}{REDACTED}{quote}"


def _masked_flag(match: re.Match[str]) -> str:
    value = match.group(2)
    if value.lower() in SCHEME_WORDS or value == REDACTED:
        return match.group(0)
    return f"{match.group(1)}{REDACTED}"


def redact_secrets(text: str) -> str:
    """The text with every credential it carries masked, and nothing else changed."""
    safe = URL_PASSWORD.sub(lambda m: f"{m.group(1)}{REDACTED}@", text)
    safe = AUTH_SCHEME.sub(lambda m: f"{m.group(1)} {REDACTED}", safe)
    safe = NAMED_VALUE.sub(_masked, safe)
    safe = FLAG_THEN_VALUE.sub(_masked_flag, safe)
    for shape in SECRET_SHAPES:
        safe = shape.sub(REDACTED, safe)
    return safe
