/*
 * Feature: workspace-configured outbound API tool for llm-runtime requests.
 * Notes: constrains calls to a configured base URL and applies host-owned auth headers from workspace env.
 * Recent changes: supports opt-in GET response caching in process memory.
 */

import type { LLMToolDefinition, LLMToolExecutionContext } from "llm-runtime";
import { createHash } from "node:crypto";

const API_TOOL_NAME = "data_tool";
const DEFAULT_SECURITY_CONTEXT_HEADER = "X-Security-Context";
const SUPPORTED_API_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const REDACTED_RESPONSE_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
  "set-cookie",
  "set-cookie2"
]);

type ApiToolConfig = {
  baseUrl: URL;
  accessToken?: string;
  authScheme: string;
  securityContext?: string;
  securityContextHeader: string;
};

type ApiResponseSummary = {
  ok: boolean;
  status: number;
  statusText: string;
  url: string;
  headers: Record<string, string>;
};

type ApiCacheEntry = {
  version: 1;
  cachedAt: number;
  expiresAt: number;
  contentType: string | null;
  rawBody: string;
  response: ApiResponseSummary;
};

const apiResponseCache = new Map<string, ApiCacheEntry>();

type QueryScalar = string | number | boolean | null;
type QueryValue = QueryScalar | QueryScalar[];

function trimOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeBaseUrl(rawBaseUrl: string): URL {
  let baseUrl: URL;

  try {
    baseUrl = new URL(rawBaseUrl);
  } catch {
    throw new Error("API_BASE_URL must be a valid absolute URL");
  }

  if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
    throw new Error("API_BASE_URL must use http or https");
  }

  if (!baseUrl.pathname.endsWith("/")) {
    baseUrl.pathname = `${baseUrl.pathname}/`;
  }

  return baseUrl;
}

export function resolveApiToolConfig(envSource: NodeJS.ProcessEnv): ApiToolConfig | null {
  const baseUrl = trimOptionalString(envSource.API_BASE_URL);
  if (!baseUrl) {
    return null;
  }

  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    accessToken: trimOptionalString(envSource.API_ACCESS_TOKEN),
    authScheme: trimOptionalString(envSource.API_AUTH_SCHEME) ?? "Bearer",
    securityContext: trimOptionalString(envSource.API_SECURITY_CONTEXT),
    securityContextHeader: trimOptionalString(envSource.API_SECURITY_CONTEXT_HEADER) ?? DEFAULT_SECURITY_CONTEXT_HEADER
  };
}

function parseMethod(value: unknown): string {
  const method = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!SUPPORTED_API_METHODS.has(method)) {
    throw new Error(`data tool requires one of: ${Array.from(SUPPORTED_API_METHODS).join(", ")}`);
  }

  return method;
}

function parsePath(value: unknown): string {
  const path = typeof value === "string" ? value.trim() : "";
  if (!path) {
    throw new Error("data tool requires a non-empty path");
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) {
    throw new Error("data tool path must be relative to API_BASE_URL");
  }

  return path;
}

function isQueryScalar(value: unknown): value is QueryScalar {
  return value === null
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean";
}

function asQueryValues(value: unknown): QueryValue | undefined {
  if (isQueryScalar(value)) {
    return value;
  }

  if (Array.isArray(value) && value.every(isQueryScalar)) {
    return value;
  }

  return undefined;
}

function appendQueryParams(url: URL, query: unknown): void {
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    return;
  }

  for (const [key, rawValue] of Object.entries(query as Record<string, unknown>)) {
    const value = asQueryValues(rawValue);
    if (value === undefined) {
      continue;
    }

    const values = Array.isArray(value) ? value : [value];
    for (const entry of values) {
      if (entry === null) {
        continue;
      }

      url.searchParams.append(key, String(entry));
    }
  }
}

function parseCacheTtlMs(value: unknown, method: string): number | undefined {
  if (value === undefined || value === null || method !== "GET") {
    return undefined;
  }

  const normalizedValue = typeof value === "string" && value.trim() ? Number(value) : value;
  if (typeof normalizedValue !== "number" || !Number.isFinite(normalizedValue)) {
    return undefined;
  }

  const ttlMs = Math.floor(normalizedValue);
  return ttlMs > 0 ? ttlMs : undefined;
}

function parseBypassCache(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalizedValue = value.trim().toLowerCase();
    if (normalizedValue === "true") {
      return true;
    }

    if (normalizedValue === "false") {
      return false;
    }
  }

  return false;
}

function createCacheKey(method: string, url: URL, headers: Headers): string {
  const normalizedHeaders = Array.from(headers.entries())
    .sort((left, right) => {
      if (left[0] !== right[0]) {
        return left[0].localeCompare(right[0]);
      }

      return left[1].localeCompare(right[1]);
    });

  return createHash("sha256")
    .update(JSON.stringify({
      method,
      url: url.toString(),
      headers: normalizedHeaders
    }))
    .digest("hex");
}

function isApiCacheEntry(value: unknown): value is ApiCacheEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<ApiCacheEntry>;
  const response = candidate.response as Partial<ApiResponseSummary> | undefined;
  return candidate.version === 1
    && typeof candidate.cachedAt === "number"
    && typeof candidate.expiresAt === "number"
    && (typeof candidate.contentType === "string" || candidate.contentType === null)
    && typeof candidate.rawBody === "string"
    && typeof response?.ok === "boolean"
    && typeof response.status === "number"
    && typeof response.statusText === "string"
    && typeof response.url === "string"
    && typeof response.headers === "object"
    && response.headers !== null
    && !Array.isArray(response.headers);
}

function readApiCacheEntry(cacheKey: string): ApiCacheEntry | null {
  const cachedEntry = apiResponseCache.get(cacheKey);
  if (!cachedEntry) {
    return null;
  }

  if (!isApiCacheEntry(cachedEntry) || cachedEntry.expiresAt <= Date.now()) {
    apiResponseCache.delete(cacheKey);
    return null;
  }

  return cachedEntry;
}

function persistApiCacheEntry(cacheKey: string, entry: ApiCacheEntry): void {
  apiResponseCache.set(cacheKey, entry);
}

export function resolveApiRequestUrl(baseUrl: URL, relativePath: string, query: unknown): URL {
  const sanitizedPath = relativePath.replace(/^\/+/, "");
  const resolvedUrl = new URL(sanitizedPath, baseUrl);
  appendQueryParams(resolvedUrl, query);

  if (resolvedUrl.origin !== baseUrl.origin) {
    throw new Error("data tool path must stay within the configured API origin");
  }

  if (!resolvedUrl.pathname.startsWith(baseUrl.pathname)) {
    throw new Error("data tool path must stay within the configured API base path");
  }

  return resolvedUrl;
}

function buildRequestHeaders(config: ApiToolConfig, rawHeaders: unknown): Headers {
  const headers = new Headers();

  if (rawHeaders && typeof rawHeaders === "object" && !Array.isArray(rawHeaders)) {
    for (const [key, value] of Object.entries(rawHeaders as Record<string, unknown>)) {
      if (typeof value === "string") {
        headers.set(key, value);
      }
    }
  }

  if (config.accessToken) {
    headers.set("Authorization", `${config.authScheme} ${config.accessToken}`);
  }

  if (config.securityContext) {
    headers.set(config.securityContextHeader, config.securityContext);
  }

  headers.set("Accept", headers.get("Accept") ?? "application/json, text/plain;q=0.9, */*;q=0.8");

  return headers;
}

function serializeRequestBody(method: string, body: unknown, headers: Headers): string | undefined {
  if (body === undefined) {
    return undefined;
  }

  if (method === "GET") {
    throw new Error("data tool GET calls cannot include a body");
  }

  if (typeof body === "string") {
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "text/plain; charset=utf-8");
    }

    return body;
  }

  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  try {
    return JSON.stringify(body);
  } catch {
    throw new Error("data tool body must be JSON serializable");
  }
}

function sanitizeResponseHeaders(headers: Headers): Record<string, string> {
  const sanitizedHeaders: Record<string, string> = {};

  for (const [key, value] of headers.entries()) {
    if (REDACTED_RESPONSE_HEADER_NAMES.has(key.toLowerCase())) {
      continue;
    }

    sanitizedHeaders[key] = value;
  }

  return sanitizedHeaders;
}

function parseResponseBody(rawBody: string, contentType: string | null): unknown {
  if (!rawBody) {
    return "";
  }

  if (contentType?.toLowerCase().includes("application/json")) {
    try {
      return JSON.parse(rawBody);
    } catch {
      return rawBody;
    }
  }

  return rawBody;
}

async function buildApiResponseResult(
  response: ApiResponseSummary,
  rawBody: string,
  contentType: string | null,
  cached: boolean | undefined
): Promise<Record<string, unknown>> {
  return {
    ...response,
    ...(cached === undefined ? {} : { cached }),
    body: parseResponseBody(rawBody, contentType)
  };
}

async function executeApiRequest(
  config: ApiToolConfig,
  args: Record<string, unknown>,
  context: LLMToolExecutionContext | undefined,
  fetchImpl: typeof fetch
): Promise<unknown> {
  const method = parseMethod(args.method);
  const requestPath = parsePath(args.path);
  const url = resolveApiRequestUrl(config.baseUrl, requestPath, args.query);
  const headers = buildRequestHeaders(config, args.headers);
  const body = serializeRequestBody(method, args.body, headers);
  const cacheTtlMs = parseCacheTtlMs(args.cacheTtlMs, method);
  const bypassCache = parseBypassCache(args.bypassCache);

  const cacheKey = cacheTtlMs !== undefined
    ? createCacheKey(method, url, headers)
    : null;

  if (cacheKey && !bypassCache) {
    const cachedResponse = readApiCacheEntry(cacheKey);
    if (cachedResponse) {
      return await buildApiResponseResult(
        cachedResponse.response,
        cachedResponse.rawBody,
        cachedResponse.contentType,
        true
      );
    }
  }

  const response = await fetchImpl(url, {
    method,
    headers,
    ...(body !== undefined ? { body } : {}),
    signal: context?.abortSignal
  });

  const rawBody = await response.text();
  const contentType = response.headers.get("content-type");
  const responseSummary: ApiResponseSummary = {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    url: url.toString(),
    headers: sanitizeResponseHeaders(response.headers)
  };

  if (cacheKey && response.ok && cacheTtlMs !== undefined) {
    const now = Date.now();
    persistApiCacheEntry(cacheKey, {
      version: 1,
      cachedAt: now,
      expiresAt: now + cacheTtlMs,
      contentType,
      rawBody,
      response: responseSummary
    });
  }

  return await buildApiResponseResult(
    responseSummary,
    rawBody,
    contentType,
    cacheKey ? false : undefined
  );
}

export function createApiRequestTool(options: {
  envSource?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
} = {}): LLMToolDefinition | null {
  const envSource = options.envSource ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const config = resolveApiToolConfig(envSource);

  if (!config) {
    return null;
  }

  return {
    name: API_TOOL_NAME,
    description: "Call the workspace-configured API using a path relative to API_BASE_URL. Host-owned auth and security headers are applied automatically. Responses are returned inline. GET requests can opt into in-memory caching with cacheTtlMs.",
    evidenceKind: "external_action",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        method: {
          type: "string",
          description: "HTTP method to use.",
          enum: Array.from(SUPPORTED_API_METHODS)
        },
        path: {
          type: "string",
          description: "Relative API path under the configured API_BASE_URL."
        },
        query: {
          type: "object",
          description: "Optional query string values. String, number, boolean, null, or arrays of those are accepted.",
          additionalProperties: true
        },
        headers: {
          type: "object",
          description: "Optional additional request headers. Host-owned auth headers override conflicting values.",
          additionalProperties: {
            type: "string"
          }
        },
        body: {
          description: "Optional JSON-serializable body value or raw string payload."
        },
        cacheTtlMs: {
          type: "number",
          description: "Optional positive TTL in milliseconds for GET requests. When provided, successful responses are cached in process memory and reused until the TTL expires."
        },
        bypassCache: {
          type: "boolean",
          description: "Optional GET-only flag that forces a fresh network request while still refreshing the cached entry for the provided cacheTtlMs."
        }
      },
      required: ["method", "path"]
    },
    execute: async (args, context) => await executeApiRequest(config, args, context, fetchImpl)
  };
}
