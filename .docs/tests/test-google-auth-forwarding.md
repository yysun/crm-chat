# Test Spec: Google Auth Forwarding

## Scenario: Google token wins for identity and CRM API

- Send `/chat` with both `Authorization: Bearer jwt-token` and `X-Google-Auth: Bearer google-token`.
- Expected: identity resolution uses `google-token`.
- Expected: `data_tool` outbound CRM API calls use `X-Google-Auth: Bearer google-token`.

## Scenario: JWT fallback remains available

- Send `/chat` with only `Authorization: Bearer jwt-token`.
- Expected: identity resolution and `data_tool` outbound CRM API calls continue to use `Authorization: Bearer jwt-token`.

## Scenario: Google auth replaces JWT when present

- Send `/chat` with `X-Google-Auth: Bearer google-token` and no `Authorization`.
- Expected: identity resolution uses `google-token` and `data_tool` outbound CRM API calls use `X-Google-Auth: Bearer google-token`.

## Scenario: malformed Google auth does not silently downgrade

- Send `/chat` with `Authorization: Bearer jwt-token` and malformed `X-Google-Auth`.
- Expected: the route rejects the request rather than ignoring the malformed preferred credential.

## Scenario: model-provided auth remains blocked

- Trigger `data_tool` with model/tool args containing `headers.Authorization` and `headers.X-Google-Auth`.
- Expected: outbound CRM API calls use the server-selected request token and trusted inbound header name, not either model/tool argument.
