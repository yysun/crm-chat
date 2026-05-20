# Plan: Google Auth Forwarding

## Scope

Add a second request-auth path in `/chat`: `X-Google-Auth` becomes the preferred credential for identity resolution and CRM API forwarding. If it is absent, preserve the current `Authorization` JWT behavior.

## Tasks

- [x] Inspect relevant files
- [x] Make focused changes
- [x] Run validation
- [x] Update docs/status

## Status

- AR fixed: clarified that Google auth is a replacement path when present, not just a downstream forwarding override; rerun result passed.
- SS complete: `/chat` now prefers `X-Google-Auth` for identity and runtime/data_tool API forwarding, with JWT fallback.
- CR passed: no blocking security or maintainability issues in the changed auth flow.
- TT passed with `npm test`.
- ET covered by focused scenarios in `tests/googleAuthForwarding.test.ts`.
- VR passed: JWT fallback, Google identity/forwarding, malformed auth rejection, CORS preflight, and tool-arg auth blocking are covered.

## Implementation Notes

- In `src/functions/chat.ts`, parse `X-Google-Auth` first and use it as the selected auth token when present.
- Use the selected token for identity resolution and runtime `accessToken`.
- Carry the trusted inbound header name into the runtime tool env so `data_tool` re-injects `X-Google-Auth` when that was the inbound source.
- Fall back to `authorization` only when Google auth is absent.
- Update the missing-auth error to mention either accepted bearer header.
- Include `X-Google-Auth` in CORS preflight allowed headers.
- Add focused tests proving precedence, fallback, malformed Google header behavior, and downstream `data_tool` auth injection.

## Flow

```mermaid
flowchart LR
  Request[/chat request] --> Select{X-Google-Auth present?}
  Select -->|yes| Google[Selected token = Google bearer]
  Select -->|no| Jwt[Selected token = Authorization bearer]
  Google --> Identity[API_AUTH_URL]
  Jwt --> Identity
  Identity --> Runtime[Runtime accessToken/header = selected token/header]
  Runtime --> DataTool[data_tool trusted auth header]
```

## E2E Coverage Decision

Required. This story changes auth header precedence and cross-system CRM API credential forwarding. The scenarios live in `.docs/tests/test-google-auth-forwarding.md`.
