/*
 * Feature: llm-runtime request configuration helpers for ai-workspace.
 * Notes: resolves provider/model selection, runtime defaults, and the server system prompt with appended workspace AGENTS.md content.
 * Recent changes: disables shell and file-system built-ins.
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

const SUPPORTED_PROVIDERS: LLMProviderName[] = ["openai", "anthropic", "google", "azure", "openai-compatible"];

const DEFAULT_SYSTEM_PROMPT = [
  "You are a workspace agent running inside ai-workspace.",
  "Help the user using the messages and context provided in the request.",
  "Do not claim to inspect local files, configuration, environment variables, logs, generated outputs, or repository state.",
  "When a task depends on domain-specific instructions, procedures, or API contracts in the workspace, follow the workspace instructions that were loaded from AGENTS.md.",
  "Ask for clarification when required information is missing or the user requests a destructive, modifying, external, or irreversible action.",
  "Do not reveal secret values."
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
    shell_cmd: false,
    web_fetch: false,
    load_skill: false,
    ask_user_input: true,
    read_file: false,
    write_file: false,
    list_files: false,
    search_files: false,
    create_directory: false,
    path_exists: false
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

export function composeSystemPrompt(agentsMd: string | null | undefined): string {
  const sections = [DEFAULT_SYSTEM_PROMPT];

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
  agentsMd: string | null
): LLMChatMessage[] {
  return [
    {
      role: "system",
      content: composeSystemPrompt(agentsMd)
    },
    ...toLlmMessages(messages)
  ];
}
