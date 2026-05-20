---
title: "CLI Streaming Harness"
type: "feature"
status: "active"
language: "default"
source_paths:
  - "cli/testChatCli.ts"
  - "cli/loadCliEnv.ts"
  - "cli/streamingTestCli.ts"
  - "cli/toolTraceRenderer.ts"
  - "cli/.env.example"
updated_at: "2026-05-20"
---

# CLI Streaming Harness

The CLI is a local test client for streamed chat turns. It is not server configuration; it behaves like a caller.

Facts from source:

- `testChatCli.ts` loads CLI-only env values, then starts the streaming CLI.
- `loadCliEnv.ts` parses dotenv-style lines and does not overwrite existing process env values.
- `streamingTestCli.ts` defaults to `CHAT_BASE_URL` or `http://localhost:7072`.
- The CLI requires `API_PAT` or `CHAT_BEARER_TOKEN`.
- Each turn sends `Authorization: Bearer <token>` to `/chat`.
- Chat history stays in process memory.
- `/clear` resets history; `/exit` and `/quit` end the session.

Trace behavior:

- `--verbose` and `--debug` change tool trace rendering.
- Tool call/result SSE events are rendered for the developer.
- Human-input tool requests are converted into terminal prompts.
- Auto-continue can send a configured follow-up when the assistant asks whether to proceed without having used a tool.

Related pages: [[configuration-model]], [[chat-request-lifecycle]], [[runtime-events]].
