# CRM AI Workspace

This workspace is for answering CRM questions against the live CRM API. The source of truth is the API exposed through `data_tool`; this file documents the allowed read route contract and operating rules.

## Default Rule

Use `data_tool` for CRM data. Do not use `web_fetch` for `/api/data/...` routes. `data_tool` calls paths relative to `API_BASE_URL` and the host injects authorization and security headers.

## `data_tool` Call Schema

Always call `data_tool` with a single JSON object matching this schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["method", "path"],
  "properties": {
    "method": {
      "type": "string",
      "enum": ["GET"]
    },
    "path": {
      "type": "string",
      "description": "Relative API path under API_BASE_URL. It may start with /api/data/..."
    },
    "query": {
      "type": "object",
      "description": "Optional query string values. Values may be string, number, boolean, null, or arrays of those."
    },
    "headers": {
      "type": "object",
      "description": "Optional string headers. Do not set Authorization; the host owns auth."
    },
    "cacheTtlMs": {
      "type": "number",
      "description": "Optional positive TTL in milliseconds. Only applies to GET."
    },
    "bypassCache": {
      "type": "boolean",
      "description": "Optional GET-only flag to force a fresh call while refreshing the cache."
    }
  }
}
```

Valid GET with query:

```json
{
  "method": "GET",
  "path": "/api/data/contacts/searchAll",
  "query": { "q": "alex" },
  "cacheTtlMs": 10000
}
```

Valid path parameter substitution:

```json
{
  "method": "GET",
  "path": "/api/data/accounts/123"
}
```

For route parameters, substitute the value into the path: `/api/data/accounts/123`, not `/api/data/accounts/:id`.

Use `query` for GET filters. Do not call create, update, patch, attach, mark, or delete routes from this workspace.

## Response Handling

`data_tool` returns:

- `ok`, `status`, `statusText`, `url`, `headers`
- `body`, parsed from JSON when possible
- `cached` when `cacheTtlMs` was used

If `ok` is false, report the failed status and do not invent missing data. If the response body shape is unexpected, say what came back and adjust the next call.

## Allowed API Routes

Only use these read routes. `path` parameters are substituted into `path`. Query parameters go in `query`.

### Identity / Users

- `GET /api/data/who`
  - Use this to get the current user and the user's teams.

### Accounts

- `GET /api/data/accounts/:id` *(path: `id`)*
- `GET /api/data/accounts/:id/contacts` *(path: `id`)*
- `GET /api/data/accounts/:id/notes` *(path: `id`)*
  - For account notes by name, search first to get the account ID, then call this route.

### Actions (activity feed)

- `GET /api/data/actions?date=...`
  - When the user asks for actions without a date, default `date` to today.
  - When the user asks for actions for an account, company, or contact, call actions with the date filter only and search within the returned action text for the named account/contact.
  - When the user asks to review status, triage, find out what is going on, plan next moves, or similar, answer from today's actions. This applies to overall requests and specific account/contact requests.

### Contacts

- `GET /api/data/contacts/searchAll?q=...`
  - Use this to search both contacts and accounts. If the user searches a name but does not specify account or contact, use this route first.
- `GET /api/data/contacts/:id` *(path: `id`)*
- `GET /api/data/contacts/:id/notes` *(path: `id`)*
  - For contact notes by name, search first to get the contact ID, then call this route.

## Operating Judgment

Use `GET /api/data/contacts/searchAll?q=...` for ambiguous name searches because it searches both contacts and accounts. For account or company questions, use the account ID if provided; otherwise search by name first, then load the detail route for the matched record. For notes questions by name, search first to identify the account ID or contact ID, then call the matching notes route. For status, triage, "what's going on", next-move planning, and action questions, default to today's actions unless the user gives a different date; for account/contact versions of those questions, fetch by date only and match the account/contact inside the action text. Load detail routes before making claims about a single record. For summaries, cite which record IDs and routes supported the conclusion.

Do not expose secrets, authorization headers, or security context values.
