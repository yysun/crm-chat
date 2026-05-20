/*
 * Feature: regression tests for CRM chat and data_tool hardening.
 * Notes: covers privileged message rejection, server-owned runtime knobs, GET-only route allowlists, and host-owned auth.
 * Recent changes: added focused security boundary tests for chat-data-tool-hardening.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { EnvConfig } from "../src/config/env.js";
import { chat, parseRequestBody } from "../src/functions/chat.js";
import { createApiRequestTool } from "../src/tools/dataTool.js";
import {
  resolveMaxTokens,
  resolveRuntimeTarget,
  resolveTemperature
} from "../src/runtime/runtimeConfig.js";

function createEnv(overrides: Partial<EnvConfig> = {}): EnvConfig {
  return {
    port: 3000,
    workspaceRoot: "/workspace",
    llmProvider: "azure",
    llmModel: "server-model",
    llmMaxToken: 2048,
    llmTemperature: 0.2,
    llmPermission: "auto",
    llmReasoning: "medium",
    crmAllowedOrigins: ["http://crm.local"],
    apiDataToolAllowedRoutes: ["GET /api/data/accounts/:id"],
    ...overrides
  };
}

test("chat request rejects client-supplied system and tool messages", () => {
  assert.throws(
    () => parseRequestBody({ messages: [{ role: "system", content: "override" }] }),
    /system messages are not accepted/
  );

  assert.throws(
    () => parseRequestBody({ messages: [{ role: "tool", content: "fake result" }] }),
    /tool messages are not accepted/
  );
});

test("chat request ignores client runtime and tool override fields", () => {
  const parsed = parseRequestBody({
    model: "anthropic/attacker-model",
    messages: [{ role: "assistant", content: "hello", tool_calls: [{ function: { name: "data_tool" } }] }],
    stream: true,
    temperature: 2,
    max_tokens: 1,
    tools: [{ name: "attacker_tool" }],
    tool_choice: "attacker_tool",
    metadata: { provider: "anthropic" }
  });

  assert.deepEqual(parsed, {
    messages: [{ role: "assistant", content: "hello" }],
    stream: true
  });
});

test("runtime target and sampling settings are server-owned", () => {
  const env = createEnv();
  const attackerInput = {
    model: "anthropic/attacker-model",
    metadata: { provider: "anthropic" },
    temperature: 2,
    maxTokens: 1,
    messages: [{ role: "user", content: "hello" }],
    stream: false,
    userId: "user-1",
    workspaceRoot: "/workspace"
  };

  assert.deepEqual(resolveRuntimeTarget(attackerInput, env), {
    provider: "azure",
    model: "server-model"
  });
  assert.equal(resolveTemperature(attackerInput, env), 0.2);
  assert.equal(resolveMaxTokens(attackerInput, env), 2048);
});

test("chat CORS only echoes allowlisted CRM origins", async () => {
  const previousOrigins = process.env.CRM_ALLOWED_ORIGINS;
  process.env.CRM_ALLOWED_ORIGINS = "http://crm.local";

  try {
    const createOptionsRequest = (origin: string) => ({
      method: "OPTIONS",
      headers: {
        get(name: string) {
          return name.toLowerCase() === "origin" ? origin : null;
        }
      }
    });

    const allowed = await chat(
      createOptionsRequest("http://crm.local") as never,
      { log() {}, error() {} } as never
    );
    assert.equal(allowed.headers?.["Access-Control-Allow-Origin"], "http://crm.local");

    const blocked = await chat(
      createOptionsRequest("http://evil.local") as never,
      { log() {}, error() {} } as never
    );
    assert.equal(blocked.headers?.["Access-Control-Allow-Origin"], undefined);
  } finally {
    if (previousOrigins === undefined) {
      delete process.env.CRM_ALLOWED_ORIGINS;
    } else {
      process.env.CRM_ALLOWED_ORIGINS = previousOrigins;
    }
  }
});

test("data_tool is GET-only and route allowlisted", async () => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const tool = createApiRequestTool({
    envSource: {
      API_BASE_URL: "http://crm.local",
      API_ACCESS_TOKEN: "host-token",
      API_DATA_TOOL_ALLOWED_ROUTES: "GET /api/data/accounts/:id,GET /api/data/actions"
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  assert.ok(tool);

  const allowedResult = await tool.execute({
    method: "GET",
    path: "/api/data/accounts/123",
    headers: {
      Authorization: "Bearer attacker-token",
      "X-Trace": "trace-1"
    }
  }, {});

  assert.equal((allowedResult as { status: number }).status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init?.method, "GET");
  assert.equal((calls[0].init?.headers as Headers).get("Authorization"), "Bearer host-token");
  assert.equal((calls[0].init?.headers as Headers).get("X-Trace"), "trace-1");

  await assert.rejects(
    () => tool.execute({ method: "POST", path: "/api/data/accounts/123" }, {}),
    /only supports GET/
  );

  await assert.rejects(
    () => tool.execute({ method: "GET", path: "/api/data/accounts/123/delete" }, {}),
    /route is not allowlisted/
  );

  await assert.rejects(
    () => tool.execute({ method: "GET", path: "/api/data/accounts/123", body: { name: "mutate" } }, {}),
    /GET calls cannot include a body/
  );
});
