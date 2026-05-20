---
title: "Runtime Events"
type: "entity"
status: "active"
language: "default"
source_paths:
  - "src/runtime/runtimeTypes.ts"
  - "src/runtime/runChatCompletion.ts"
  - "src/sse/mapRuntimeEvent.ts"
  - "cli/streamingTestCli.ts"
updated_at: "2026-05-20"
---

# Runtime Events

Runtime events are the internal contract between `llm-runtime`, the HTTP layer, and the CLI renderer.

Event types:

- `message.delta`: streamed text chunk.
- `message.done`: final assistant message.
- `tool.call`: tool name, args, and optional tool call ID.
- `tool.result`: tool name, optional args, result, optional tool call ID, and optional duration.
- `warning`: warning text and code.
- `error`: runtime or app error text.

Transport:

- `mapRuntimeEvent()` serializes each event to JSON and uses the event type as the SSE event name.
- `streamRuntimeEvents()` emits all runtime events, then sends a final `done` SSE event with `{}`.
- Non-streaming requests collect the same events and derive the final aggregate response from `message.delta`, `message.done`, `warning`, and `error`.

CLI handling:

- The CLI parses SSE events, appends streamed assistant text, renders tool traces, collects human-input requests, and stops when it receives the final `done`.

Related pages: [[http-chat-endpoint]], [[runtime-orchestration]], [[cli-streaming-harness]].
