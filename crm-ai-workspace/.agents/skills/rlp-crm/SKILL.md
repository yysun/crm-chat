---
name: rlp-crm
description: >-
  Answer CRM questions against the live CRM API through scripts/data-tool.js.
  Use for CRM account, contact, note, action, status, triage, and next-move
  planning questions in the RLP CRM workspace.
---

# RLP CRM

This skill answers CRM questions against the live CRM API. The source of truth
is `scripts/data-tool.js`; do not use web browsing, `web_fetch`, `curl`, or
hand-built `/api/data/...` calls.

The script owns the CRM read boundary. It builds only supported read operations,
loads its own configuration, applies environment-owned auth headers, calls the
CRM API, and prints a JSON response. The agent must not search for, read, print,
or infer `.env`, `API_BASE_URL`, `API_PAT`, bearer tokens, authorization
headers, or security context values.

## Required Helper

Use the bundled helper for every CRM data read:

```bash
node scripts/data-tool.js list
node scripts/data-tool.js search --q "alex"
node scripts/data-tool.js account --id 123
node scripts/data-tool.js actions --date 2026-05-20
```

If running from the workspace root instead of this skill directory, use:

```bash
node .agents/skills/rlp-crm/scripts/data-tool.js search --q "alex"
```

The helper reads `API_BASE_URL` and `API_PAT` itself from the project-root
environment. Do not inspect or pass those values. If configuration is missing,
report the helper error and stop.

For debugging, `payload` prints the validated request without calling the API:

```bash
node scripts/data-tool.js payload search --q "alex"
```

If the helper rejects a request, fix the operation or inputs. Do not bypass the
helper for routes it supports.

## Response Handling

The helper returns a single JSON object:

- `ok`, `status`, `statusText`, `url`, `headers`
- `body`, parsed from JSON when possible

If `ok` is false, report the failed status and do not invent missing data. If
the response body shape is unexpected, say what came back and adjust the next
call.

## Supported Operations

- `who`: calls `GET /api/data/who`.
- `search --q <text>`: calls `GET /api/data/contacts/searchAll?q=...`.
- `account --id <id>`: calls `GET /api/data/accounts/:id`.
- `account-contacts --id <id>`: calls `GET /api/data/accounts/:id/contacts`.
- `account-notes --id <id>`: calls `GET /api/data/accounts/:id/notes`.
- `actions [--date YYYY-MM-DD]`: calls `GET /api/data/actions?date=...`; date
  defaults to today when omitted.
- `contact --id <id>`: calls `GET /api/data/contacts/:id`.
- `contact-notes --id <id>`: calls `GET /api/data/contacts/:id/notes`.

The helper also accepts repeatable non-auth `--header Name=Value` options where
the API supports them.

## Operating Judgment

Use `search --q <text>` for ambiguous name searches because it searches both
contacts and accounts.

For account or company questions, use the account ID if provided. Otherwise
search by name first, choose the matching account, then load the account detail
route.

For contact questions, use the contact ID if provided. Otherwise search by name
first, choose the matching contact, then load the contact detail route.

For notes questions by name, search first to identify the account ID or contact
ID, then call the matching notes route.

For status, triage, "what's going on", next-move planning, and action
questions, default to today's actions unless the user gives a different date.
For account/contact versions of those questions, fetch by date only and match
the account/contact inside the action text.

Load detail routes before making claims about a single record. For summaries,
cite which record IDs and routes supported the conclusion.

Do not claim data exists unless it came from `scripts/data-tool.js`.
