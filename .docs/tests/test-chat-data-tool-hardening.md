# Test Spec: Chat Data Tool Hardening

## Scenario: privileged client messages are rejected

- Send `/chat` a request containing a `system` message.
- Expected: the route returns `400` and does not call runtime.
- Send `/chat` a request containing a `tool` message.
- Expected: the route returns `400` and does not call runtime.

## Scenario: client runtime overrides do not control server policy

- Send `/chat` with `model`, `metadata.provider`, `temperature`, `max_tokens`, `tools`, and `tool_choice`.
- Expected: runtime receives server-owned provider/model, temperature, max-token, and tool configuration only.

## Scenario: CORS is CRM-origin allowlisted

- Send preflight and JSON requests from an allowed CRM origin.
- Expected: CORS response includes that origin.
- Send the same requests from an unlisted origin.
- Expected: CORS response does not use wildcard origin and does not echo the unlisted origin.

## Scenario: data_tool can only read allowlisted CRM routes

- Configure `API_DATA_TOOL_ALLOWED_ROUTES` with known CRM read routes.
- Call `data_tool` with `GET` for an allowed read route.
- Expected: the CRM API receives a `GET`.
- Call `data_tool` with `POST`, `PUT`, `PATCH`, or `DELETE`.
- Expected: execution rejects before fetch.
- Call `data_tool` with `GET` for an unlisted route.
- Expected: execution rejects before fetch.

## Scenario: tool-supplied auth is ignored

- Call `data_tool` with `headers.Authorization` and a valid caller token in host context.
- Expected: CRM API receives only the host-owned authorization value, never the model/tool argument value.
