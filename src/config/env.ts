/*
 * Feature: runtime environment configuration parsing for ai-workspace.
 * Notes: applies defaults for port, workspace root, and generic llm-runtime defaults.
 * Recent changes: parses CRM CORS and data_tool route allowlists from server settings.
 */

import path from "node:path";
import type { LLMProviderName, ReasoningEffort, ToolPermission } from "llm-runtime";

export type EnvConfig = {
  port: number;
  workspaceRoot: string;
  llmProvider?: LLMProviderName;
  llmModel?: string;
  llmMaxToken?: number;
  llmMaxIterations?: number;
  llmMaxConsecutiveToolTurns?: number;
  llmMaxWallTimeMs?: number;
  llmTemperature?: number;
  llmPermission: ToolPermission;
  llmReasoning: ReasoningEffort;
  openAiApiKey?: string;
  azureOpenAiApiKey?: string;
  azureOpenAiResourceName?: string;
  azureOpenAiDeploymentName?: string;
  azureOpenAiApiVersion?: string;
  googleApiKey?: string;
  anthropicApiKey?: string;
  openAiCompatibleApiKey?: string;
  openAiCompatibleBaseUrl?: string;
  apiAuthUrl?: string;
  crmAllowedOrigins: string[];
  apiDataToolAllowedRoutes: string[];
};

const SUPPORTED_PROVIDERS: LLMProviderName[] = ["openai", "anthropic", "google", "azure", "openai-compatible"];
const SUPPORTED_TOOL_PERMISSIONS: ToolPermission[] = ["auto", "ask", "read"];
const SUPPORTED_REASONING_EFFORTS: ReasoningEffort[] = ["default", "none", "low", "medium", "high"];

function parsePort(value: string | undefined): number {
  const parsed = Number(value ?? "3000");
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 3000;
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseOptionalPositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseOptionalProvider(value: string | undefined): LLMProviderName | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  return SUPPORTED_PROVIDERS.includes(normalized as LLMProviderName)
    ? normalized as LLMProviderName
    : undefined;
}

function parseDelimitedList(value: string | undefined): string[] {
  if (!value?.trim()) {
    return [];
  }

  return value
    .split(/[\n,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseToolPermission(value: string | undefined): ToolPermission {
  if (!value?.trim()) {
    return "auto";
  }

  const normalized = value.trim().toLowerCase();
  return SUPPORTED_TOOL_PERMISSIONS.includes(normalized as ToolPermission)
    ? normalized as ToolPermission
    : "auto";
}

function parseReasoningEffort(value: string | undefined): ReasoningEffort {
  if (!value?.trim()) {
    return "medium";
  }

  const normalized = value.trim().toLowerCase();
  return SUPPORTED_REASONING_EFFORTS.includes(normalized as ReasoningEffort)
    ? normalized as ReasoningEffort
    : "medium";
}

function resolveApiAuthUrl(source: NodeJS.ProcessEnv): string | undefined {
  const rawAuthUrl = source.API_AUTH_URL?.trim();
  if (!rawAuthUrl) {
    return undefined;
  }

  if (/^https?:\/\//i.test(rawAuthUrl)) {
    return rawAuthUrl;
  }

  const base = source.API_BASE_URL?.trim();
  if (!base) {
    return undefined;
  }

  const normalizedBase = base.replace(/\/+$/, "");
  const normalizedPath = rawAuthUrl.startsWith("/") ? rawAuthUrl : `/${rawAuthUrl}`;
  return `${normalizedBase}${normalizedPath}`;
}

export function loadEnv(source: NodeJS.ProcessEnv): EnvConfig {
  return {
    port: parsePort(source.PORT),
    workspaceRoot: path.resolve(source.WORKSPACE_ROOT ?? "/workspace"),
    llmProvider: parseOptionalProvider(source.LLM_PROVIDER),
    llmModel: source.LLM_MODEL?.trim() || undefined,
    llmMaxToken: parseOptionalPositiveInteger(source.LLM_MAXTOKEN),
    llmMaxIterations: parseOptionalPositiveInteger(source.LLM_MAX_ITERATIONS ?? source.MAX_ITERATIONS),
    llmMaxConsecutiveToolTurns: parseOptionalPositiveInteger(source.LLM_MAX_CONSECUTIVE_TOOL_TURNS),
    llmMaxWallTimeMs: parseOptionalPositiveInteger(source.LLM_MAX_WALL_TIME_MS),
    llmTemperature: parseOptionalNumber(source.LLM_TEMPERATURE),
    llmPermission: parseToolPermission(source.LLM_PERMISSION),
    llmReasoning: parseReasoningEffort(source.LLM_REASONING),
    openAiApiKey: source.OPENAI_API_KEY,
    azureOpenAiApiKey: source.AZURE_OPENAI_API_KEY,
    azureOpenAiResourceName: source.AZURE_OPENAI_RESOURCE_NAME?.trim() || undefined,
    azureOpenAiDeploymentName: source.AZURE_OPENAI_DEPLOYMENT_NAME?.trim() || undefined,
    azureOpenAiApiVersion: source.AZURE_OPENAI_API_VERSION?.trim() || undefined,
    googleApiKey: source.GOOGLE_API_KEY,
    anthropicApiKey: source.ANTHROPIC_API_KEY,
    openAiCompatibleApiKey: source.OPENAI_COMPATIBLE_API_KEY,
    openAiCompatibleBaseUrl: source.OPENAI_COMPATIBLE_BASE_URL?.trim() || undefined,
    apiAuthUrl: resolveApiAuthUrl(source),
    crmAllowedOrigins: parseDelimitedList(source.CRM_ALLOWED_ORIGINS),
    apiDataToolAllowedRoutes: parseDelimitedList(source.API_DATA_TOOL_ALLOWED_ROUTES)
  };
}
