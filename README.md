# Pi Laya Guardrails

A standalone Pi extension that asks a persistent [Laya](https://github.com/NandhaKishorM/laya) process to classify every user prompt and tool call. It does not depend on any other Pi extension.

## Modes

- `confirm` (default): a Laya denial opens an **Allow / Block** prompt. Without an interactive UI, it blocks.
- `enforce`: a Laya denial is blocked immediately.

Blocking does not terminate Pi. The blocked prompt is shown in the confirmation dialog or block notification, truncated to 500 characters and never written to the audit log. The current prompt or tool call is rejected and the session remains usable.

The extension fails closed when the socket is missing, times out, or returns an invalid response.

## Install

The Python server requires Laya and [uv](https://docs.astral.sh/uv/):

```bash
uv venv .venv
uv pip install --python .venv/bin/python laya
```

Install this directory as a local Pi package:

```bash
pi install /absolute/path/to/laya-playground
```

For a one-off run instead:

```bash
pi --no-extensions -e ./extensions/laya-guardrails.ts
```

`--no-extensions` disables auto-discovered extensions; the explicitly supplied Laya extension still loads.

## Run

Start the server first and leave it running:

```bash
.venv/bin/python server.py
```

Then start Pi. The default socket is `/tmp/pi-laya-guardrails.sock`.

```bash
PI_LAYA_GUARDRAILS_MODE=confirm pi
```

Inside Pi:

```text
/laya-guardrails status
/laya-guardrails confirm
/laya-guardrails enforce
```

## Configuration

| Environment variable | Default | Purpose |
|---|---|---|
| `PI_LAYA_SOCKET` | `/tmp/pi-laya-guardrails.sock` | Unix socket used by server and extension |
| `PI_LAYA_TIMEOUT_MS` | `2000` | Extension request timeout |
| `PI_LAYA_GUARDRAILS_MODE` | `confirm` | Initial `confirm` or `enforce` mode |
| `PI_LAYA_MODEL` | `convaiinnovations/laya` | Model loaded by `server.py` |
| `PI_LAYA_SUBFOLDER` | unset | Optional checkpoint subfolder |
| `PI_LAYA_DEVICE` | auto | Laya device such as `cuda`, `mps`, or `cpu` |

Server flags override the matching server defaults:

```bash
.venv/bin/python server.py \
  --socket /tmp/pi-laya-guardrails.sock \
  --model convaiinnovations/laya \
  --device cuda
```

The socket is created with mode `0600`. The server refuses to replace an existing path unless it is a Unix socket.

## Privacy-preserving audit logging

The server writes one JSONL audit event per request to **stderr** by default. Events contain only:

- timestamp
- request kind (`input` or `tool_call`)
- tool name, for tool calls
- allow/deny/error verdict
- classification reasons
- numeric classification scores
- warnings
- latency

They never contain prompt text or tool arguments. Reasons and scores may identify a category such as jailbreak, credential access, or dangerous command, but do not contain the request content. File logs, when enabled, are created with mode `0600`.

Set `PI_LAYA_LOG` or `--log` to write to a file, or set it to an empty value to disable logging:

```bash
PI_LAYA_LOG=/path/to/audit.jsonl .venv/bin/python server.py
PI_LAYA_LOG="" .venv/bin/python server.py       # disable audit logging
```

## Decisions

Input prompts are denied when Laya reports any of:

- jailbreak probability ≥ 0.80
- prompt-injection probability ≥ 0.80
- harm severity ≥ 2.50 on a 0–3 scale

Sensitive-data probability ≥ 0.80 denies the prompt and emits a reason.

Tool calls are denied when Laya reports dangerous-action or credential-access probability ≥ 0.80, or harm severity ≥ 2.50. Common secret paths (`~/.ssh/id_rsa`, `~/.ssh/id_ed25519`, `~/.aws/credentials`, `.env`, private-key paths, and similar) are denied deterministically even if Laya says allow. Destructive system commands such as `shutdown`, `poweroff`, `reboot`, `halt`, and equivalent `systemctl`/`loginctl` commands are also deterministically denied when they appear in tool arguments.

These are experimental learned guardrails. Laya's published results describe imperfect prompt-injection accuracy and calibration limitations. Use `confirm` mode while evaluating false positives and false negatives; do not treat this extension as an OS sandbox.

## Test

```bash
npm test
```
