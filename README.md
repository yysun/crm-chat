# CRM Chat

Azure Functions adapter for a CRM-aware chat runtime. It exposes a `/chat` endpoint with an OpenAI-style request shape, loads workspace instructions from `workspace/server-agents.md`, and gives the model one host-owned API tool for CRM data access.

The important boundary: the model does not get filesystem, shell, or web-fetch access. CRM reads go through `data_tool`, which only permits configured GET routes under `API_BASE_URL` with server-controlled auth and security headers.

## What It Does

- Serves `POST /chat` from Azure Functions.
- Accepts OpenAI-style chat completion requests.
- Supports streamed Server-Sent Events and aggregate JSON responses.
- Resolves the caller from a bearer token through the configured CRM identity endpoint.
- Appends `workspace/server-agents.md` to the runtime system prompt.
- Exposes `data_tool` for allowlisted CRM read routes under `API_BASE_URL`.
- Redacts known secret values from emitted tool events.

## Requirements

- Node.js `>=22 <23`
- Azure Functions Core Tools
- A configured LLM provider key
- Server CRM API configuration in `local.settings.json` or environment variables
- CLI-only credentials in `cli/.env`

Install dependencies:

```sh
npm install
```

## Configuration

The Azure Functions host reads server settings from `local.settings.json`. Start from `local.settings.example.json` and fill in real provider values. The CLI does not read that file; it loads `cli/.env` so local caller credentials stay separate from server configuration.

Required server settings for normal CRM chat:

| Variable | Purpose |
| --- | --- |
| `API_BASE_URL` | Base URL for CRM API calls. |
| `API_AUTH_URL` | Identity endpoint used to resolve the current user from the caller token; accepts an absolute URL or a path under `API_BASE_URL`. |
| `API_DATA_TOOL_ALLOWED_ROUTES` | Comma, semicolon, or newline separated GET route allowlist for `data_tool`, for example `GET /api/data/accounts/:id`. |
| `CRM_ALLOWED_ORIGINS` | Comma, semicolon, or newline separated browser origins allowed to call `/chat`. No wildcard is emitted. |
| `WORKSPACE_ROOT` | Workspace directory containing `server-agents.md`; for this repo use `workspace`. |

Configure at least one LLM provider:

| Provider | Variables |
| --- | --- |
| OpenAI | `OPENAI_API_KEY` |
| Azure OpenAI | `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_RESOURCE_NAME`, `AZURE_OPENAI_DEPLOYMENT_NAME`, optional `AZURE_OPENAI_API_VERSION` |
| Anthropic | `ANTHROPIC_API_KEY` |
| Google | `GOOGLE_API_KEY` |
| OpenAI-compatible | `OPENAI_COMPATIBLE_API_KEY`, `OPENAI_COMPATIBLE_BASE_URL` |

Optional runtime defaults:

| Variable | Default | Purpose |
| --- | --- | --- |
| `LLM_PROVIDER` | first configured provider | Provider selection. |
| `LLM_MODEL` | provider fallback | Default model. |
| `LLM_MAXTOKEN` | unset | Max response tokens. |
| `LLM_TEMPERATURE` | unset | Sampling temperature. |
| `LLM_REASONING` | `medium` | Reasoning effort: `default`, `none`, `low`, `medium`, `high`. |
| `LLM_PERMISSION` | `auto` | Tool permission mode: `auto`, `ask`, `read`. |
| `LLM_MAX_ITERATIONS` | `24` | Max runtime iterations. |
| `LLM_MAX_CONSECUTIVE_TOOL_TURNS` | `24` | Max consecutive tool turns. |
| `LLM_MAX_WALL_TIME_MS` | `900000` | Max request wall time. |

Optional CRM API tool headers:

| Variable | Purpose |
| --- | --- |
| `API_AUTH_SCHEME` | Auth scheme for the caller token injected into CRM API calls; defaults to `Bearer`. |
| `API_SECURITY_CONTEXT` | Security context header value added to CRM API calls. |
| `API_SECURITY_CONTEXT_HEADER` | Header name for `API_SECURITY_CONTEXT`; defaults to `X-Security-Context`. |

CLI-only settings:

| Variable | Purpose |
| --- | --- |
| `CHAT_BASE_URL` | Chat server URL, for example `http://localhost:7072`. |
| `API_PAT` | Caller token sent by the CLI as `Authorization: Bearer <token>`. |
| `CHAT_BEARER_TOKEN` | Alias for `API_PAT`; useful when the token does not come from the CRM API. |

## Run Locally

Build once:

```sh
npm run build
```

Start the function host on port `7072` with a TypeScript watcher:

```sh
npm run dev
```

Start from the compiled `dist` output:

```sh
npm start
```

Open the streaming test CLI:

```sh
npm run cli
```

Create `cli/.env` from `cli/.env.example` first:

```dotenv
CHAT_BASE_URL=http://localhost:7072
API_PAT=replace-with-caller-token
```

The CLI only reads `cli/.env` by default. To use another file:

```sh
CRM_CHAT_CLI_ENV_FILE=path/to/.env npm run cli
```

Useful CLI flags:

```sh
npm run cli -- --verbose
npm run cli -- --debug
npm run cli -- --auto-continue
npm run cli -- --chat-base-url http://localhost:7072
npm run cli -- --api-pat "$API_PAT"
```

## HTTP Contract

Endpoint:

```txt
POST http://localhost:7072/chat
Authorization: Bearer <token>
X-Google-Auth: Bearer <google-token>  # optional CRM API forwarding token
Content-Type: application/json
```

Request:

```json
{
  "stream": true,
  "messages": [
    {
      "role": "user",
      "content": "Show me recent notes for Alex"
    }
  ]
}
```

When `X-Google-Auth` is present on the `/chat` request, that Google bearer token is used for user identity resolution and re-injected to the CRM API as outbound `X-Google-Auth` through `data_tool`. When it is absent, the JWT from `Authorization` is used and forwarded as outbound `Authorization` as before. One of these bearer headers is required. Model-supplied tool headers cannot set `Authorization` or `X-Google-Auth`.

Provider, model, temperature, max-token, and tool selection are server policy. Configure them in the server environment, not from the CLI or browser. Client-supplied `system` and `tool` messages are rejected; client-supplied `tools` and `tool_choice` are ignored.

## Response Modes

With `"stream": true`, the function returns Server-Sent Events:

- `message.delta`
- `message.done`
- `tool.call`
- `tool.result`
- `warning`
- `error`
- `done`

Without streaming, the function returns a JSON `chat.completion` object with the final assistant message and `runtime_events`.

## Workspace Instructions

Runtime behavior depends on [workspace/server-agents.md](./workspace/server-agents.md). That file is the contract for CRM API use:

- Use `data_tool` for CRM data.
- Keep calls relative to `API_BASE_URL`.
- Let the host own authorization.
- Use configured GET read routes only.
- Do not invent data when API responses fail or do not match expectations.

The function caches the loaded `server-agents.md` content per workspace root.

## Development Notes

- Source lives under `src/`; compiled output goes to `dist/`.
- `host.json` sets `routePrefix` to an empty string, so the local route is `/chat`, not `/api/chat`.
- `data_tool` can cache successful allowlisted GET responses in process memory when the model supplies `cacheTtlMs`.
- Built-in runtime tools for shell, filesystem, web fetch, and skill loading are disabled in `src/runtime/runtimeConfig.ts`.
- `local.settings.json` and `cli/.env` are intentionally gitignored; commit only `local.settings.example.json` and `cli/.env.example`.
