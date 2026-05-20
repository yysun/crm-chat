---
title: "HTTP Chat Endpoint"
type: "feature"
status: "active"
language: "default"
source_paths:
  - "src/index.ts"
  - "src/functions/chat.ts"
  - "host.json"
updated_at: "2026-05-20"
---

# HTTP Chat Endpoint

The HTTP layer is intentionally small. It adapts Azure Functions HTTP requests into the app's runtime contract and adapts runtime events back into HTTP responses.

Facts from source:

- `host.json` sets `extensions.http.routePrefix` to an empty string, so the route is `/chat`, not `/api/chat`.
- `src/index.ts` enables HTTP streaming and registers `POST` plus `OPTIONS`.
- `src/functions/chat.ts` accepts an OpenAI-style request shape:
  - `messages`
  - optional `model`
  - optional `stream`
  - optional `temperature`
  - optional `max_tokens`
  - optional `metadata`
- The handler validates that `messages` is a non-empty array of role/content string objects.
- Streaming responses use `Content-Type: text/event-stream; charset=utf-8`.
- Non-streaming responses aggregate runtime events into an object shaped like `chat.completion`.

Product role:

This endpoint is the narrow public surface. It does not expose local filesystem access, shell execution, or direct arbitrary fetch. Those decisions live in [[runtime-orchestration]] and [[data-tool]].

Related pages: [[chat-request-lifecycle]], [[runtime-events]].
