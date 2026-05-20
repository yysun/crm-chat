# Requirement: Google Auth Forwarding

## Problem

Some CRM calls need the browser-provided Google bearer token, and that token should be enough to confirm the user through the configured identity endpoint. The chat route previously had one auth path: it read `Authorization: Bearer ...`, resolved the user with that token, and forwarded that same token into `data_tool` as CRM API auth. Clients that can provide `X-Google-Auth` should not also need a JWT.

## Acceptance Criteria

- When a request includes `X-Google-Auth: Bearer <token>`, the chat server uses that token for identity resolution against `API_AUTH_URL`.
- When a request includes `X-Google-Auth: Bearer <token>`, the chat server re-injects that token as outbound `X-Google-Auth` for CRM API calls.
- The selected auth token and trusted inbound header name are passed into runtime so `data_tool` injects them into outbound CRM API calls.
- `X-Google-Auth` must use the same strict bearer format as `Authorization`.
- If `X-Google-Auth` is missing, existing `Authorization: Bearer <jwt>` identity and outbound `Authorization` forwarding behavior continues.
- If both headers are present, `X-Google-Auth` wins for both identity resolution and CRM API calls.
- If neither auth header is present, `/chat` rejects the request.
- Model/tool arguments still cannot set or override `Authorization` or `X-Google-Auth`.

## Non-Goals

- This does not add another auth header that the model can set.
- This does not weaken chat request validation or route allowlisting.
