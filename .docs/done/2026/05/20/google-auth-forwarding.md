# Done: Google Auth Forwarding

## Summary

- Added `X-Google-Auth: Bearer <token>` parsing on `/chat`.
- Preferred the Google token for chat identity, `API_AUTH_URL` resolution, and runtime/data_tool forwarding when present.
- Re-injected trusted inbound Google auth as outbound `X-Google-Auth` instead of rewriting it to `Authorization`.
- Preserved `Authorization: Bearer <jwt>` as the fallback when Google auth is absent.
- Added `X-Google-Auth` to CORS preflight allowed headers.
- Documented the distinction between chat identity and CRM API forwarding.

## Verification

- `npm run build`
- `npm test`
- `git diff --check`
- CR pass after correcting the requirement so Google auth is the preferred auth path when present.

## Notes

- Malformed `X-Google-Auth` is rejected instead of silently falling back to JWT.
- Malformed `Authorization` is rejected when Google auth is absent.
- Model/tool-supplied `Authorization` and `X-Google-Auth` headers remain blocked by `data_tool`.
