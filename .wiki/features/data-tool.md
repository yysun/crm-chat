---
title: "Data Tool"
type: "feature"
status: "active"
language: "default"
source_paths:
  - "src/tools/dataTool.ts"
  - "crm-ai-workspace/AGENTS.md"
updated_at: "2026-05-20"
---

# Data Tool

`data_tool` is the model's controlled path to CRM data. It calls the configured CRM API while the host owns authorization and URL boundaries. The host re-injects `X-Google-Auth` when the chat request provides it; otherwise it forwards the chat JWT as `Authorization`.

Facts from source:

- The tool is created only when `API_BASE_URL` exists.
- `API_BASE_URL` must be an absolute `http` or `https` URL.
- Tool paths must be relative; absolute paths are rejected.
- Resolved URLs must stay inside the configured origin and base path.
- Supported tool methods are code-level GET only.
- `API_DATA_TOOL_ALLOWED_ROUTES` from local/server settings controls which CRM read routes the tool can call.
- Raw CRM mutation routes are unreachable from chat because non-GET methods and unlisted paths are rejected before fetch.
- Tool-provided `Authorization`, `X-Google-Auth`, cookie, proxy authorization, and API-key headers are ignored.
- Host-owned `Authorization` and security context headers are applied after accepted model-provided headers.
- Sensitive response headers such as `authorization`, `cookie`, and `set-cookie` are stripped.

Response handling:

- JSON bodies are parsed.
- Compressed transport bodies are decoded when possible.
- Nested compressed response envelopes with a `res` field can be decompressed.
- GET requests can opt into process-memory caching with `cacheTtlMs`.
- `bypassCache` forces a fresh GET while still refreshing the cache.

Related pages: [[trust-boundary]], [[workspace-instructions]], [[chat-request-lifecycle]].
