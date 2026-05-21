# Requirement: RLP CRM Data Tool Script

## Problem

`crm-ai-workspace/AGENTS.md` defines the CRM workspace contract, but the emerging `rlp-crm` skill is empty. That leaves the skill unable to carry the data access rules on its own, and it leaves agents to hand-build `data_tool` payloads for allowed CRM routes.

The old way is a root `AGENTS.md` contract plus manual JSON. The new way is a triggerable CRM skill with a deterministic helper for building valid read-only `data_tool` calls.

## Requirements

- Create a JavaScript helper under `crm-ai-workspace/.agents/skills/rlp-crm/scripts/` for CRM `data_tool` payload creation.
- The helper must cover the read-only routes documented in `crm-ai-workspace/AGENTS.md`.
- The helper must validate operation names and required route inputs before emitting JSON.
- The helper must emit only `GET` payloads compatible with the existing `data_tool` schema.
- The helper must not own authorization, secrets, host security headers, or external API calls.
- Create `crm-ai-workspace/.agents/skills/rlp-crm/SKILL.md` from the CRM workspace rules in `crm-ai-workspace/AGENTS.md`.
- `SKILL.md` must instruct agents when and how to use the helper script before calling `data_tool`.
- Preserve the CRM operating judgment from `AGENTS.md`: search before ID-specific detail calls, default action requests to today, use actions for status/triage, and cite supporting routes and record IDs.

## Acceptance

- `node crm-ai-workspace/.agents/skills/rlp-crm/scripts/data-tool.js list` shows the supported CRM operations.
- The script can emit valid JSON for representative allowed routes.
- Invalid operation names or missing required inputs fail before a `data_tool` call is attempted.
- `SKILL.md` is non-empty, has skill frontmatter, references the helper script, and includes the data access rules needed to answer CRM questions.
- Build and tests for the repo still pass.
