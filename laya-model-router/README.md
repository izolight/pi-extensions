# Pi Laya Model Router

A Pi extension that asks a local Laya server to classify each user task as `low`, `medium`, or `high` strength, then selects the model mapped to that level by the user.

The extension only chooses among your mappings. It does not proxy model traffic or handle provider credentials.

## Install

Start the companion server from the repository root:

```bash
cd laya-server
uv venv .venv
uv pip install --python .venv/bin/python "laya==0.3.3"
.venv/bin/python server.py
```

Install the extension locally:

```bash
pi install ./laya-model-router
```

For a one-off run:

```bash
pi --no-extensions -e ./laya-model-router/extensions/laya-model-router.ts
```

## Configure model mappings

Create `~/.pi/agent/laya-model-router.json`:

```json
{
  "mode": "initial",
  "levels": {
    "low": {
      "provider": "openai-codex",
      "model": "gpt-5.6-luna",
      "thinkingLevel": "off"
    },
    "medium": {
      "provider": "openai-codex",
      "model": "gpt-5.6-luna",
      "thinkingLevel": "xhigh"
    },
    "high": {
      "provider": "openai-codex",
      "model": "gpt-5.6-sol",
      "thinkingLevel": "medium"
    }
  }
}
```

A trusted project can override individual levels in `.pi/laya-model-router.json`. Targets must already be available to Pi and authenticated. `thinkingLevel` is optional.

Routing modes:

- `initial` (default) — classify the first prompt in a session, then keep that model for the rest of the session.
- `every` — classify every new prompt and switch models as needed.

You can also select the mode for a run with `PI_LAYA_ROUTER_MODE=initial` or `PI_LAYA_ROUTER_MODE=every`. The environment variable takes precedence over the config file. On resumed sessions, `initial` mode does not route again if the session already contains a user message.

The levels mean:

- `low` — simple, well-specified, low-risk tasks
- `medium` — multi-step tasks requiring normal reasoning
- `high` — ambiguous, architectural, security-sensitive, or otherwise demanding tasks

Run `/laya-router` to inspect the active mappings. The footer shows the most recently selected level and model.

Routing fails open: if Laya is unavailable, a level is unmapped, or its target cannot be used, Pi keeps the current model and displays a warning.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `PI_LAYA_SOCKET` | `/tmp/pi-laya-guardrails.sock` | Shared Laya server Unix socket |
| `PI_LAYA_TIMEOUT_MS` | `2000` | Routing request timeout |
| `PI_LAYA_ROUTER_MODE` | config or `initial` | `initial` or `every` |

## Tests

```bash
npm test
```
