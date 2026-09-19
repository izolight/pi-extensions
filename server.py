#!/usr/bin/env python3
"""Persistent Laya guardrail server using newline-delimited JSON over a Unix socket."""

import argparse
import asyncio
import json
import os
import re
import signal
import stat
import sys
import time
from typing import Any, Dict, Optional

import laya

INPUT_THRESHOLD = 0.80
HARM_THRESHOLD = 2.50
SENSITIVE_THRESHOLD = 0.80
MAX_REQUEST_BYTES = 1024 * 1024


_DANGEROUS_SYSTEM_COMMAND = re.compile(
    r"(?:^|[;&|`]\s*)(?:sudo\s+)?(?:shutdown(?:\s|$)|poweroff(?:\s|$)|reboot(?:\s|$)|"
    r"halt(?:\s|$)|systemctl\s+(?:poweroff|reboot|halt)\b|"
    r"loginctl\s+(?:poweroff|reboot)\b|init\s+0\b)",
    re.IGNORECASE,
)

_SECRET_PATH_PATTERNS = (
    ".ssh/id_rsa",
    ".ssh/id_ed25519",
    ".ssh/id_ecdsa",
    ".ssh/id_dsa",
    ".aws/credentials",
    ".aws/config",
    ".gnupg/",
    ".env",
    "private_key",
    "private-key",
)


def _contains_secret_path(value: Any) -> bool:
    if isinstance(value, str):
        normalized = value.replace("\\", "/").lower()
        return any(pattern in normalized for pattern in _SECRET_PATH_PATTERNS)
    if isinstance(value, dict):
        return any(_contains_secret_path(item) for item in value.values())
    if isinstance(value, list):
        return any(_contains_secret_path(item) for item in value)
    return False


def _contains_dangerous_system_command(value: Any) -> bool:
    if isinstance(value, str):
        return bool(_DANGEROUS_SYSTEM_COMMAND.search(value))
    if isinstance(value, dict):
        return any(_contains_dangerous_system_command(item) for item in value.values())
    if isinstance(value, list):
        return any(_contains_dangerous_system_command(item) for item in value)
    return False


def tool_questions() -> Dict[str, Dict[str, Any]]:
    return {
        "dangerous_action": {
            "type": "noul",
            "instructions": (
                "Could executing this tool call destroy data, make broad or irreversible changes, "
                "weaken security, or execute untrusted code?"
            ),
        },
        "credential_access": {
            "type": "noul",
            "instructions": (
                "Could this tool call read, expose, transmit, overwrite, or delete credentials, "
                "private keys, authentication tokens, or other secrets?"
            ),
        },
        "harm_severity": {
            "type": "score",
            "instructions": "How harmful could executing this tool call be?",
            "criteria": [
                "none: routine and reversible",
                "minor: limited and easily reversible",
                "serious: destructive, security-sensitive, or difficult to reverse",
                "severe: broad data loss, credential compromise, or remote code execution",
            ],
        },
    }


class LayaGuard:
    """Convert Laya typed decisions into a small allow/deny protocol."""

    def __init__(self, agent: Any):
        self.agent = agent

    def classify(self, request: Dict[str, Any]) -> Dict[str, Any]:
        kind = request.get("kind")
        if kind == "input":
            if _contains_secret_path(request.get("text", "")):
                return {"verdict": "deny", "reasons": ["protected secret path"], "scores": {}, "warnings": []}
            result = self.agent.predict({"prompt": str(request.get("text", ""))}, laya.guard_questions())
            return self._input_decision(result["answers"])
        if kind == "tool_call":
            if _contains_secret_path(request.get("input")):
                return {"verdict": "deny", "reasons": ["protected secret path"], "scores": {}, "warnings": []}
            if _contains_dangerous_system_command(request.get("input")):
                return {"verdict": "deny", "reasons": ["dangerous system command"], "scores": {}, "warnings": []}
            state = {
                "tool": str(request.get("toolName", "")),
                "arguments": request.get("input"),
            }
            result = self.agent.predict(state, tool_questions())
            return self._tool_decision(result["answers"])
        raise ValueError("kind must be 'input' or 'tool_call'")

    @staticmethod
    def _input_decision(answers: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
        scores = {
            "jailbreak": float(answers["jailbreak"]["noul"]),
            "prompt_injection": float(answers["prompt_injection"]["noul"]),
            "sensitive_data": float(answers["sensitive_data"]["noul"]),
            "harm_severity": float(answers["harm_severity"]["score"]),
        }
        reasons = []
        if scores["jailbreak"] >= INPUT_THRESHOLD:
            reasons.append("jailbreak (%.3f)" % scores["jailbreak"])
        if scores["prompt_injection"] >= INPUT_THRESHOLD:
            reasons.append("prompt injection (%.3f)" % scores["prompt_injection"])
        if scores["harm_severity"] >= HARM_THRESHOLD:
            reasons.append("harm severity (%.3f)" % scores["harm_severity"])
        if scores["sensitive_data"] >= SENSITIVE_THRESHOLD:
            reasons.append("sensitive data (%.3f)" % scores["sensitive_data"])
        warnings = []
        return {
            "verdict": "deny" if reasons else "allow",
            "reasons": reasons,
            "scores": scores,
            "warnings": warnings,
        }

    @staticmethod
    def _tool_decision(answers: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
        scores = {
            "dangerous_action": float(answers["dangerous_action"]["noul"]),
            "credential_access": float(answers["credential_access"]["noul"]),
            "harm_severity": float(answers["harm_severity"]["score"]),
        }
        reasons = []
        if scores["dangerous_action"] >= INPUT_THRESHOLD:
            reasons.append("dangerous action (%.3f)" % scores["dangerous_action"])
        if scores["credential_access"] >= INPUT_THRESHOLD:
            reasons.append("credential access (%.3f)" % scores["credential_access"])
        if scores["harm_severity"] >= HARM_THRESHOLD:
            reasons.append("harm severity (%.3f)" % scores["harm_severity"])
        return {
            "verdict": "deny" if reasons else "allow",
            "reasons": reasons,
            "scores": scores,
            "warnings": [],
        }


def _audit(
    log_path: Optional[str],
    request: Dict[str, Any],
    decision: Dict[str, Any],
    started: float,
) -> None:
    if not log_path:
        return
    event = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "kind": request.get("kind", "unknown"),
        "verdict": decision.get("verdict", "error"),
        "reasons": decision.get("reasons", []),
        "scores": decision.get("scores", {}),
        "warnings": decision.get("warnings", []),
        "latency_ms": round((time.monotonic() - started) * 1000, 1),
    }
    if request.get("kind") == "tool_call" and isinstance(request.get("toolName"), str):
        event["tool"] = request["toolName"]
    line = json.dumps(event, separators=(",", ":"))
    if log_path == "-":
        print(line, file=sys.stderr, flush=True)
    else:
        with open(log_path, "a", encoding="utf-8") as log_file:
            log_file.write(line + "\n")


async def _handle(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
    guard: LayaGuard,
    log_path: Optional[str],
) -> None:
    request_id = None
    request: Dict[str, Any] = {}
    started = time.monotonic()
    try:
        line = await reader.readline()
        if not line:
            return
        if len(line) > MAX_REQUEST_BYTES:
            raise ValueError("request exceeded 1MB")
        request = json.loads(line)
        request_id = request.get("id")
        if not isinstance(request_id, str) or not request_id:
            raise ValueError("id must be a non-empty string")
        decision = guard.classify(request)
        response = {"id": request_id, **decision}
        _audit(log_path, request, decision, started)
    except Exception as error:
        _audit(log_path, request, {"verdict": "error"}, started)
        response = {
            "id": request_id,
            "error": str(error),
        }
    writer.write(json.dumps(response, separators=(",", ":")).encode("utf-8") + b"\n")
    await writer.drain()
    writer.close()
    await writer.wait_closed()


async def start_server(
    socket_path: str,
    guard: LayaGuard,
    log_path: Optional[str] = None,
) -> asyncio.AbstractServer:
    if os.path.lexists(socket_path):
        mode = os.lstat(socket_path).st_mode
        if not stat.S_ISSOCK(mode):
            raise RuntimeError("refusing to replace non-socket path: %s" % socket_path)
        os.unlink(socket_path)
    if log_path and log_path != "-":
        os.makedirs(os.path.dirname(os.path.abspath(log_path)), exist_ok=True)
        if not os.path.exists(log_path):
            open(log_path, "a", encoding="utf-8").close()
        os.chmod(log_path, 0o600)
    server = await asyncio.start_unix_server(
        lambda reader, writer: _handle(reader, writer, guard, log_path),
        path=socket_path,
        limit=MAX_REQUEST_BYTES + 1,
    )
    os.chmod(socket_path, 0o600)
    return server


async def run(args: argparse.Namespace) -> None:
    agent = laya.load(args.model, device=args.device, subfolder=args.subfolder)
    server = await start_server(args.socket, LayaGuard(agent), log_path=args.log)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    print("Laya guardrails listening on %s" % args.socket, flush=True)
    async with server:
        await stop.wait()
    if os.path.exists(args.socket):
        os.unlink(args.socket)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--socket", default=os.environ.get("PI_LAYA_SOCKET", "/tmp/pi-laya-guardrails.sock"))
    parser.add_argument("--model", default=os.environ.get("PI_LAYA_MODEL", "convaiinnovations/laya"))
    parser.add_argument("--subfolder", default=os.environ.get("PI_LAYA_SUBFOLDER"))
    parser.add_argument("--device", default=os.environ.get("PI_LAYA_DEVICE"))
    parser.add_argument(
        "--log",
        default=os.environ.get("PI_LAYA_LOG", "-"),
        help="privacy-preserving audit log path, '-' for stderr; use an empty value to disable",
    )
    return parser.parse_args()


if __name__ == "__main__":
    asyncio.run(run(parse_args()))
