/*
 * Feature: regression tests for Google bearer token forwarding.
 * Notes: verifies X-Google-Auth can replace JWT for identity and forwarded CRM API auth.
 * Recent changes: covers X-Google-Auth precedence, JWT fallback, and malformed auth credentials.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { resolveRequestAuthTokens } from "../src/functions/chat.js";
import { createApiRequestTool } from "../src/tools/dataTool.js";

function createRequest(headers: Record<string, string>) {
  const normalizedHeaders = new Map(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );

  return {
    headers: {
      get(name: string) {
        return normalizedHeaders.get(name.toLowerCase()) ?? null;
      }
    }
  };
}

test("X-Google-Auth wins for identity and forwarded CRM API token", () => {
  const auth = resolveRequestAuthTokens(createRequest({
    Authorization: "Bearer jwt-token",
    "X-Google-Auth": "Bearer google-token"
  }) as never);

  assert.deepEqual(auth, {
    token: "google-token",
    source: "X-Google-Auth"
  });
});

test("Authorization is the fallback auth token when X-Google-Auth is absent", () => {
  const auth = resolveRequestAuthTokens(createRequest({
    Authorization: "Bearer jwt-token"
  }) as never);

  assert.deepEqual(auth, {
    token: "jwt-token",
    source: "Authorization"
  });
});

test("X-Google-Auth works without Authorization", () => {
  assert.deepEqual(resolveRequestAuthTokens(createRequest({
    "X-Google-Auth": "Bearer google-token"
  }) as never), {
    token: "google-token",
    source: "X-Google-Auth"
  });
});

test("malformed X-Google-Auth rejects instead of silently falling back to Authorization", () => {
  assert.throws(
    () => resolveRequestAuthTokens(createRequest({
      Authorization: "Bearer jwt-token",
      "X-Google-Auth": "google-token"
    }) as never),
    /X-Google-Auth: Bearer <token> header is malformed/
  );
});

test("malformed Authorization rejects when X-Google-Auth is absent", () => {
  assert.throws(
    () => resolveRequestAuthTokens(createRequest({
      Authorization: "jwt-token"
    }) as never),
    /Authorization: Bearer <token> header is malformed/
  );
});

test("data_tool re-injects trusted inbound X-Google-Auth and blocks model auth headers", async () => {
  let outboundAuthHeader: string | null = null;
  let outboundGoogleAuthHeader: string | null = null;
  const tool = createApiRequestTool({
    envSource: {
      API_BASE_URL: "http://crm.local",
      API_ACCESS_TOKEN: "google-token",
      API_AUTH_HEADER: "X-Google-Auth",
      API_DATA_TOOL_ALLOWED_ROUTES: "GET /api/data/who"
    },
    fetchImpl: async (_url, init) => {
      outboundAuthHeader = (init?.headers as Headers).get("Authorization");
      outboundGoogleAuthHeader = (init?.headers as Headers).get("X-Google-Auth");
      return new Response(JSON.stringify({ id: "user-1" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  assert.ok(tool);
  await tool.execute({
    method: "GET",
    path: "/api/data/who",
    headers: {
      Authorization: "Bearer attacker-token",
      "X-Google-Auth": "Bearer attacker-google-token"
    }
  }, {});

  assert.equal(outboundAuthHeader, null);
  assert.equal(outboundGoogleAuthHeader, "Bearer google-token");
});

test("data_tool falls back to host-owned Authorization for JWT auth", async () => {
  let outboundAuthHeader: string | null = null;
  let outboundGoogleAuthHeader: string | null = null;
  const tool = createApiRequestTool({
    envSource: {
      API_BASE_URL: "http://crm.local",
      API_ACCESS_TOKEN: "jwt-token",
      API_DATA_TOOL_ALLOWED_ROUTES: "GET /api/data/who"
    },
    fetchImpl: async (_url, init) => {
      outboundAuthHeader = (init?.headers as Headers).get("Authorization");
      outboundGoogleAuthHeader = (init?.headers as Headers).get("X-Google-Auth");
      return new Response(JSON.stringify({ id: "user-1" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  assert.ok(tool);
  await tool.execute({
    method: "GET",
    path: "/api/data/who"
  }, {});

  assert.equal(outboundAuthHeader, "Bearer jwt-token");
  assert.equal(outboundGoogleAuthHeader, null);
});
