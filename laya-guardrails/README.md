# Pi Laya Guardrails

A thin, standalone Pi extension that sends user prompts and LLM-generated tool calls to a local Laya guardrail server. It does not depend on any other Pi extension.

The server owns model inference, policy, deterministic protections, and audit logging. See the [Laya server](https://github.com/izolight/pi-extensions/tree/master/laya-server).

## Install

Install the companion server first; from the repository root:

```bash
cd laya-server
uv venv .venv
uv pip install --python .venv/bin/python "laya==0.3.3"
.venv/bin/python server.py
```

Then install the published Pi package:

```bash
pi install npm:pi-laya-guardrails
```

For local development instead:

```bash
pi install ./laya-guardrails
```

For a one-off run from this directory:

```bash
pi --no-extensions -e ./extensions/laya-guardrails.ts
```

## Modes

- `confirm` (default): a denied prompt or tool call opens an Allow/Block decision.
- `enforce`: denied prompts and tool calls are blocked immediately.

Blocking does not terminate the Pi session. Blocked prompts are shown in the UI, truncated to 500 characters. Direct user `!`/`!!` commands are intentionally outside this extension's scope; the extension guards LLM calls only.

Set the initial mode with:

```bash
PI_LAYA_GUARDRAILS_MODE=confirm pi
```

Change it during a session:

```text
/laya-guardrails status
/laya-guardrails confirm
/laya-guardrails enforce
```

## Extension configuration

| Environment variable | Default | Purpose |
|---|---|---|
| `PI_LAYA_SOCKET` | `/tmp/pi-laya-guardrails.sock` | Server Unix socket |
| `PI_LAYA_TIMEOUT_MS` | `2000` | Classification request timeout |
| `PI_LAYA_GUARDRAILS_MODE` | `confirm` | Initial `confirm` or `enforce` mode |

The extension fails closed when the server is unavailable, times out, or returns an invalid response.

## Tests

```bash
npm test
```
