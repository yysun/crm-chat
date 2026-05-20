/*
 * Feature: llm-runtime request configuration helpers for ai-workspace.
 * Notes: resolves provider/model selection, runtime defaults, and the server system prompt with appended workspace AGENTS.md content.
 * Recent changes: makes provider/model and sampling policy server-owned for normal chat callers.
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
  const configuredProviders = configuredProvidersFromEnv(env);
  const provider = env.llmProvider ?? configuredProviders[0] ?? "openai";
  const model = env.llmModel ?? fallbackModelForProvider(provider);

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
  return env.llmMaxToken;
}

export function resolveMaxIterations(env: EnvConfig): number | undefined {
  return env.llmMaxIterations ?? env.llmMaxConsecutiveToolTurns;
}

export function resolveTemperature(input: RunChatCompletionInput, env: EnvConfig): number | undefined {
  return env.llmTemperature;
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
