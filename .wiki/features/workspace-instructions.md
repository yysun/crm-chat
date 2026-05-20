---
title: "Workspace Instructions"
type: "feature"
status: "active"
language: "default"
source_paths:
  - "crm-ai-workspace/AGENTS.md"
  - "src/workspace/loadAgentsMd.ts"
  - "src/workspace/resolveWorkspace.ts"
  - "src/runtime/runtimeConfig.ts"
updated_at: "2026-05-20"
---

# Workspace Instructions

`crm-ai-workspace/AGENTS.md` is the domain contract loaded into the runtime prompt. It tells the model how CRM data must be retrieved and interpreted.

Facts from source:

- `resolveWorkspaceRoot()` normalizes the configured workspace root.
- `loadAgentsMdCache()` reads `AGENTS.md` under that root and tolerates missing files.
- `composeSystemPrompt()` appends loaded workspace instructions under "Additional workspace instructions".

CRM rules in `AGENTS.md`:

- Use `data_tool` for CRM data.
- Do not use `web_fetch` for `/api/data/...` routes.
- Do not set `Authorization`; the host owns auth.
- Use query parameters for GET filters.
- Do not call create, update, patch, attach, mark, or delete routes from this workspace.
- If an API response fails or has an unexpected shape, report that instead of inventing data.

Allowed read areas:

- Current user and teams through `/api/data/who`.
- Account detail, contacts, and notes by account ID.
- Actions by date.
- Contact/account search through `contacts/searchAll`.
- Contact detail and notes by contact ID.

Related pages: [[runtime-orchestration]], [[data-tool]].
