"""Tools from agent frameworks, governed: asked about before they run, refused with a reason.

Neither the OpenAI Agents SDK nor LangChain is imported until one of its wrappers is called, so
this package installs and loads with neither of them present.
"""

from __future__ import annotations

import asyncio
import functools
import inspect
import json
from typing import Any, Callable, Mapping

from .guard import Guard, ToolRefused, refusal_text


def wrap_tool(
    guard: Guard, name: str, run: Callable[..., Any], session: Callable[[Mapping[str, Any]], str]
) -> Callable[..., Any]:
    """Any function a framework calls a tool, refused with ToolRefused, its outcome told to the breaker."""
    if inspect.iscoroutinefunction(run):

        @functools.wraps(run)
        async def governed_async(**arguments: Any) -> Any:
            session_id = session(arguments)
            decision = await asyncio.to_thread(guard.authorize, name, arguments, session_id)
            if not decision.allowed:
                raise ToolRefused(decision)
            try:
                output = await run(**arguments)
            except Exception as error:
                guard.outcome(name, session_id, True, arguments, type(error).__name__)
                raise
            # The answer is read for instructions, so a ticket that steers the agent taints the run.
            guard.outcome(name, session_id, False, arguments, output=output)
            return output

        return governed_async

    @functools.wraps(run)
    def governed(**arguments: Any) -> Any:
        session_id = session(arguments)
        decision = guard.authorize(name, arguments, session_id)
        if not decision.allowed:
            raise ToolRefused(decision)
        try:
            output = run(**arguments)
        except Exception as error:
            guard.outcome(name, session_id, True, arguments, type(error).__name__)
            raise
        guard.outcome(name, session_id, False, arguments, output=output)
        return output

    return governed


def guard_agents_tool(guard: Guard, tool: Any, session: Callable[[Any], str]) -> Any:
    """An OpenAI Agents SDK FunctionTool whose refusal comes back as its output, so the model reads why."""
    import dataclasses

    original = tool.on_invoke_tool

    async def on_invoke_tool(context: Any, input_json: str) -> Any:
        arguments = json.loads(input_json or "{}")
        decision = await asyncio.to_thread(guard.authorize, tool.name, arguments, session(context))
        if not decision.allowed:
            return refusal_text(decision)
        return await original(context, input_json)

    return dataclasses.replace(tool, on_invoke_tool=on_invoke_tool)


def guard_langchain_tool(guard: Guard, tool: Any, session: Callable[[Mapping[str, Any]], str]) -> Any:
    """A LangChain or LangGraph tool, rebuilt so each call is asked about first; a refusal is its output."""
    from langchain_core.tools import StructuredTool

    def run(**arguments: Any) -> Any:
        decision = guard.authorize(tool.name, arguments, session(arguments))
        return refusal_text(decision) if not decision.allowed else tool.invoke(arguments)

    async def arun(**arguments: Any) -> Any:
        decision = await asyncio.to_thread(guard.authorize, tool.name, arguments, session(arguments))
        return refusal_text(decision) if not decision.allowed else await tool.ainvoke(arguments)

    return StructuredTool.from_function(
        func=run, coroutine=arun, name=tool.name, description=tool.description, args_schema=tool.args_schema
    )
