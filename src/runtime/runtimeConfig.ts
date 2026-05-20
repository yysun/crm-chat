/*
 * Feature: llm-runtime request configuration helpers for ai-workspace.
 * Notes: resolves provider/model selection, runtime defaults, and the server system prompt with appended workspace AGENTS.md content.
 * Recent changes: migrated without AIW storage tools, so llm-runtime file built-ins stay enabled.
 */

import type {
  BuiltInToolSelection,
  LLMChatMessage,
  LLMEnvironmentOptions,
  LLMProviderConfigs,
  LLMProviderName,
  ReasoningEffort,
  ToolPermission
} from "llm-runtime";
import type { EnvConfig } from "../config/env.js";
import type { ChatMessage, ResolvedRuntimeTarget, RunChatCompletionInput } from "./runtimeTypes.js";
import { sanitizeUserIdForPath } from "../workspace/resolveWorkspace.js";

const SUPPORTED_PROVIDERS: LLMProviderName[] = ["openai", "anthropic", "google", "azure", "openai-compatible"];

type RuntimeUserContext = {
  userId: string;
};

const DEFAULT_SYSTEM_PROMPT = [
  "You are a workspace agent running inside ai-workspace.",
  "Help the user by inspecting the workspace, using available tools when needed, and answering from the files and context you can access.",
  "Prefer workspace evidence over speculation whenever the answer depends on files, configuration, environment variables, logs, generated outputs, or repository state.",
  "For read-only tasks such as inspecting, searching, summarizing, and analyzing workspace content, proceed without asking for confirmation.",
  "Use available read-only tools before asking the user for information that may already exist in the workspace.",
  "When a task depends on domain-specific instructions, procedures, or API contracts in the workspace, follow the workspace instructions that were loaded from AGENTS.md.",
  "Before claiming workspace-local credentials, configuration, files, or other prerequisites are unavailable, inspect likely sources such as `.env`, project files, and related workspace artifacts when appropriate.",
  "If an external API or network lookup is required, use an available tool instead of narrating intent.",
  "Prefer `shell_cmd` for authenticated API work only when workspace instructions explicitly require `curl`; prefer `web_fetch` for simple unauthenticated HTTP or HTTPS fetches.",
  "When using `shell_cmd`, workspace environment references such as `$NAME` and `${NAME}` in command arguments are resolved by the runtime for execution; secret values are redacted from tool event output.",
  "Do not claim you lack access to workspace information unless a tool result or runtime constraint actually shows that access is unavailable.",
  "Ask for clarification only when required information is still missing after inspection or the user requests a destructive, modifying, external, or irreversible action.",
  "Do not reveal secret values unless the user explicitly asks to inspect the file contents; otherwise report only presence, absence, or other non-sensitive metadata."
].join(" ");

function isProviderName(value: string): value is LLMProviderName {
  return SUPPORTED_PROVIDERS.includes(value as LLMProviderName);
}

function configuredProvidersFromEnv(env: EnvConfig): LLMProviderName[] {
  const providers: LLMProviderName[] = [];

  if (env.openAiApiKey) {
    providers.push("openai");
  }

  if (env.azureOpenAiApiKey && env.azureOpenAiResourceName && env.azureOpenAiDeploymentName) {
    providers.push("azure");
  }

  if (env.anthropicApiKey) {
    providers.push("anthropic");
  }

  if (env.googleApiKey) {
    providers.push("google");
  }

  if (env.openAiCompatibleApiKey && env.openAiCompatibleBaseUrl) {
    providers.push("openai-compatible");
  }

  return providers;
}

function parseProviderPrefixedModel(model: string | undefined): ResolvedRuntimeTarget | null {
  if (!model) {
    return null;
  }

  const matched = model.match(/^([a-z-]+)[:/](.+)$/i);
  if (!matched) {
    return null;
  }

  const provider = matched[1].toLowerCase();
  const resolvedModel = matched[2].trim();
  if (!isProviderName(provider) || !resolvedModel) {
    return null;
  }

  return {
    provider,
    model: resolvedModel
  };
}

function getMetadataProvider(metadata: Record<string, unknown> | undefined): LLMProviderName | null {
  const provider = metadata?.provider;
  return typeof provider === "string" && isProviderName(provider) ? provider : null;
}

function fallbackModelForProvider(provider: LLMProviderName): string {
  switch (provider) {
    case "azure":
      return "gpt-4.1-mini";
    case "openai-compatible":
      return "gpt-4.1-mini";
    case "anthropic":
      return "claude-sonnet-4-20250514";
    case "google":
      return "gemini-2.5-flash";
    case "openai":
    default:
      return "gpt-4.1-mini";
  }
}

export function createProviderConfigs(env: EnvConfig): LLMProviderConfigs {
  return {
    ...(env.openAiApiKey ? { openai: { apiKey: env.openAiApiKey } } : {}),
    ...(env.azureOpenAiApiKey && env.azureOpenAiResourceName && env.azureOpenAiDeploymentName
      ? {
        azure: {
          apiKey: env.azureOpenAiApiKey,
          resourceName: env.azureOpenAiResourceName,
          deployment: env.azureOpenAiDeploymentName,
          ...(env.azureOpenAiApiVersion ? { apiVersion: env.azureOpenAiApiVersion } : {})
        }
      }
      : {}),
    ...(env.anthropicApiKey ? { anthropic: { apiKey: env.anthropicApiKey } } : {}),
    ...(env.openAiCompatibleApiKey && env.openAiCompatibleBaseUrl
      ? { "openai-compatible": { apiKey: env.openAiCompatibleApiKey, baseUrl: env.openAiCompatibleBaseUrl } }
      : {}),
    ...(env.googleApiKey ? { google: { apiKey: env.googleApiKey } } : {})
  };
}

export function createEnvironmentOptions(env: EnvConfig, workspaceRoot: string): LLMEnvironmentOptions {
  return {
    providers: createProviderConfigs(env),
    defaults: {
      reasoningEffort: env.llmReasoning,
      toolPermission: env.llmPermission
    }
  };
}

export function resolveRuntimeTarget(input: RunChatCompletionInput, env: EnvConfig): ResolvedRuntimeTarget {
  const prefixedModel = parseProviderPrefixedModel(input.model);
  const metadataProvider = getMetadataProvider(input.metadata);

  if (prefixedModel && metadataProvider && prefixedModel.provider !== metadataProvider) {
    throw new Error("Request provider is ambiguous between metadata.provider and model prefix");
  }

  if (prefixedModel) {
    return prefixedModel;
  }

  const configuredProviders = configuredProvidersFromEnv(env);
  const provider = metadataProvider ?? env.llmProvider ?? configuredProviders[0] ?? "openai";
  const model = !input.model || input.model === "default"
    ? env.llmModel ?? fallbackModelForProvider(provider)
    : input.model;

  return {
    provider,
    model
  };
}

export function createBuiltInSelection(): BuiltInToolSelection {
  return {
    shell_cmd: true,
    web_fetch: false,
    load_skill: false,
    ask_user_input: true,
    read_file: true,
    write_file: true,
    list_files: true,
    search_files: true,
    create_directory: true,
    path_exists: true
  };
}

export function resolveMaxTokens(input: RunChatCompletionInput, env: EnvConfig): number | undefined {
  return input.maxTokens ?? env.llmMaxToken;
}

export function resolveMaxIterations(env: EnvConfig): number | undefined {
  return env.llmMaxIterations ?? env.llmMaxConsecutiveToolTurns;
}

export function resolveTemperature(input: RunChatCompletionInput, env: EnvConfig): number | undefined {
  return input.temperature ?? env.llmTemperature;
}

export function describeRuntimeDefaults(env: EnvConfig): {
  provider: LLMProviderName | "auto";
  model: string | "provider-fallback";
  maxToken: number | null;
  temperature: number | null;
  permission: ToolPermission;
  reasoning: ReasoningEffort;
} {
  return {
    provider: env.llmProvider ?? "auto",
    model: env.llmModel ?? "provider-fallback",
    maxToken: env.llmMaxToken ?? null,
    temperature: env.llmTemperature ?? null,
    permission: env.llmPermission,
    reasoning: env.llmReasoning
  };
}

export function composeSystemPrompt(
  agentsMd: string | null | undefined,
  runtimeUserContext?: RuntimeUserContext
): string {
  const sections = [DEFAULT_SYSTEM_PROMPT];

  if (runtimeUserContext) {
    const userRoot = `users/${sanitizeUserIdForPath(runtimeUserContext.userId)}`;
    sections.push([
      "Runtime user context:",
      `- User ID: ${runtimeUserContext.userId}`,
      `- User Root: ${userRoot}`
    ].join("\n"));
  }

  if (agentsMd?.trim()) {
    sections.push(`Additional workspace instructions:\n${agentsMd.trim()}`);
  }

  return sections.join("\n\n");
}

function toLlmMessages(messages: ChatMessage[]): LLMChatMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    ...(message.name ? { name: message.name } : {}),
    ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
    ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {})
  }));
}

export function buildRuntimeMessages(
  messages: ChatMessage[],
  agentsMd: string | null,
  runtimeUserContext?: RuntimeUserContext
): LLMChatMessage[] {
  return [
    {
      role: "system",
      content: composeSystemPrompt(agentsMd, runtimeUserContext)
    },
    ...toLlmMessages(messages)
  ];
}
