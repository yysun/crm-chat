---
title: "Trust Boundary"
type: "concept"
status: "active"
language: "default"
source_paths:
  - "src/functions/chat.ts"
  - "src/auth/resolveUserId.ts"
  - "src/runtime/runChatCompletion.ts"
  - "src/tools/dataTool.ts"
updated_at: "2026-05-20"
---

# Trust Boundary

CRM Chat treats identity as server infrastructure, not model behavior. The model can use CRM data, but it does not decide who the caller is and does not own the authorization header.

Facts from source:

- `chat()` extracts a bearer token from the HTTP request.
- Missing bearer tokens are rejected with `401`.
- `resolveUserId()` calls the configured identity endpoint with that same bearer token.
- Identity lookup accepts `{ id }`, `{ userId }`, or the first array element with either field.
- The resolved `userId` is logged and passed into runtime input.
- The caller token is copied into a per-request environment as `API_ACCESS_TOKEN`.
- `data_tool` applies `Authorization: <scheme> <API_ACCESS_TOKEN>` after reading model-provided headers, so host-owned auth wins.

Inference:

This design prevents prompt injection from changing identity. A user can ask the assistant to behave as someone else, but the CRM API calls still carry the original caller token supplied to `/chat`.

Related pages: [[chat-request-lifecycle]], [[configuration-model]], [[data-tool]].
