# Laya Playground

A small workspace for experimenting with Laya-backed Pi guardrails.

## Directories

- [`laya-server/`](./laya-server/) — Python Laya Unix-socket server and server tests
- [`laya-guardrails/`](./laya-guardrails/) — standalone Pi extension package

Future Pi extensions can live beside `laya-guardrails/` as sibling directories.

## Quick start

```bash
cd laya-server
uv venv .venv
uv pip install --python .venv/bin/python "laya==0.3.3"
.venv/bin/python server.py
```

In another terminal:

```bash
pi install /absolute/path/to/laya-playground/laya-guardrails
PI_LAYA_GUARDRAILS_MODE=confirm pi
```

For package-specific configuration, decisions, logging, and tests, see [`laya-guardrails/README.md`](./laya-guardrails/README.md).
