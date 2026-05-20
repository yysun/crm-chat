---
title: "Runtime Orchestration"
type: "feature"
status: "active"
language: "default"
source_paths:
  - "src/runtime/runtimeConfig.ts"
  - "src/runtime/runChatCompletion.ts"
  - "src/runtime/runtimeTypes.ts"
updated_at: "2026-05-20"
---

# Runtime Orchestration

The runtime layer converts an authenticated chat request into an `llm-runtime` stream with server policy applied.

Provider selection:

- Configured providers are inferred from available provider credentials.
- `metadata.provider` can select a provider.
- A request model may be prefixed as `provider:model`.
- Conflicting provider selection between metadata and model prefix throws an error.
- If the request does not specify a model, the server uses `LLM_MODEL` or a provider fallback.

Prompt and tools:

- `composeSystemPrompt()` builds a fixed system prompt, then appends loaded `AGENTS.md` content.
- `createBuiltInSelection()` disables shell, web fetch, file read/write, listing, search, directory creation, path checks, and skill loading.
- Human-input tools remain enabled.
- `createApiRequestTool()` adds `data_tool` when `API_BASE_URL` is configured.

Event handling:

- Text deltas become `message.delta` only for streaming requests.
- Final output becomes `message.done`.
- Tool starts/results become app-level tool events with timing and redacted output.
- Runtime failures become `error` events.

Related pages: [[workspace-instructions]], [[data-tool]], [[runtime-events]].
