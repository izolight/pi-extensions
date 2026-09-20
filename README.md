# Laya Playground

A small workspace for experimenting with Laya-backed Pi extensions.

## Directories

- [`laya-server/`](./laya-server/) — shared Python Laya Unix-socket server and server tests
- [`laya-guardrails/`](./laya-guardrails/) — standalone Pi guardrails extension package
- [`laya-model-router/`](./laya-model-router/) — standalone Pi model-router extension with user-defined model mappings

## Quick start

```bash
cd laya-server
uv venv .venv
uv pip install --python .venv/bin/python "laya==0.3.3"
.venv/bin/python server.py
```

In another terminal, install either or both extensions:

```bash
pi install ./laya-guardrails
pi install ./laya-model-router
PI_LAYA_GUARDRAILS_MODE=confirm pi
```

See each extension's README for configuration. Server policy, protocol, logging, and tests are documented in [`laya-server/README.md`](./laya-server/README.md).
