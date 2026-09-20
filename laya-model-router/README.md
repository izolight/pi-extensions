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
  "levels": {
    "low": {
      "provider": "anthropic",
      "model": "claude-haiku-4-5",
      "thinkingLevel": "off"
    },
    "medium": {
      "provider": "anthropic",
      "model": "claude-sonnet-4-5",
      "thinkingLevel": "medium"
    },
    "high": {
      "provider": "anthropic",
      "model": "claude-opus-4-6",
      "thinkingLevel": "high"
    }
  }
}
```

A trusted project can override individual levels in `.pi/laya-model-router.json`. Targets must already be available to Pi and authenticated. `thinkingLevel` is optional.

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

## Tests

```bash
npm test
```
