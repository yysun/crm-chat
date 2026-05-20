# Requirement: Chat Data Tool Hardening

## Problem

The chat service currently exposes too much request control to clients and too much API control to model-selected tool arguments. That turns a CRM read assistant into a route and runtime policy bypass: clients can try to inject privileged message roles, steer model/provider policy, and ask the tool layer to reach mutation routes.

## Acceptance Criteria

- `data_tool` is GET-only at code level; mutation HTTP methods are not accepted by schema or execution.
- `data_tool` can call only CRM read routes explicitly allowed by local settings.
- Client-supplied `system` messages are rejected before reaching runtime prompt assembly.
- Client-supplied `tool` messages are rejected before reaching runtime prompt assembly.
- Client-supplied `tools` and `tool_choice` fields are ignored and never forwarded into runtime execution.
- Client model/provider overrides are disabled for normal chat callers.
- Client `temperature` and `max_tokens` overrides are ignored; server settings own these values.
- CORS responses use a CRM origin allowlist rather than wildcard `*`.
- Raw CRM API mutation routes are unreachable from chat through `data_tool`.
- `Authorization` headers from model/tool arguments are never accepted; caller auth remains host-owned.

## Non-Goals

- This does not add write support to the CRM assistant.
- This does not change the identity lookup contract for `/api/data/who`.
- This does not redesign workspace instructions; the runtime boundary must be enforced in code.
