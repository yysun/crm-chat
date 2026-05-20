# CRM AI Workspace

This workspace is for answering CRM questions and performing explicitly requested CRM actions against the live CRM API. The source of truth is the API exposed through `data_tool`; this file documents the allowed route contract and operating rules.

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
      "enum": ["GET", "POST", "PUT", "PATCH", "DELETE"]
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
    "body": {
      "description": "Optional JSON-serializable request payload or raw string. GET calls must not include body."
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
  "path": "/api/data/accounts/search",
  "query": { "q": "acme" },
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

Valid write with a JSON-string field:

```json
{
  "method": "PATCH",
  "path": "/api/data/accounts/123",
  "body": {
    "name": "Acme Corp",
    "data": "{\"website\":\"https://example.com\",\"status\":\"active\"}"
  }
}
```

For route parameters, substitute the value into the path: `/api/data/accounts/123`, not `/api/data/accounts/:id`.

Use `query` for GET filters. Use `body` for POST, PUT, PATCH, and DELETE payloads. When a field is documented as JSON string (`data`, `config`, `messages`, `teamIds`, `objectIds`), pass a serialized JSON string, not an object.

Prefer read routes first. Use write routes only when the user clearly asks to create, update, delete, attach, or mark something. Deletions, team membership changes, schema changes, and chat-history edits are high-impact writes; confirm intent if the request is ambiguous.

## Response Handling

`data_tool` returns:

- `ok`, `status`, `statusText`, `url`, `headers`
- `body`, parsed from JSON when possible
- `cached` when `cacheTtlMs` was used

If `ok` is false, report the failed status and do not invent missing data. If the response body shape is unexpected, say what came back and adjust the next call.

## API Route Schemas

The schemas below are copied from the route Zod definitions. `path params` are substituted into `path`. `schema fields` that are not path params go in `query` for `GET` and in `body` for non-GET calls.

### Identity And Users

- `GET /api/data/who` - path params: none; schema fields: none.
- `GET /api/data/users` - path params: none; schema fields: none.
- `POST /api/data/users/:userId/contacts` - path params: `userId`; schema fields: `{ id: number.int.default(-1) }`.
- `DELETE /api/data/users/:userId/contacts/:id` - path params: `userId`, `id`; schema fields: `{ userId: number.int, id: number.int }`.
- `POST /api/data/users/:userId/accounts` - path params: `userId`; schema fields: `{ id: number.int }`.
- `DELETE /api/data/users/:userId/accounts/:id` - path params: `userId`, `id`; schema fields: `{ userId: number.int, id: number.int }`.

### Accounts

- `GET /api/data/accounts/search` - path params: none; schema fields: `{ q: string }`.
- `GET /api/data/accounts/count` - path params: none; schema fields: none.
- `GET /api/data/accounts` - path params: none; schema fields: none.
- `GET /api/data/accounts/:id` - path params: `id`; schema fields: `{ id: number.int }`.
- `POST /api/data/accounts` - path params: none; schema fields: `{ name: string, data: string, teamId: number }`.
- `PATCH /api/data/accounts/:id` - path params: `id`; schema fields: `{ id: number.int, name: string, data: string.optional }`.
- `DELETE /api/data/accounts/:id` - path params: `id`; schema fields: `{ id: number.int }`.
- `GET /api/data/users/:userId/accounts` - path params: `userId`; schema fields: `{ userId: number.int }`.
- `GET /api/data/team/:teamId/accounts` - path params: `teamId`; schema fields: `{ teamId: number.int }`. `teamId = -1` means legacy RLP accounts.
- `GET /api/data/accounts/:id/contacts` - path params: `id`; schema fields: `{ id: number.int, initialContactId: number.optional.nullable.default(null) }`.
- `GET /api/data/accounts/:id/notes` - path params: `id`; schema fields: `{ id: number.int }`.

### Contacts

- `GET /api/data/contacts` - path params: none; schema fields: none.
- `GET /api/data/contacts/searchAll` - path params: none; schema fields: `{ q: string }`.
- `GET /api/data/contacts/search` - path params: none; schema fields: `{ q: string }`.
- `GET /api/data/contacts/count` - path params: none; schema fields: none.
- `GET /api/data/contacts/:id` - path params: `id`; schema fields: `{ id: number.int }`.
- `PUT /api/data/contacts` - path params: none; schema fields: `{ personId: number.int }`.
- `POST /api/data/contacts` - path params: none; schema fields: `{ name: string, data: string, accountId: number }`.
- `PATCH /api/data/contacts/:id` - path params: `id`; schema fields: `{ id: number.int, data: string.optional }`.
- `DELETE /api/data/contacts/:id` - path params: `id`; schema fields: `{ id: number.int }`.
- `GET /api/data/users/:userId/contacts` - path params: `userId`; schema fields: `{ userId: number.int }`.
- `GET /api/data/team/:teamId/contacts` - path params: `teamId`; schema fields: `{ teamId: number.int }`. `teamId = -1` means legacy RLP contacts.
- `GET /api/data/contacts/:id/notes` - path params: `id`; schema fields: `{ id: number.int }`.

### Notes

- `GET /api/data/notes/count` - path params: none; schema fields: none.
- `GET /api/data/users/me/notes` - path params: none; schema fields: none.
- `POST /api/data/notes` - path params: none; schema fields: `{ title: string, content: string, type: string.nullable, teamIds: string.nullable, objectIds: string.nullable, objectType: string, flags: number.int.default(0) }`.
- `PUT /api/data/notes/:id` - path params: `id`; schema fields: `{ id: number.int, title: string, content: string, type: string.nullable, teamIds: string.nullable, flags: number.int.default(0) }`.
- `PATCH /api/data/notes/:id` - path params: `id`; schema fields: `{ id: number.int, startDate: string.nullable, dueDate: string.nullable }`.
- `PATCH /api/data/notes/:id/status` - path params: `id`; schema fields: `{ id: number.int, status: number.int }`.
- `DELETE /api/data/notes/:id` - path params: `id`; schema fields: `{ id: number.int }`.

### Teams

- `GET /api/data/teams` - path params: none; schema fields: none.
- `GET /api/data/teams/users` - path params: none; schema fields: none.
- `DELETE /api/data/teams/:id` - path params: `id`; schema fields: `{ id: string }`.
- `POST /api/data/teams/:id/users` - path params: `id`; schema fields: `{ id: number, userId: number }`.
- `DELETE /api/data/teams/:id/users/:userId` - path params: `id`, `userId`; schema fields: `{ id: number, userId: number }`.

### Schema

- `GET /api/data/schema` - path params: none; schema fields: none.
- `PATCH /api/data/schema` - path params: none; schema fields: `{ name: string, schema: string }`.

### Kanban

- `GET /api/data/kanban` - path params: none; schema fields: none.
- `GET /api/data/kanban/:id` - path params: `id`; schema fields: `{ id: number.int }`.
- `GET /api/data/kanban/schema/:schemaId` - path params: `schemaId`; schema fields: `{ schemaId: number.int }`.
- `POST /api/data/kanban` - path params: none; schema fields: `{ schemaId: number.int, name: string.min(1).max(100), config: string }`.
- `PATCH /api/data/kanban/:id` - path params: `id`; schema fields: `{ id: number.int, name: string.min(1).max(100).optional, config: string.optional }`.
- `DELETE /api/data/kanban/:id` - path params: `id`; schema fields: `{ id: number.int }`.

### News

- `GET /api/data/news` - path params: none; schema fields: none.
- `POST /api/data/news` - path params: none; schema fields: `{ content: string, entityType: string, entityId: number.int, url: string, user: string }`.

### Prompts

- `GET /api/data/prompts` - path params: none; schema fields: `{ category: string.nullable.default(null), favoritesOnly: boolean.default(false), searchTerm: string.nullable.default(null) }`.
- `GET /api/data/prompts/:id` - path params: `id`; schema fields: `{ id: number.int }`.
- `POST /api/data/prompts` - path params: none; schema fields: `{ promptContent: string }`.
- `PUT /api/data/prompts/:id` - path params: `id`; schema fields: `{ id: number.int, title: string.optional, description: string.optional, promptContent: string.optional, category: string.optional, tags: string.optional, isFavorite: boolean.optional }`.
- `DELETE /api/data/prompts/:id` - path params: `id`; schema fields: `{ id: number.int }`.
- `POST /api/data/prompts/:id/use` - path params: `id`; schema fields: `{ id: number.int }`.

### Chat Sessions

Use chat-session routes only for chat UI state and history maintenance, not for ordinary CRM facts.

- `GET /api/data/chat/sessions` - path params: none; schema fields: none.
- `GET /api/data/chat/sessions/active` - path params: none; schema fields: none.
- `GET /api/data/chat/sessions/active/ensure` - path params: none; schema fields: none.
- `GET /api/data/chat/sessions/:id` - path params: `id`; schema fields: `{ id: number.int }`.
- `POST /api/data/chat/sessions` - path params: none; schema fields: `{ title: string.optional, isActive: boolean.default(true) }`.
- `PUT /api/data/chat/sessions/:id` - path params: `id`; schema fields: `{ id: number.int, title: string }`.
- `PATCH /api/data/chat/sessions/:id/active` - path params: `id`; schema fields: `{ id: number.int }`.
- `DELETE /api/data/chat/sessions/:id` - path params: `id`; schema fields: `{ id: number.int }`.
- `GET /api/data/chat/sessions/:chatSessionId/messages` - path params: `chatSessionId`; schema fields: `{ chatSessionId: number.int }`.
- `GET /api/data/chat/sessions/:chatSessionId/messages/llm` - path params: `chatSessionId`; schema fields: `{ chatSessionId: number.int }`.
- `POST /api/data/chat/sessions/:chatSessionId/messages/batch` - path params: `chatSessionId`; schema fields: `{ chatSessionId: number.int, messages: string }`.
- `DELETE /api/data/chat/sessions/:chatSessionId/messages` - path params: `chatSessionId`; schema fields: `{ chatSessionId: number.int }`.
- `DELETE /api/data/chat/sessions/:chatSessionId/messages/:messageId` - path params: `chatSessionId`, `messageId`; schema fields: `{ chatSessionId: number.int, messageId: number.int }`.
- `PATCH /api/data/chat/sessions/:chatSessionId/messages/:messageId` - path params: `chatSessionId`, `messageId`; schema fields: `{ chatSessionId: number.int, messageId: number.int, content: string }`.
- `PATCH /api/data/chat/sessions/:chatSessionId/messages/:messageId/clear-tool-calls` - path params: `chatSessionId`, `messageId`; schema fields: `{ chatSessionId: number.int, messageId: number.int }`.
- `DELETE /api/data/chat/sessions/:chatSessionId/messages/by-ids` - path params: `chatSessionId`; schema fields: `{ chatSessionId: number.int, messageIds: array<number.int> }`.

## Operating Judgment

Search before broad listing when the user names a person, account, or company. Load detail routes before making claims about a single record. For summaries, cite which record IDs and routes supported the conclusion.

Do not expose secrets, authorization headers, or security context values. Do not claim a write succeeded unless `data_tool` returned a successful status.
