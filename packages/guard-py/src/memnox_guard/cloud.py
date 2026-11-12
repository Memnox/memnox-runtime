"""The control plane as a guard reaches it, over HTTPS with the agent's credential.

A port, so a test hands in a fake. Every failure raises, and the guard decides what that means.
"""

from __future__ import annotations

import itertools
import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable, Optional, Protocol, Sequence

NOT_MODIFIED = 304

WORK_TOOL_MY_WORK = "memnox_my_work"
WORK_TOOL_REPORT_PROGRESS = "memnox_report_progress"
WORK_TOOL_REQUEST_HANDOFF = "memnox_request_handoff"


@dataclass(frozen=True)
class BundleFetch:
    bundle: dict[str, Any]
    body: str
    etag: Optional[str]
    signature: Optional[str]


class CloudPort(Protocol):
    def bundle(self, etag: Optional[str]) -> Optional[BundleFetch]: ...
    def keys(self) -> dict[str, str]: ...
    def raise_held(self, ask: dict[str, Any]) -> dict[str, Any]: ...
    def status(self, held_id: str, wait_seconds: int) -> dict[str, Any]: ...
    def record(self, rows: Sequence[dict[str, Any]]) -> None: ...
    def tool(self, name: str, arguments: dict[str, Any]) -> Any: ...
    # Optional: a port without it can never lift a pause, so a paused session stays paused.
    # def resumed_since(self, session_id: str, since_ms: int) -> bool: ...


# What sends one request and gives back the status, headers and body; urllib by default.
Transport = Callable[[str, str, dict[str, str], Optional[bytes]], tuple[int, dict[str, str], bytes]]


def urllib_transport(
    method: str, url: str, headers: dict[str, str], body: Optional[bytes]
) -> tuple[int, dict[str, str], bytes]:
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, {k.lower(): v for k, v in response.headers.items()}, response.read()
    except urllib.error.HTTPError as error:
        return error.code, {k.lower(): v for k, v in error.headers.items()}, error.read()


class FetchCloud:
    def __init__(
        self, base_url: str, workspace: str, token: str, transport: Transport = urllib_transport
    ) -> None:
        self._base = base_url.rstrip("/")
        self._workspace = urllib.parse.quote(workspace, safe="")
        self._token = token
        self._send = transport
        self._ids = itertools.count(1)

    def bundle(self, etag: Optional[str]) -> Optional[BundleFetch]:
        extra = {} if etag is None else {"if-none-match": f'"{etag}"'}
        status, headers, body = self._call("GET", self._path("/bundle"), None, extra)
        if status == NOT_MODIFIED:
            return None
        text = self._ok(status, body).decode("utf-8")
        bundle = json.loads(text)
        tag = headers.get("etag")
        return BundleFetch(
            bundle=bundle,
            body=text,
            etag=bundle.get("hash") if tag is None else tag.replace("W/", "").replace('"', ""),
            signature=headers.get("x-memnox-signature"),
        )

    def keys(self) -> dict[str, str]:
        status, _, body = self._call("GET", "/v1/keys", None)
        listed = json.loads(self._ok(status, body)).get("keys") or []
        return {each["keyId"]: each["publicKey"] for each in listed if isinstance(each, dict)}

    def raise_held(self, ask: dict[str, Any]) -> dict[str, Any]:
        status, _, body = self._call("POST", self._path("/held-calls"), ask)
        return json.loads(self._ok(status, body))

    def status(self, held_id: str, wait_seconds: int) -> dict[str, Any]:
        path = self._path(f"/held-calls/{urllib.parse.quote(held_id, safe='')}?wait={wait_seconds}")
        status, _, body = self._call("GET", path, None)
        return json.loads(self._ok(status, body))

    def resumed_since(self, session_id: str, since_ms: int) -> bool:
        """Whether a person resumed this session since it was paused, from any door."""
        path = self._path(
            f"/cloud-agents/sessions/{urllib.parse.quote(session_id, safe='')}/resumed?since={since_ms}"
        )
        status, _, body = self._call("GET", path, None)
        return json.loads(self._ok(status, body)).get("resumed") is True

    def record(self, rows: Sequence[dict[str, Any]]) -> None:
        if rows:
            status, _, body = self._call("POST", self._path("/events"), {"events": list(rows)})
            self._ok(status, body)

    def tool(self, name: str, arguments: dict[str, Any]) -> Any:
        """One call to the workspace's MCP door, its structured answer or its text read as JSON."""
        call = {
            "jsonrpc": "2.0",
            "id": next(self._ids),
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments},
        }
        status, _, body = self._call("POST", self._path("/mcp"), call)
        return tool_result_of(json.loads(self._ok(status, body)))

    def _path(self, rest: str) -> str:
        return f"/v1/workspaces/{self._workspace}{rest}"

    def _call(
        self, method: str, path: str, body: Optional[Any], extra: Optional[dict[str, str]] = None
    ) -> tuple[int, dict[str, str], bytes]:
        headers = {"authorization": f"Bearer {self._token}", **(extra or {})}
        data = None
        if body is not None:
            headers["content-type"] = "application/json"
            data = json.dumps(body).encode("utf-8")
        return self._send(method, f"{self._base}{path}", headers, data)

    @staticmethod
    def _ok(status: int, body: bytes) -> bytes:
        if status < 200 or status >= 300:
            raise RuntimeError(f"The control plane answered {status}.")
        return body


def tool_result_of(reply: Any) -> Any:
    if not isinstance(reply, dict) or reply.get("error") is not None:
        raise RuntimeError("The control plane refused the tool call.")
    result = reply.get("result") if isinstance(reply.get("result"), dict) else {}
    text = None
    content = result.get("content")
    if isinstance(content, list) and content and isinstance(content[0], dict):
        text = content[0].get("text") if isinstance(content[0].get("text"), str) else None
    if result.get("isError") is True:
        raise RuntimeError(text or "The tool call failed.")
    if "structuredContent" in result:
        return result["structuredContent"]
    if text is None:
        return None
    try:
        return json.loads(text)
    except ValueError:
        # A tool that answered in words rather than JSON said nothing a caller can read as work.
        return None
