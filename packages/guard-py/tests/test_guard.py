"""A guard decides allow and deny in process, believes only a signed yes, and reports the agent's work."""

import base64
import json
import unittest
from typing import Any, Optional, Sequence

from memnox_guard import Engine, FetchCloud, Guard, ToolRefused, wrap_tool
from memnox_guard.cloud import BundleFetch
from memnox_guard.guard import args_digest_of
from memnox_guard.matcher import BundleRefused
from test_vectors import has_cryptography, load

BUNDLE = load()["bundle"]
SIGNED = load()["signature"]


class FakeCloud:
    def __init__(self, answer: Optional[dict] = None) -> None:
        self.answer = answer
        self.raised: list[dict] = []
        self.recorded: list[dict] = []
        self.calls: list[tuple[str, dict]] = []

    def bundle(self, etag: Optional[str]) -> Optional[BundleFetch]:
        return BundleFetch(bundle=BUNDLE, body=SIGNED["body"], etag="vectors-1", signature=SIGNED["signature"])

    def keys(self) -> dict[str, str]:
        return {SIGNED["keyId"]: SIGNED["publicKey"]}

    def raise_held(self, ask: dict) -> dict:
        self.raised.append(ask)
        return {"id": "apr_1"}

    def status(self, held_id: str, wait_seconds: int) -> dict:
        return self.answer or {"id": held_id, "status": "expired"}

    def record(self, rows: Sequence[dict]) -> None:
        self.recorded.extend(rows)

    def tool(self, name: str, arguments: dict) -> Any:
        self.calls.append((name, arguments))
        return {"work": [{"id": "agw_1", "status": "active"}, {"status": "no id"}]}


def guard_on(cloud: FakeCloud, **options: Any) -> Guard:
    guard = Guard(cloud=cloud, agent="support-bot", **options)
    guard.refresh()
    return guard


@unittest.skipUnless(has_cryptography(), "cryptography is not installed here")
class Deciding(unittest.TestCase):
    def test_denies_and_allows_in_process_from_the_signed_bundle(self) -> None:
        guard = guard_on(FakeCloud(), profile_id="support")
        refused = guard.authorize("mcp__stripe__create_refund", {"amount": 1}, "s1")
        self.assertFalse(refused.allowed)
        self.assertEqual(refused.rule, "no-refunds")
        self.assertTrue(guard.authorize("mcp__github__list_repos", {}, "s1").allowed)
        self.assertEqual({row["payload"]["profileId"] for row in guard.pending}, {"support"})
        self.assertNotIn('"amount"', json.dumps(guard.pending))

    def test_keeps_no_rules_from_a_bundle_whose_signature_fails(self) -> None:
        cloud = FakeCloud()
        cloud.keys = lambda: {SIGNED["keyId"]: base64.b64encode(b"not a key").decode()}  # type: ignore[method-assign]
        guard = guard_on(cloud)
        self.assertTrue(guard.authorize("mcp__stripe__create_refund", {}, "s1").allowed)

    def test_refuses_an_ask_nobody_answered_and_a_yes_nobody_signed(self) -> None:
        guard = guard_on(FakeCloud(), wait_seconds=1)
        self.assertFalse(guard.authorize("mcp__linear__create_issue", {}, "s1").allowed)
        unsigned = FakeCloud({"id": "apr_1", "status": "answered", "answer": "once", "by": "ana"})
        self.assertFalse(guard_on(unsigned).authorize("mcp__linear__create_issue", {}, "s1").allowed)

    def test_believes_a_yes_signed_for_this_very_call(self) -> None:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

        key = Ed25519PrivateKey.generate()
        public = base64.b64encode(key.public_key().public_bytes(Encoding.DER, PublicFormat.SubjectPublicKeyInfo)).decode()
        payload = json.dumps({"callId": "apr_1", "answer": "once", "argsDigest": args_digest_of({"title": "x"})})
        signed = {"payload": payload, "signature": base64.b64encode(key.sign(payload.encode())).decode(), "keyId": "k2"}
        cloud = FakeCloud({"id": "apr_1", "status": "answered", "answer": "once", "by": "ana", "signed": signed})
        cloud.keys = lambda: {SIGNED["keyId"]: SIGNED["publicKey"], "k2": public}  # type: ignore[method-assign]
        decision = guard_on(cloud).authorize("mcp__linear__create_issue", {"title": "x"}, "s1")
        self.assertTrue(decision.allowed)
        self.assertEqual(decision.answered_by, "ana")
        other = guard_on(cloud).authorize("mcp__linear__create_issue", {"title": "y"}, "s1")
        self.assertFalse(other.allowed)

    def test_a_wrapped_tool_raises_its_refusal(self) -> None:
        guard = guard_on(FakeCloud())
        refund = wrap_tool(guard, "mcp__stripe__create_refund", lambda **_: "done", lambda _: "s1")
        with self.assertRaises(ToolRefused) as raised:
            refund(amount=1)
        self.assertIn("refunds go through finance", str(raised.exception))


class Work(unittest.TestCase):
    def test_reads_and_reports_its_work_through_the_mcp_tools(self) -> None:
        cloud = FakeCloud()
        guard = Guard(cloud=cloud, agent="support-bot")
        self.assertEqual(guard.my_work(), [{"id": "agw_1", "status": "active"}])
        guard.report_progress("agw_1", "drafted", state="done_claimed", refs=[{"kind": "pr", "id": "17"}])
        guard.request_handoff("agw_1", "a refund", to_profile="billing")
        self.assertEqual([name for name, _ in cloud.calls], [
            "memnox_my_work", "memnox_report_progress", "memnox_request_handoff",
        ])
        self.assertEqual(cloud.calls[1][1]["state"], "done_claimed")

    def test_fetch_cloud_posts_json_rpc_to_the_workspace_mcp_door(self) -> None:
        sent: list[tuple[str, str, dict]] = []

        def transport(method: str, url: str, headers: dict, body: Optional[bytes]) -> tuple[int, dict, bytes]:
            sent.append((method, url, json.loads(body or b"{}")))
            reply = {"jsonrpc": "2.0", "id": 1, "result": {"content": [{"type": "text", "text": '{"work": []}'}]}}
            return 200, {}, json.dumps(reply).encode()

        cloud = FetchCloud("https://cloud.test", "ws_1", "tok" + "en", transport)
        self.assertEqual(cloud.tool("memnox_my_work", {}), {"work": []})
        method, url, body = sent[0]
        self.assertEqual((method, url), ("POST", "https://cloud.test/v1/workspaces/ws_1/mcp"))
        self.assertEqual(body["method"], "tools/call")
        self.assertEqual(body["params"]["name"], "memnox_my_work")


class Refusing(unittest.TestCase):
    def test_a_bundle_with_an_effect_it_does_not_know_is_refused_whole(self) -> None:
        with self.assertRaises(BundleRefused):
            Engine.from_bundle({"rules": [{"id": "r", "effect": "redact", "match": "tool.x"}]})

    def test_a_deny_with_a_condition_it_cannot_read_still_denies(self) -> None:
        engine = Engine.from_bundle({"rules": [
            {"id": "big", "effect": "deny", "match": "tool.pay", "conditions": {"aboveAmount": 100}},
            {"id": "open", "effect": "allow", "match": "tool.read", "conditions": {"windows": []}},
        ]})
        self.assertEqual(engine.decide("pay", "a").effect, "deny")
        self.assertIsNone(engine.decide("read", "a").rule)

    def test_loads_without_either_framework_installed(self) -> None:
        import memnox_guard.adapters as adapters

        self.assertTrue(callable(adapters.guard_agents_tool))
        self.assertTrue(callable(adapters.guard_langchain_tool))


if __name__ == "__main__":
    unittest.main()
