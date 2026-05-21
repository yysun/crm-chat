/*
 * Feature: deterministic CRM read helper for the rlp-crm skill.
 * Notes: builds validated read-only CRM requests, loads project-root .env, and executes them against API_BASE_URL.
 * Recent changes: promoted the helper from payload-only output to the skill-owned CRM read path.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SECURITY_CONTEXT_HEADER = "X-Security-Context";
const REJECTED_REQUEST_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
  "x-api-key",
  "x-google-auth"
]);
const REDACTED_RESPONSE_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
  "set-cookie",
  "set-cookie2"
]);

const OPERATIONS = {
  who: {
    description: "Current user and teams.",
    path: () => "/api/data/who"
  },
  search: {
    description: "Search contacts and accounts by name or text.",
    required: ["q"],
    path: () => "/api/data/contacts/searchAll",
    query: ({ q }) => ({ q })
  },
  account: {
    description: "Load one account by ID.",
    required: ["id"],
    path: ({ id }) => `/api/data/accounts/${encodePathSegment(id)}`
  },
  "account-contacts": {
    description: "Load contacts for one account ID.",
    required: ["id"],
    path: ({ id }) => `/api/data/accounts/${encodePathSegment(id)}/contacts`
  },
  "account-notes": {
    description: "Load notes for one account ID.",
    required: ["id"],
    path: ({ id }) => `/api/data/accounts/${encodePathSegment(id)}/notes`
  },
  actions: {
    description: "Load action feed by date. Defaults to today when --date is omitted.",
    path: () => "/api/data/actions",
    query: ({ date }) => ({ date: date || todayIsoDate() })
  },
  contact: {
    description: "Load one contact by ID.",
    required: ["id"],
    path: ({ id }) => `/api/data/contacts/${encodePathSegment(id)}`
  },
  "contact-notes": {
    description: "Load notes for one contact ID.",
    required: ["id"],
    path: ({ id }) => `/api/data/contacts/${encodePathSegment(id)}/notes`
  }
};

const VALUE_FLAGS = new Set([
  "id",
  "q",
  "date",
  "header"
]);

function stripOptionalQuotes(value) {
  const trimmed = value.trim();
  const quote = trimmed[0];

  if ((quote !== "\"" && quote !== "'") || trimmed.at(-1) !== quote) {
    return trimmed;
  }

  const inner = trimmed.slice(1, -1);
  return quote === "\"" ? inner.replace(/\\n/g, "\n").replace(/\\"/g, "\"") : inner;
}

function parseEnvLine(line) {
  const trimmed = line.trim();

  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const normalized = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trimStart() : trimmed;
  const separatorIndex = normalized.indexOf("=");
  if (separatorIndex <= 0) {
    return null;
  }

  const key = normalized.slice(0, separatorIndex).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return null;
  }

  return [key, stripOptionalQuotes(normalized.slice(separatorIndex + 1))];
}

function findProjectRoot(startDir = SCRIPT_DIR) {
  for (let dir = path.resolve(startDir); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, ".agents", "skills", "rlp-crm", "SKILL.md"))) {
      return dir;
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      return path.resolve(process.cwd());
    }
  }
}

function findProjectEnvFile() {
  const projectRoot = findProjectRoot();
  const envPath = path.join(projectRoot, ".env");
  return existsSync(envPath) ? envPath : null;
}

function loadProjectEnv() {
  const envPath = findProjectEnvFile();
  if (!envPath) {
    return null;
  }

  const rawEnv = readFileSync(envPath, "utf8");
  for (const line of rawEnv.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) {
      continue;
    }

    const [key, value] = parsed;
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  return envPath;
}

function todayIsoDate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function encodePathSegment(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    throw new Error("route id must be non-empty");
  }

  return encodeURIComponent(trimmed);
}

function parseArgs(argv) {
  const result = {
    positional: [],
    headers: {}
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      result.help = true;
      continue;
    }

    if (!arg.startsWith("--")) {
      result.positional.push(arg);
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split(/=(.*)/s, 2);
    const key = rawKey.trim();

    if (!VALUE_FLAGS.has(key)) {
      throw new Error(`unknown option --${key}`);
    }

    const value = inlineValue ?? argv[++index];
    if (typeof value !== "string") {
      throw new Error(`missing value for --${key}`);
    }

    if (key === "header") {
      addHeader(result.headers, value);
      continue;
    }

    result[toCamelCase(key)] = value;
  }

  return result;
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function addHeader(headers, rawHeader) {
  const separatorIndex = rawHeader.indexOf("=");
  if (separatorIndex <= 0) {
    throw new Error("--header must use Name=Value");
  }

  const name = rawHeader.slice(0, separatorIndex).trim();
  const value = rawHeader.slice(separatorIndex + 1).trim();
  if (!name || !value) {
    throw new Error("--header must include a non-empty name and value");
  }

  if (REJECTED_REQUEST_HEADER_NAMES.has(name.toLowerCase())) {
    throw new Error(`${name} is owned by the helper environment and must not be set with --header`);
  }

  headers[name] = value;
}

function validateDate(value) {
  if (typeof value === "undefined") {
    return undefined;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("--date must use YYYY-MM-DD");
  }

  return value;
}

function requireInputs(operation, options) {
  for (const key of operation.required ?? []) {
    if (typeof options[key] !== "string" || !options[key].trim()) {
      throw new Error(`missing required --${key}`);
    }
  }
}

function omitEmptyValues(record) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => {
      if (typeof value === "undefined" || value === null) {
        return false;
      }
      if (typeof value === "string") {
        return value.trim().length > 0;
      }
      return true;
    })
  );
}

function buildPayload(operationName, options) {
  const operation = OPERATIONS[operationName];
  if (!operation) {
    throw new Error(`unknown operation "${operationName}". Run "list" to see supported operations.`);
  }

  const normalizedOptions = {
    ...options,
    id: options.id?.trim(),
    q: options.q?.trim(),
    date: validateDate(options.date)
  };

  requireInputs(operation, normalizedOptions);

  const payload = {
    method: "GET",
    path: operation.path(normalizedOptions)
  };
  const query = operation.query ? omitEmptyValues(operation.query(normalizedOptions)) : {};

  if (Object.keys(query).length > 0) {
    payload.query = query;
  }

  if (Object.keys(normalizedOptions.headers).length > 0) {
    payload.headers = normalizedOptions.headers;
  }

  return payload;
}

function normalizeBaseUrl(rawBaseUrl) {
  let baseUrl;

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

function trimOptionalString(value) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseAuthHeader(value) {
  const normalizedValue = value?.trim().toLowerCase();
  if (normalizedValue === "x-google-auth") {
    return "X-Google-Auth";
  }

  return "Authorization";
}

function resolveConfig(envSource = process.env) {
  const baseUrl = trimOptionalString(envSource.API_BASE_URL);
  if (!baseUrl) {
    throw new Error("API_BASE_URL is required in project-root .env or the process environment");
  }

  const apiPat = trimOptionalString(envSource.API_PAT);
  if (!apiPat) {
    throw new Error("API_PAT is required in project-root .env or the process environment");
  }

  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    accessToken: apiPat,
    authHeader: parseAuthHeader(envSource.API_AUTH_HEADER),
    authScheme: trimOptionalString(envSource.API_AUTH_SCHEME) ?? "Bearer",
    securityContext: trimOptionalString(envSource.API_SECURITY_CONTEXT),
    securityContextHeader: trimOptionalString(envSource.API_SECURITY_CONTEXT_HEADER) ?? DEFAULT_SECURITY_CONTEXT_HEADER
  };
}

function resolveRequestUrl(baseUrl, relativePath, query) {
  const sanitizedPath = relativePath.replace(/^\/+/, "");
  const resolvedUrl = new URL(sanitizedPath, baseUrl);

  for (const [key, rawValue] of Object.entries(query ?? {})) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      if (value !== null && typeof value !== "undefined") {
        resolvedUrl.searchParams.append(key, String(value));
      }
    }
  }

  if (resolvedUrl.origin !== baseUrl.origin || !resolvedUrl.pathname.startsWith(baseUrl.pathname)) {
    throw new Error("CRM request path must stay within API_BASE_URL");
  }

  return resolvedUrl;
}

function buildRequestHeaders(config, rawHeaders = {}) {
  const headers = new Headers();

  for (const [key, value] of Object.entries(rawHeaders)) {
    const headerName = key.trim();
    if (headerName && typeof value === "string" && !REJECTED_REQUEST_HEADER_NAMES.has(headerName.toLowerCase())) {
      headers.set(headerName, value);
    }
  }

  if (config.accessToken) {
    headers.set(config.authHeader, `${config.authScheme} ${config.accessToken}`);
  }

  if (config.securityContext) {
    headers.set(config.securityContextHeader, config.securityContext);
  }

  headers.set("Accept", headers.get("Accept") ?? "application/json, text/plain;q=0.9, */*;q=0.8");
  return headers;
}

function sanitizeResponseHeaders(headers) {
  const sanitizedHeaders = {};

  for (const [key, value] of headers.entries()) {
    if (!REDACTED_RESPONSE_HEADER_NAMES.has(key.toLowerCase())) {
      sanitizedHeaders[key] = value;
    }
  }

  return sanitizedHeaders;
}

function parseResponseBody(rawBody) {
  if (!rawBody) {
    return null;
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    return rawBody;
  }
}

async function executePayload(payload) {
  loadProjectEnv();

  const config = resolveConfig();
  const url = resolveRequestUrl(config.baseUrl, payload.path, payload.query);
  const headers = buildRequestHeaders(config, payload.headers);
  const response = await fetch(url, {
    method: payload.method,
    headers
  });
  const rawBody = await response.text();

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    url: url.toString(),
    headers: sanitizeResponseHeaders(response.headers),
    body: parseResponseBody(rawBody)
  };
}

function printList() {
  for (const [name, operation] of Object.entries(OPERATIONS)) {
    console.log(`${name}\t${operation.description}`);
  }
}

function printHelp() {
  console.log(`Usage:
  node scripts/data-tool.js list
  node scripts/data-tool.js payload <operation> [options]
  node scripts/data-tool.js <operation> [options]

Operations:
${Object.entries(OPERATIONS).map(([name, operation]) => `  ${name.padEnd(16)} ${operation.description}`).join("\n")}

Options:
  --id <value>             Account or contact ID for ID-specific routes.
  --q <value>              Search text for the search operation.
  --date <YYYY-MM-DD>      Action feed date. Defaults to today for actions.
  --header Name=Value      Optional non-auth string header. Repeatable.

Environment:
  The script reads .env from the rlp-crm project root before executing a request.
  API_BASE_URL and API_PAT are required.
`);
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const [command, payloadOperation] = parsed.positional;

  if (parsed.help || !command || command === "help") {
    printHelp();
    return;
  }

  if (command === "list") {
    if (parsed.positional.length > 1) {
      throw new Error(`unexpected positional argument "${parsed.positional[1]}"`);
    }

    printList();
    return;
  }

  if (command === "payload") {
    if (!payloadOperation) {
      throw new Error("payload requires an operation name");
    }

    if (parsed.positional.length > 2) {
      throw new Error(`unexpected positional argument "${parsed.positional[2]}"`);
    }

    console.log(JSON.stringify(buildPayload(payloadOperation, parsed), null, 2));
    return;
  }

  if (parsed.positional.length > 1) {
    throw new Error(`unexpected positional argument "${parsed.positional[1]}"`);
  }

  const payload = buildPayload(command, parsed);
  const result = await executePayload(payload);
  console.log(JSON.stringify(result, null, 2));

  if (!result.ok) {
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
