---
title: "Chat Request Lifecycle"
type: "flow"
status: "active"
language: "default"
source_paths:
  - "src/index.ts"
  - "src/functions/chat.ts"
  - "src/auth/resolveUserId.ts"
  - "src/runtime/runChatCompletion.ts"
  - "src/tools/dataTool.ts"
updated_at: "2026-05-20"
---

# Chat Request Lifecycle

The main product flow is a client asking a CRM question through `POST /chat`, then receiving either a stream of Server-Sent Events or one aggregate JSON response.

1. `src/index.ts` registers an anonymous Azure Functions route named `chat` with `POST` and `OPTIONS`.
2. `src/functions/chat.ts` handles CORS preflight, loads environment config, and extracts `Authorization: Bearer <token>`.
3. The handler rejects requests without a bearer token before parsing the chat payload.
4. The handler calls `resolveUserId(token, env.apiAuthUrl)` to prove the caller maps to a real CRM user.
5. The handler parses `messages`, optional model controls, stream mode, and metadata.
6. The workspace root is resolved and `AGENTS.md` is loaded through a per-workspace cache.
7. `runChatCompletion` receives the caller token as `accessToken`, creates a per-request environment copy, and exposes it to `data_tool` as `API_ACCESS_TOKEN`.
8. The runtime emits normalized app events: message deltas, final messages, tool calls, tool results, warnings, and errors.
9. Streaming requests map each runtime event to an SSE event; non-streaming requests aggregate events into a `chat.completion`-style object.

Related pages: [[trust-boundary]], [[runtime-orchestration]], [[data-tool]], [[runtime-events]].
