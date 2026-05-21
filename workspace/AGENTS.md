# CRM AI Workspace

This workspace is for local CRM analysis through Codex.

Use the `rlp-crm` skill for CRM account, contact, note, action, status, triage, and next-move questions.

Rules:

- Use `.agents/skills/rlp-crm/SKILL.md` for CRM data access.
- Use `.agents/skills/rlp-crm/scripts/data-tool.js` for CRM reads.
- Do not inspect, print, or expose `.env`, API tokens, bearer tokens, auth headers, or security context values.
- Do not use web browsing, curl, or hand-built CRM API calls.
- Do not create, update, patch, delete, attach, mark, or mutate CRM records.
- Save generated user-facing outputs under `outputs/`.