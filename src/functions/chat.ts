/*
 * Feature: Azure Functions adapter for the ai-workspace /chat route.
 * Notes: validates normal-user chat input, owns runtime policy, and applies CRM-origin CORS.
 * Recent changes: prefers X-Google-Auth bearer tokens for identity and CRM API auth with JWT fallback.
 */

import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { resolveUserId, UserIdResolutionError } from "../auth/resolveUserId.js";
import { loadEnv, type EnvConfig } from "../config/env.js";
import { runChatCompletion } from "../runtime/runChatCompletion.js";
import type { ChatCompletionRequest, ChatMessage, RuntimeEvent } from "../runtime/runtimeTypes.js";
import { mapRuntimeEvent } from "../sse/mapRuntimeEvent.js";
import { loadAgentsMdCache, type LoadedAgentsMd } from "../workspace/loadAgentsMd.js";
import { resolveWorkspaceRoot } from "../workspace/resolveWorkspace.js";

type HttpError = Error & { statusCode?: number };
type IncomingChatMessage = {
  role: string;
  content: string;
};
type RequestAuthTokens = {
  token: string;
  source: "X-Google-Auth" | "Authorization";
};

const GOOGLE_AUTH_HEADER = "X-Google-Auth";

let agentsMdCachePromise: Promise<LoadedAgentsMd> | undefined;
let agentsMdCacheWorkspaceRoot: string | undefined;

function createHttpError(message: string, statusCode: number): HttpError {
  const error = new Error(message) as HttpError;
  error.statusCode = statusCode;
  return error;
}

function resolveErrorStatusCode(error: unknown): number {
  if (typeof error !== "object" || error === null) {
    return 500;
  }

  const candidate = error as { statusCode?: number; status?: number };
  return Number(candidate.statusCode ?? candidate.status) || 500;
}

function parseBearerHeader(value: string | null, headerName: string): string | null {
  if (!value) {
    return null;
  }

  const parts = value.split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer" || !parts[1]) {
    throw createHttpError(`${headerName}: Bearer <token> header is malformed`, 401);
  }

  return parts[1];
}

export function resolveRequestAuthTokens(request: HttpRequest): RequestAuthTokens | null {
  const googleToken = parseBearerHeader(request.headers.get(GOOGLE_AUTH_HEADER), GOOGLE_AUTH_HEADER);
  if (googleToken) {
    return {
      token: googleToken,
      source: GOOGLE_AUTH_HEADER
    };
  }

  const authorizationToken = parseBearerHeader(request.headers.get("authorization"), "Authorization");
  if (!authorizationToken) {
    return null;
  }

  return {
    token: authorizationToken,
    source: "Authorization"
  };
}

function isIncomingChatMessage(value: unknown): value is IncomingChatMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.role === "string" && typeof candidate.content === "string";
}

function normalizeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value.replace(/\/+$/, "");
  }
}

function resolveAllowedCorsOrigin(request: HttpRequest, env: EnvConfig): string | undefined {
  const origin = request.headers.get("origin")?.trim();
  if (!origin) {
    return undefined;
  }

  const normalizedOrigin = normalizeOrigin(origin);
  const allowedOrigins = new Set(
    env.crmAllowedOrigins
      .filter((entry) => entry !== "*")
      .map(normalizeOrigin)
  );

  return allowedOrigins.has(normalizedOrigin) ? normalizedOrigin : undefined;
}

function createCorsHeaders(request: HttpRequest, env: EnvConfig): Record<string, string> {
  const headers: Record<string, string> = {
    "Vary": "Origin"
  };
  const allowedOrigin = resolveAllowedCorsOrigin(request, env);
  if (allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = allowedOrigin;
  }

  return headers;
}

export function parseRequestBody(body: unknown): ChatCompletionRequest {
  if (typeof body !== "object" || body === null) {
    throw createHttpError("Request body must be a JSON object", 400);
  }

  const candidate = body as Record<string, unknown>;
  if (!Array.isArray(candidate.messages) || candidate.messages.length === 0) {
    throw createHttpError("messages must be a non-empty array", 400);
  }

  if (!candidate.messages.every(isIncomingChatMessage)) {
    throw createHttpError("messages must contain role and content strings", 400);
  }

  const messages = candidate.messages as IncomingChatMessage[];
  for (const message of messages) {
    if (message.role === "system") {
      throw createHttpError("client-supplied system messages are not accepted", 400);
    }

    if (message.role === "tool") {
      throw createHttpError("client-supplied tool messages are not accepted", 400);
    }

    if (message.role !== "user" && message.role !== "assistant") {
      throw createHttpError("messages may only use user or assistant roles", 400);
    }
  }

  return {
    messages: messages.map((message) => ({
      role: message.role as ChatMessage["role"],
      content: message.content
    })),
    stream: typeof candidate.stream === "boolean" ? candidate.stream : undefined
  };
}

function aggregateResponse(model: string, events: RuntimeEvent[]) {
  let assistantContent = "";
  let finalContent: string | undefined;
  let errorMessage: string | undefined;
  const warnings: string[] = [];

  for (const event of events) {
    if (event.type === "message.delta") {
      assistantContent += event.text;
    }

    if (event.type === "message.done") {
      finalContent = event.message.content;
    }

    if (event.type === "error") {
      errorMessage = event.error;
    }

    if (event.type === "warning") {
      warnings.push(event.warning);
    }
  }

  const content = finalContent ?? (!errorMessage ? assistantContent : "");
  if (!content && errorMessage) {
    return {
      statusCode: 500,
      body: { error: errorMessage }
    };
  }

  return {
    statusCode: errorMessage ? 502 : 200,
    body: {
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      ...(warnings.length > 0 ? { warnings } : {}),
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content
          },
          finish_reason: errorMessage ? "error" : "stop"
        }
      ],
      runtime_events: events
    }
  };
}

function getAgentsMdCache(workspaceRoot: string): Promise<LoadedAgentsMd> {
  if (!agentsMdCachePromise || agentsMdCacheWorkspaceRoot !== workspaceRoot) {
    agentsMdCacheWorkspaceRoot = workspaceRoot;
    agentsMdCachePromise = loadAgentsMdCache(workspaceRoot);
  }

  return agentsMdCachePromise;
}

function encodeSseEvent(event: { event: string; data: string }): Uint8Array {
  return new TextEncoder().encode(`event: ${event.event}\ndata: ${event.data}\n\n`);
}

async function* streamRuntimeEvents(runtimeInput: Parameters<typeof runChatCompletion>[0], env: EnvConfig): AsyncIterable<Uint8Array> {
  for await (const event of runChatCompletion(runtimeInput, env)) {
    yield encodeSseEvent(mapRuntimeEvent(event));
  }

  yield encodeSseEvent({
    event: "done",
    data: "{}"
  });
}

function emptyOptionsResponse(request: HttpRequest, env: EnvConfig): HttpResponseInit {
  return {
    status: 204,
    headers: {
      ...createCorsHeaders(request, env),
      "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Google-Auth",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    }
  };
}

function jsonResponse(status: number, body: unknown, request: HttpRequest, env: EnvConfig): HttpResponseInit {
  return {
    status,
    jsonBody: body,
    headers: createCorsHeaders(request, env)
  };
}

export async function chat(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const env = loadEnv(process.env);

  try {
    if (request.method.toUpperCase() === "OPTIONS") {
      return emptyOptionsResponse(request, env);
    }

    const authTokens = resolveRequestAuthTokens(request);
    if (!authTokens) {
      return jsonResponse(401, { error: "Authorization or X-Google-Auth bearer header is required" }, request, env);
    }

    if (!env.apiAuthUrl) {
      return jsonResponse(401, { error: "User identity service is not configured" }, request, env);
    }

    let userId: string;
    try {
      userId = await resolveUserId(authTokens.token, env.apiAuthUrl);
    } catch (error) {
      if (error instanceof UserIdResolutionError) {
        return jsonResponse(401, { error: "Unauthorized" }, request, env);
      }
      throw error;
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      throw createHttpError("Request body must be valid JSON", 400);
    }

    const chatRequest = parseRequestBody(rawBody);
    const workspaceRoot = resolveWorkspaceRoot(env.workspaceRoot);
    const agentsMdCache = await getAgentsMdCache(workspaceRoot);
    const abortController = new AbortController();

    context.log(`[chat] userId=${userId} authSource=${authTokens.source}`);

    const runtimeInput = {
      messages: chatRequest.messages,
      stream: chatRequest.stream === true,
      userId,
      workspaceRoot,
      agentsMd: agentsMdCache.content,
      accessToken: authTokens.token,
      accessTokenHeader: authTokens.source,
      signal: abortController.signal
    };

    if (chatRequest.stream === true) {
      return {
        status: 200,
        body: streamRuntimeEvents(runtimeInput, env),
        headers: {
          ...createCorsHeaders(request, env),
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
          "Content-Type": "text/event-stream; charset=utf-8"
        }
      };
    }

    const events: RuntimeEvent[] = [];
    for await (const event of runChatCompletion(runtimeInput, env)) {
      events.push(event);
    }

    const response = aggregateResponse(env.llmModel ?? "server-configured", events);
    return jsonResponse(response.statusCode, response.body, request, env);
  } catch (error) {
    const statusCode = resolveErrorStatusCode(error);
    const message = error instanceof Error ? error.message : "Internal server error";
    context.error("request failed", {
      statusCode,
      method: request.method,
      path: request.url,
      message
    });

    return jsonResponse(statusCode, { error: message }, request, env);
  }
}
