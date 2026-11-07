"""The Python guard reaches the decisions the TypeScript guard writes to vectors/guard-decisions.json."""

import json
import pathlib
import unittest

from memnox_guard.matcher import Engine
from memnox_guard.signing import bundle_signed

VECTORS = pathlib.Path(__file__).resolve().parents[3] / "vectors" / "guard-decisions.json"


def load() -> dict:
    return json.loads(VECTORS.read_text("utf-8"))


def has_cryptography() -> bool:
    try:
        import cryptography  # noqa: F401
    except ImportError:
        return False
    return True


class SharedDecisions(unittest.TestCase):
    def test_every_decision_matches_the_typescript_guard(self) -> None:
        vectors = load()
        engine = Engine.from_bundle(vectors["bundle"])
        for case in vectors["decisions"]:
            with self.subTest(case["name"]):
                verdict = engine.decide(case["tool"], case["agent"])
                self.assertEqual(verdict.effect, case["effect"])
                self.assertEqual(verdict.rule, case["rule"])

    @unittest.skipUnless(has_cryptography(), "cryptography is not installed here")
    def test_the_signed_bundle_verifies_and_a_changed_one_does_not(self) -> None:
        signed = load()["signature"]
        keys = {signed["keyId"]: signed["publicKey"]}
        self.assertTrue(bundle_signed(signed["signature"], signed["body"], keys))
        self.assertFalse(bundle_signed(signed["signature"], signed["body"] + " ", keys))
        self.assertFalse(bundle_signed(None, signed["body"], keys))
        self.assertFalse(bundle_signed("other:" + signed["signature"].split(":", 1)[1], signed["body"], keys))


if __name__ == "__main__":
    unittest.main()
