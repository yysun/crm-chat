/*
 * Feature: Azure Functions adapter for the ai-workspace /chat route.
 * Notes: preserves the source OpenAI-style JSON/SSE contract while removing AIW storage integration.
 */

import { mkdir } from "node:fs/promises";
import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { resolveUserId, UserIdResolutionError } from "../auth/resolveUserId.js";
import { loadEnv, type EnvConfig } from "../config/env.js";
import { runChatCompletion } from "../runtime/runChatCompletion.js";
import type { ChatCompletionRequest, ChatMessage, RuntimeEvent } from "../runtime/runtimeTypes.js";
import { mapRuntimeEvent } from "../sse/mapRuntimeEvent.js";
import { loadAgentsMdCache, type LoadedAgentsMd } from "../workspace/loadAgentsMd.js";
import { resolveUserWorkspaceRoot, resolveWorkspaceRoot } from "../workspace/resolveWorkspace.js";

type HttpError = Error & { statusCode?: number };

let agentsMdCachePromise: Promise<LoadedAgentsMd> | undefined;
let agentsMdCacheWorkspaceRoot: string | undefined;

function isNotDirectoryError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "ENOTDIR";
}

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

function extractBearerToken(request: HttpRequest): string | null {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer" || !parts[1]) {
    return null;
  }

  return parts[1];
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.role === "string" && typeof candidate.content === "string";
}

function parseRequestBody(body: unknown): ChatCompletionRequest {
  if (typeof body !== "object" || body === null) {
    throw createHttpError("Request body must be a JSON object", 400);
  }

  const candidate = body as Record<string, unknown>;
  if (!Array.isArray(candidate.messages) || candidate.messages.length === 0) {
    throw createHttpError("messages must be a non-empty array", 400);
  }

  if (!candidate.messages.every(isChatMessage)) {
    throw createHttpError("messages must contain role and content strings", 400);
  }

  return {
    model: typeof candidate.model === "string" ? candidate.model : undefined,
    messages: candidate.messages,
    stream: typeof candidate.stream === "boolean" ? candidate.stream : undefined,
    temperature: typeof candidate.temperature === "number" ? candidate.temperature : undefined,
    max_tokens: typeof candidate.max_tokens === "number" ? candidate.max_tokens : undefined,
    tools: Array.isArray(candidate.tools) ? candidate.tools : undefined,
    tool_choice: candidate.tool_choice,
    metadata: typeof candidate.metadata === "object" && candidate.metadata !== null
      ? (candidate.metadata as Record<string, unknown>)
      : undefined
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

function emptyOptionsResponse(): HttpResponseInit {
  return {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    }
  };
}

function jsonResponse(status: number, body: unknown): HttpResponseInit {
  return {
    status,
    jsonBody: body,
    headers: {
      "Access-Control-Allow-Origin": "*"
    }
  };
}

export async function chat(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    if (request.method.toUpperCase() === "OPTIONS") {
      return emptyOptionsResponse();
    }

    const env = loadEnv(process.env);
    const token = extractBearerToken(request);
    if (!token) {
      return jsonResponse(401, { error: "Authorization: Bearer <token> header is required" });
    }

    if (!env.authUserUrl) {
      return jsonResponse(401, { error: "User identity service is not configured" });
    }

    let userId: string;
    try {
      userId = await resolveUserId(token, env.authUserUrl);
    } catch (error) {
      if (error instanceof UserIdResolutionError) {
        return jsonResponse(401, { error: "Unauthorized" });
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
    const userDataRoot = resolveUserWorkspaceRoot(workspaceRoot, userId);
    const agentsMdCache = await getAgentsMdCache(workspaceRoot);
    const abortController = new AbortController();

    context.log(`[chat] userId=${userId}`);

    try {
      await mkdir(userDataRoot, { recursive: true });
    } catch (error) {
      if (!isNotDirectoryError(error)) {
        throw error;
      }
    }

    const runtimeInput = {
      model: chatRequest.model,
      messages: chatRequest.messages,
      stream: chatRequest.stream === true,
      temperature: chatRequest.temperature,
      maxTokens: chatRequest.max_tokens,
      metadata: chatRequest.metadata,
      userId,
      workspaceRoot,
      agentsMd: agentsMdCache.content,
      accessToken: token,
      signal: abortController.signal
    };

    if (chatRequest.stream === true) {
      return {
        status: 200,
        body: streamRuntimeEvents(runtimeInput, env),
        headers: {
          "Access-Control-Allow-Origin": "*",
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

    const response = aggregateResponse(chatRequest.model ?? "default", events);
    return jsonResponse(response.statusCode, response.body);
  } catch (error) {
    const statusCode = resolveErrorStatusCode(error);
    const message = error instanceof Error ? error.message : "Internal server error";
    context.error("request failed", {
      statusCode,
      method: request.method,
      path: request.url,
      message
    });

    return jsonResponse(statusCode, { error: message });
  }
}
