# Plan: Chat Data Tool Hardening

## Scope

Enforce the CRM chat boundary in server code: client requests provide user messages and stream preference only; server config owns runtime policy; `data_tool` owns CRM read access through a configured allowlist and host-injected auth.

## Tasks

- [x] Inspect relevant files
- [x] Make focused changes
- [x] Run validation
- [x] Update docs/status

## Status

- AR passed: no blocking architecture flaws.
- SS complete: chat parsing, runtime policy, data tool method/path/header enforcement, CORS, config, docs, and tests are updated.
- CR passed after tightening allowlist parsing and stripping client assistant tool-call fields from accepted history.
- TT passed with `npm test`.
- ET covered by focused security scenarios in `tests/chatDataToolHardening.test.ts`.
- VR passed: every acceptance criterion is enforced in code and covered by build/tests or documented configuration.

## Implementation Notes

- In `src/functions/chat.ts`, validate the request as a normal-user chat request:
  - accept `user` and `assistant` messages only;
  - reject `system` and `tool` messages with `400`;
  - omit client `model`, `metadata.provider`, `temperature`, `max_tokens`, `tools`, and `tool_choice` from runtime input;
  - return CORS headers only when `Origin` matches a configured CRM origin allowlist.
- In `src/config/env.ts`, parse a server-owned CRM origin allowlist and a data-tool route allowlist from local settings.
- In `src/tools/dataTool.ts`, make `data_tool` GET-only at schema and parser level, enforce the route allowlist after URL resolution, and drop caller-supplied sensitive headers before host auth is applied.
- In `src/runtime/runtimeConfig.ts` and runtime types, remove normal request control over provider/model, temperature, and max tokens.
- Add focused tests around request validation, runtime defaults, CORS, GET-only tool execution, allowlisted routes, and rejected authorization header args.

## Flow

```mermaid
flowchart LR
  Client[CRM client] --> Chat[/chat]
  Chat --> Validate[request validation]
  Validate --> Runtime[server-owned runtime config]
  Runtime --> Tool[data_tool GET only]
  Tool --> Allowlist[local route allowlist]
  Allowlist --> CRM[CRM API read routes]
```

## E2E Coverage Decision

Required. This story changes auth, CORS, routing, and cross-system CRM API access boundaries. The scenarios live in `.docs/tests/test-chat-data-tool-hardening.md`.
