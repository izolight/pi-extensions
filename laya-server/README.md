# Laya Server

This is the shared inference side of the project. It loads Laya and exposes a persistent Unix-socket JSONL service consumed by the Pi guardrails and model-router extensions. The published source is available at [izolight/pi-extensions/laya-server](https://github.com/izolight/pi-extensions/tree/master/laya-server).

## Setup

From this directory:

```bash
uv venv .venv
uv pip install --python .venv/bin/python "laya==0.3.3"
```

Start the server:

```bash
.venv/bin/python server.py
```

The default socket is:

```text
/tmp/pi-laya-guardrails.sock
```

Useful options:

```bash
.venv/bin/python server.py \
  --socket /tmp/pi-laya-guardrails.sock \
  --model convaiinnovations/laya \
  --device cuda
```

Environment variables are also supported:

- `PI_LAYA_SOCKET`
- `PI_LAYA_MODEL`
- `PI_LAYA_SUBFOLDER`
- `PI_LAYA_DEVICE`
- `PI_LAYA_LOG`

## Protocol

The server accepts one JSON object per newline and returns one JSON object per newline. Requests contain an opaque request ID and either:

```json
{"id":"...","kind":"input","text":"..."}
```

or:

```json
{"id":"...","kind":"tool_call","toolName":"bash","input":{"command":"..."}}
```

The model router sends:

```json
{"id":"...","kind":"model_route","text":"..."}
```

Guardrail responses contain the matching ID, a verdict, reasons, scores, and warnings. Router responses contain the matching ID, a `low`, `medium`, or `high` level, and optional confidence. Prompt text and tool arguments are never included in audit logs.

## Policy

Input prompts are denied when Laya reports:

- jailbreak probability ≥ `0.80`
- prompt-injection probability ≥ `0.80`
- sensitive-data probability ≥ `0.80`
- harm severity ≥ `2.50` on a 0–3 scale

Tool calls are denied when Laya reports:

- protected-secret-path probability ≥ `0.80`
- dangerous-system-command probability ≥ `0.80`
- dangerous-action probability ≥ `0.80`
- credential-access probability ≥ `0.80`
- harm severity ≥ `2.50`

The server also applies deterministic fail-safe checks for common secret paths such as `~/.ssh/id_rsa`, `~/.ssh/id_ed25519`, `~/.aws/credentials`, `.env`, and private-key paths. Shutdown commands such as `shutdown`, `poweroff`, `reboot`, `halt`, and equivalent `systemctl`/`loginctl` commands are also denied when found in tool arguments. These rules remain active even if Laya returns `allow`.

Model-routing prompts are classified into three predefined strengths:

- `low`: simple, well-specified, low-risk, or routine work
- `medium`: multi-step work requiring normal reasoning, debugging, or implementation
- `high`: ambiguous, architectural, security-sensitive, novel, or unusually demanding work

## Audit logging

Privacy-preserving JSONL audit events go to **stderr** by default. Each event contains:

- timestamp
- request kind
- tool name, for tool calls
- allow/deny/error verdict
- classification reasons
- numeric classification scores
- warnings
- latency

Events never contain prompt text or tool arguments. File logging is opt-in:

```bash
PI_LAYA_LOG=/tmp/laya-audit.jsonl .venv/bin/python server.py
```

Disable audit logging with an empty value:

```bash
PI_LAYA_LOG="" .venv/bin/python server.py
```

File logs and the socket are created with mode `0600`.

## Limitations

These are experimental learned guardrails. Laya can produce false positives and false negatives, and its probabilities require calibration for a production workload. The server is not an OS sandbox.

## Tests

```bash
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
```
