# Written by memnox setup, and taken out by memnox uninstall. Edits here are replaced.
import json
import os
import subprocess

ARGV = __MEMNOX_ARGV__
# The same hook as the other agents run, spelled as their settings spell it.
COMMAND = __MEMNOX_COMMAND__
MOST_SECONDS = __MEMNOX_WAIT_SECONDS__
BLOCK_EXIT = 2
# Whole conversations and provider requests are never sent to the hook: it needs none of them.
LEFT_OUT = {"tool_name", "args", "session_id", "conversation_history", "request_messages", "request", "response", "assistant_message"}


def _payload(event, kwargs):
    args = kwargs.get("args")
    return {
        "hook_event_name": event,
        "tool_name": kwargs.get("tool_name"),
        "tool_input": args if isinstance(args, dict) else None,
        "session_id": kwargs.get("session_id") or kwargs.get("task_id") or "",
        "cwd": os.getcwd(),
        "extra": {key: value for key, value in kwargs.items() if key not in LEFT_OUT},
        # Tells the hook this host can ask its person, which Hermes's shell hooks cannot.
        "hermes_plugin": True,
    }


def _ask(event, kwargs):
    try:
        done = subprocess.run(
            ARGV,
            input=json.dumps(_payload(event, kwargs), default=str),
            capture_output=True,
            text=True,
            timeout=MOST_SECONDS,
        )
    except Exception:
        # A hook that could not run says nothing, as it does for every other agent.
        return None
    if done.returncode == BLOCK_EXIT:
        return {"decision": "block", "reason": done.stderr.strip() or "Memnox refused this."}
    for line in done.stdout.splitlines():
        if line.strip():
            try:
                said = json.loads(line)
            except ValueError:
                return None
            return said if isinstance(said, dict) else None
    return None


def _pre_tool_call(**kwargs):
    said = _ask("pre_tool_call", kwargs)
    if said is None:
        return None
    reason = str(said.get("reason") or "Memnox refused this.")
    if said.get("decision") == "block":
        return {"action": "block", "message": reason}
    if said.get("decision") == "ask":
        # No rule_key: a remembered yes to one would be a yes to every question Memnox asks.
        return {"action": "approve", "message": reason}
    return None


def _pre_llm_call(**kwargs):
    said = _ask("pre_llm_call", kwargs)
    if said is not None and isinstance(said.get("context"), str):
        return {"context": said["context"]}
    return None


def _recorded(event):
    def callback(**kwargs):
        _ask(event, kwargs)

    return callback


def register(ctx):
    ctx.register_hook("pre_tool_call", _pre_tool_call)
    ctx.register_hook("post_tool_call", _recorded("post_tool_call"))
    ctx.register_hook("pre_llm_call", _pre_llm_call)
    ctx.register_hook("on_session_end", _recorded("on_session_end"))
    ctx.register_hook("on_session_finalize", _recorded("on_session_finalize"))
