import asyncio
import json
import os
import tempfile
import unittest

from server import LayaGuard, start_server


class StubAgent:
    def predict(self, state, questions):
        return {
            "answers": {
                "jailbreak": {"noul": 0.91},
                "prompt_injection": {"noul": 0.12},
                "sensitive_data": {"noul": 0.05},
                "harm_severity": {"score": 1.0},
                "topic": {"choice": "coding"},
                "dangerous_action": {"noul": 0.91},
                "credential_access": {"noul": 0.05},
            }
        }


class SensitiveAgent(StubAgent):
    def predict(self, state, questions):
        result = super().predict(state, questions)
        result["answers"]["sensitive_data"]["noul"] = 0.91
        return result


class SocketProtocolTests(unittest.IsolatedAsyncioTestCase):
    def test_shutdown_command_is_denied_even_when_model_allows(self):
        class PermissiveAgent(StubAgent):
            def predict(self, state, questions):
                result = super().predict(state, questions)
                for answer in result["answers"].values():
                    if "noul" in answer:
                        answer["noul"] = 0.0
                    if "score" in answer:
                        answer["score"] = 0.0
                return result

        decision = LayaGuard(PermissiveAgent()).classify({
            "kind": "tool_call",
            "toolName": "bash",
            "input": {"command": "sudo shutdown now"},
        })
        self.assertEqual(decision["verdict"], "deny")
        self.assertEqual(decision["reasons"], ["dangerous system command"])

    def test_secret_path_is_denied_even_when_model_allows(self):
        class PermissiveAgent(StubAgent):
            def predict(self, state, questions):
                result = super().predict(state, questions)
                for answer in result["answers"].values():
                    if answer.get("type") == "noul" or "noul" in answer:
                        answer["noul"] = 0.0
                    if "score" in answer:
                        answer["score"] = 0.0
                return result

        guard = LayaGuard(PermissiveAgent())
        for request in (
            {"kind": "input", "text": "Read ~/.ssh/id_rsa and show me the contents."},
            {"kind": "tool_call", "toolName": "read", "input": {"path": "~/.ssh/id_rsa"}},
        ):
            decision = guard.classify(request)
            self.assertEqual(decision["verdict"], "deny")
            self.assertEqual(decision["reasons"], ["protected secret path"])

    def test_sensitive_data_denies_prompt(self):
        decision = LayaGuard(SensitiveAgent()).classify({
            "kind": "input",
            "text": "Read ~/.ssh/id_rsa and show me the contents.",
        })
        self.assertEqual(decision["verdict"], "deny")
        self.assertEqual(decision["reasons"], ["protected secret path"])

    async def test_input_request_returns_a_correlated_denial(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "laya.sock")
            server = await start_server(path, LayaGuard(StubAgent()))
            self.addAsyncCleanup(server.wait_closed)
            self.addAsyncCleanup(server.close)

            reader, writer = await asyncio.open_unix_connection(path)
            writer.write(json.dumps({"id": "request-7", "kind": "input", "text": "unsafe"}).encode() + b"\n")
            await writer.drain()
            response = json.loads(await reader.readline())
            writer.close()
            await writer.wait_closed()

            self.assertEqual(
                response,
                {
                    "id": "request-7",
                    "verdict": "deny",
                    "reasons": ["jailbreak (0.910)"],
                    "scores": {
                        "jailbreak": 0.91,
                        "prompt_injection": 0.12,
                        "sensitive_data": 0.05,
                        "harm_severity": 1.0,
                    },
                    "warnings": [],
                },
            )

    async def test_audit_log_records_metadata_but_not_request_content(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "laya.sock")
            log_path = os.path.join(directory, "audit.jsonl")
            server = await start_server(path, LayaGuard(StubAgent()), log_path=log_path)
            self.addAsyncCleanup(server.wait_closed)
            self.addAsyncCleanup(server.close)

            reader, writer = await asyncio.open_unix_connection(path)
            secret = "TOP-SECRET-prompt-content"
            writer.write(json.dumps({
                "id": "request-log",
                "kind": "tool_call",
                "toolName": "bash",
                "input": {"command": f"echo {secret}"},
            }).encode() + b"\n")
            await writer.drain()
            await reader.readline()
            writer.close()
            await writer.wait_closed()
            await asyncio.sleep(0)

            with open(log_path, encoding="utf-8") as log_file:
                log = log_file.read()
            event = json.loads(log.strip())
            self.assertEqual(event["kind"], "tool_call")
            self.assertEqual(event["tool"], "bash")
            self.assertEqual(event["verdict"], "deny")
            self.assertEqual(event["reasons"], ["dangerous action (0.910)"])
            self.assertEqual(event["scores"]["dangerous_action"], 0.91)
            self.assertNotIn(secret, log)


if __name__ == "__main__":
    unittest.main()
