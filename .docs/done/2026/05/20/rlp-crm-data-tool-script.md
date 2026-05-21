# RLP CRM Data Tool Script

## Summary

- Added `crm-ai-workspace/.agents/skills/rlp-crm/scripts/data-tool.js` to emit validated read-only CRM `data_tool` payloads.
- Converted the empty `rlp-crm` skill into a usable CRM data access contract based on `crm-ai-workspace/AGENTS.md`.
- Preserved the core CRM operating rules: use `data_tool`, search before detail calls, default actions to today, keep auth host-owned, and cite route/record evidence.
- Kept the helper deterministic: it builds JSON only and never calls the CRM API.

## Verification

- `node --check crm-ai-workspace/.agents/skills/rlp-crm/scripts/data-tool.js`
- `node crm-ai-workspace/.agents/skills/rlp-crm/scripts/data-tool.js list`
- Representative helper commands for `search`, `who`, `account-contacts`, `contact`, `contact-notes`, `account-notes`, and `actions`
- Negative helper checks for unknown operations, unknown options, and blocked `Authorization` headers
- `npm run build`
- `npm test`
- AR, CR, and VR completed with no blocking findings

## Notes

- No live CRM API calls were made; the host-owned `data_tool` remains responsible for auth, route enforcement, and API execution.
- No E2E spec was added because this is a skill/script packaging change rather than a browser or live integration flow.
