---
title: "Project Wiki"
type: "index"
status: "active"
language: "default"
last_commit: "cfdd1f20d8650c2b762818301b3b6e8402a61e89"
updated_at: "2026-05-20"
---

# CRM Chat Wiki

CRM Chat is an Azure Functions wrapper around `llm-runtime` for answering CRM questions through one controlled API tool. The key product decision is the trust boundary: the server authenticates the caller and owns CRM API headers; the model only receives scoped tools and workspace instructions.

## Start Here

- [[chat-request-lifecycle]] explains the end-to-end `/chat` request path.
- [[trust-boundary]] explains why identity lookup happens server-side.
- [[http-chat-endpoint]] covers the Azure Functions HTTP surface.
- [[runtime-orchestration]] covers provider selection, prompt construction, built-in tool policy, and runtime events.
- [[data-tool]] covers the CRM API access tool and URL confinement.
- [[workspace-instructions]] covers `crm-ai-workspace/AGENTS.md` and the allowed CRM read routes.
- [[configuration-model]] covers server-vs-CLI configuration.
- [[cli-streaming-harness]] covers the local interactive CLI.
- [[runtime-events]] lists the app-level event contract.

## Source Scope

This ingest used git-tracked content at `HEAD`, excluding generated output, dependencies, local secrets, and wiki roots. Current uncommitted workspace changes were intentionally ignored according to the git-wiki rules.

Primary source areas:

- Azure Functions entry and handler: `src/index.ts`, `src/functions/chat.ts`
- Runtime layer: `src/runtime/*.ts`
- CRM API tool: `src/tools/dataTool.ts`
- Identity and config: `src/auth/resolveUserId.ts`, `src/config/env.ts`
- Workspace policy: `crm-ai-workspace/AGENTS.md`
- CLI harness: `cli/*.ts`, `cli/.env.example`
- Local runtime config: `host.json`, `local.settings.example.json`, `package.json`, `tsconfig.json`
