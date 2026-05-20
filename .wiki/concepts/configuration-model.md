---
title: "Configuration Model"
type: "concept"
status: "active"
language: "default"
source_paths:
  - "src/config/env.ts"
  - "local.settings.example.json"
  - "cli/.env.example"
  - ".gitignore"
  - "package.json"
updated_at: "2026-05-20"
---

# Configuration Model

Configuration is split by ownership. Server settings control infrastructure and provider policy; CLI settings represent a caller.

Server side:

- `local.settings.json` is gitignored.
- `local.settings.example.json` documents safe placeholders.
- `API_BASE_URL` points to the CRM API base.
- `API_AUTH_URL` points to the identity endpoint and may be absolute or relative to `API_BASE_URL`.
- `WORKSPACE_ROOT` points at the folder containing `AGENTS.md`.
- Provider credentials support OpenAI, Azure OpenAI, Anthropic, Google, and OpenAI-compatible APIs.
- Runtime defaults include provider, model, token limits, temperature, tool permission, reasoning effort, iteration limits, and wall-time limits.

CLI side:

- `cli/.env` is gitignored.
- `cli/.env.example` documents `CHAT_BASE_URL` and `API_PAT`.
- `loadCliEnv()` reads `cli/.env` unless `CRM_CHAT_CLI_ENV_FILE` points elsewhere.

Inference:

The split keeps test caller identity out of server config. That matters because [[trust-boundary]] depends on every `/chat` request carrying its own bearer token.

Related pages: [[cli-streaming-harness]], [[trust-boundary]].
