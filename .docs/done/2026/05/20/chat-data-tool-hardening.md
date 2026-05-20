# Done: Chat Data Tool Hardening

## Summary

- Hardened `/chat` so normal clients can send only `user` and `assistant` role content.
- Rejected client `system` and `tool` messages before runtime assembly.
- Ignored client model/provider, temperature, max-token, `tools`, and `tool_choice` controls.
- Made `data_tool` GET-only and limited it to routes listed in `API_DATA_TOOL_ALLOWED_ROUTES`.
- Replaced wildcard CORS responses with `CRM_ALLOWED_ORIGINS`.
- Ignored tool-supplied auth headers so CRM authorization stays host-owned.

## Verification

- `npm run build`
- `npm test`
- CR pass after diff review and follow-up tightening.
- ET scenarios covered by `tests/chatDataToolHardening.test.ts`.

## Notes

- `local.settings.json` was updated locally with the same allowlist values as `local.settings.example.json`.
- No CRM write-route support was added.
