/*
 * Feature: per-request llm-runtime orchestration for workspace-aware chat completion.
 * Notes: appends workspace AGENTS.md to the server system prompt, delegates built-ins to llm-runtime, and emits a unified event stream for SSE and JSON callers.
 * Recent changes: migrated into the Azure Functions app without AIW storage tools.
 */

import {
  createRuntime,
  type LLMChatMessage,
  type LLMRuntime,
  type LLMToolCall
} from "llm-runtime";
import type { EnvConfig } from "../config/env.js";
import {
  buildRuntimeMessages,
  createBuiltInSelection,
  createEnvironmentOptions,
  resolveMaxIterations,
  resolveMaxTokens,
  resolveTemperature,
  resolveRuntimeTarget
} from "./runtimeConfig.js";
import type { ChatMessage, RunChatCompletionInput, RuntimeEvent } from "./runtimeTypes.js";
import { resolveWorkspaceRoot } from "../workspace/resolveWorkspace.js";

type RuntimeState = {
  messages: LLMChatMessage[];
  finalMessage?: LLMChatMessage;
  finalText: string;
  stoppedForHumanInput: boolean;
};

const REJECTED_TEXT_RETRY_LIMIT = 2;
const DEFAULT_MAX_ITERATIONS = 24;
const DEFAULT_MAX_CONSECUTIVE_TOOL_TURNS = 24;
const DEFAULT_MAX_WALL_TIME_MS = 15 * 60 * 1000;

function createRejectedTextTerminalError(reason: string): string {
  if (reason === "rejected_text_response") {
    return "llm-runtime rejected repeated text responses without verified tool evidence or a final answer";
  }

  return `llm-runtime stopped without producing a final assistant message (${reason})`;
}

type AsyncEventQueue<T> = {
  push: (value: T) => void;
  close: () => void;
  iterator: AsyncIterable<T>;
};

function createAsyncEventQueue<T>(): AsyncEventQueue<T> {
  const values: T[] = [];
  const waiters: Array<(result: IteratorResult<T>) => void> = [];
  let closed = false;

  const iterator: AsyncIterable<T> = {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<T>> {
          if (values.length > 0) {
            return Promise.resolve({ value: values.shift() as T, done: false });
          }

          if (closed) {
            return Promise.resolve({ value: undefined, done: true });
          }

          return new Promise((resolve) => {
            waiters.push(resolve);
          });
        }
      };
    }
  };

  return {
    push(value) {
      if (closed) {
        return;
      }

      const waiter = waiters.shift();
      if (waiter) {
        waiter({ value, done: false });
        return;
      }

      values.push(value);
    },
    close() {
      if (closed) {
        return;
      }

      closed = true;
      while (waiters.length > 0) {
        const waiter = waiters.shift();
        waiter?.({ value: undefined, done: true });
      }
    },
    iterator
  };
}

function safeParseToolArguments(rawArguments: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawArguments);
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function safeSerializeToolResult(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }

  try {
    return JSON.stringify(result ?? null);
  } catch {
    return JSON.stringify({ error: "Tool result could not be serialized" });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const HUMAN_INPUT_TOOL_NAMES = new Set([
  "ask_user_input",
  "human_intervention_request",
  "ask_user_question"
]);

export function isPendingHumanInputToolResult(toolName: string, result: unknown): boolean {
  if (!HUMAN_INPUT_TOOL_NAMES.has(toolName) || !isRecord(result)) {
    return false;
  }

  return result.pending === true && result.status === "pending";
}

function isSensitiveEnvName(name: string): boolean {
  return /(^|_)(AUTH|BEARER|CREDENTIAL|KEY|PASS|PASSWORD|SECRET|TOKEN|SECURITY_CONTEXT)(_|$)/i.test(name);
}

function redactKnownSecretValues(value: string, envSource: NodeJS.ProcessEnv): string {
  let redactedValue = value;

  const secretEntries = Object.entries(envSource)
    .filter((entry): entry is [string, string] => {
      const [envName, envValue] = entry;
      return !!envValue && envValue.length >= 4 && isSensitiveEnvName(envName);
    })
    .sort((left, right) => right[1].length - left[1].length);

  for (const [envName, envValue] of secretEntries) {
    redactedValue = redactedValue.split(envValue).join(`[redacted:$${envName}]`);
  }

  return redactedValue;
}

export function redactToolResultForEvent(result: unknown, envSource: NodeJS.ProcessEnv = process.env): unknown {
  if (typeof result === "string") {
    return redactKnownSecretValues(result, envSource);
  }

  if (Array.isArray(result)) {
    return result.map((entry) => redactToolResultForEvent(entry, envSource));
  }

  if (isRecord(result)) {
    return Object.fromEntries(
      Object.entries(result).map(([key, entry]) => [key, redactToolResultForEvent(entry, envSource)])
    );
  }

  return result;
}

function expandEnvReferences(value: string, envSource: NodeJS.ProcessEnv, redactSecrets: boolean): string {
  const expandedValue = value.replace(/\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g, (match, bracedName: string | undefined, bareName: string | undefined) => {
    const envName = bracedName ?? bareName;
    if (!envName) {
      return match;
    }

    const envValue = envSource[envName];
    if (envValue === undefined) {
      return match;
    }

    if (redactSecrets && isSensitiveEnvName(envName)) {
      return `[redacted:$${envName}]`;
    }

    return envValue;
  });

  return redactSecrets ? redactKnownSecretValues(expandedValue, envSource) : expandedValue;
}

function mapShellCommandValue(value: unknown, envSource: NodeJS.ProcessEnv, redactSecrets: boolean): unknown {
  if (typeof value === "string") {
    return expandEnvReferences(value, envSource, redactSecrets);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => mapShellCommandValue(entry, envSource, redactSecrets));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, mapShellCommandValue(entry, envSource, redactSecrets)])
    );
  }

  return value;
}

export function prepareToolCallArguments(
  toolName: string,
  parsedArgs: Record<string, unknown>,
  envSource: NodeJS.ProcessEnv = process.env
): { executionArgs: Record<string, unknown>; eventArgs: Record<string, unknown> } {
  if (toolName !== "shell_cmd") {
    return {
      executionArgs: parsedArgs,
      eventArgs: parsedArgs
    };
  }

  return {
    executionArgs: mapShellCommandValue(parsedArgs, envSource, false) as Record<string, unknown>,
    eventArgs: mapShellCommandValue(parsedArgs, envSource, true) as Record<string, unknown>
  };
}

function parseToolCallEventArgs(toolCall: LLMToolCall): { executionArgs: Record<string, unknown>; eventArgs: Record<string, unknown> } {
  return prepareToolCallArguments(
    toolCall.function.name,
    safeParseToolArguments(toolCall.function.arguments)
  );
}

function isHumanInputToolName(toolName: string): boolean {
  return HUMAN_INPUT_TOOL_NAMES.has(toolName);
}

export async function* runChatCompletion(
  input: RunChatCompletionInput,
  env: EnvConfig
): AsyncIterable<RuntimeEvent> {
  let environment: LLMRuntime | undefined;
  const toolStartedAt = new Map<string, number>();

  try {
    const requestEnv = { ...process.env };

    if (input.accessToken) {
      requestEnv.API_ACCESS_TOKEN = input.accessToken;
    }

    const agentsMd = input.agentsMd ?? null;
    const workingDirectory = resolveWorkspaceRoot(input.workspaceRoot);
    const builtIns = createBuiltInSelection();
    const runtimeTarget = resolveRuntimeTarget(input, env);
    environment = createRuntime(createEnvironmentOptions(env, input.workspaceRoot));
    const maxIterations = resolveMaxIterations(env) ?? DEFAULT_MAX_ITERATIONS;

    for await (const event of environment.streamComplete({
      provider: runtimeTarget.provider,
      model: runtimeTarget.model,
      messages: buildRuntimeMessages(input.messages as ChatMessage[], agentsMd),
      temperature: resolveTemperature(input, env),
      maxTokens: resolveMaxTokens(input, env),
      maxIterations,
      maxConsecutiveToolTurns: env.llmMaxConsecutiveToolTurns ?? DEFAULT_MAX_CONSECUTIVE_TOOL_TURNS,
      maxWallTimeMs: env.llmMaxWallTimeMs ?? DEFAULT_MAX_WALL_TIME_MS,
      builtIns,
      extraTools: [],
      defaultTextResponseMode: "require_tool_result",
      rejectedTextRetryLimit: REJECTED_TEXT_RETRY_LIMIT,
      context: {
        workingDirectory,
        abortSignal: input.signal,
        toolPermission: environment.defaults.toolPermission,
        reasoningEffort: environment.defaults.reasoningEffort
      }
    })) {
      if (event.type === "assistant_message") {
        for (const toolCall of event.message.tool_calls ?? []) {
          if (!isHumanInputToolName(toolCall.function.name)) {
            continue;
          }

          const preparedArgs = prepareToolCallArguments(
            toolCall.function.name,
            safeParseToolArguments(toolCall.function.arguments),
            requestEnv
          );
          yield {
            type: "tool.call",
            name: toolCall.function.name,
            args: preparedArgs.eventArgs,
            toolCallId: toolCall.id
          };
        }
      }

      if (event.type === "text_delta" && input.stream && event.delta) {
        yield {
          type: "message.delta",
          text: event.delta
        };
      }

      if (event.type === "tool_start") {
        const preparedArgs = prepareToolCallArguments(
          event.toolCall.function.name,
          safeParseToolArguments(event.toolCall.function.arguments),
          requestEnv
        );

        toolStartedAt.set(event.toolCall.id, Date.now());

        yield {
          type: "tool.call",
          name: event.toolCall.function.name,
          args: preparedArgs.eventArgs,
          toolCallId: event.toolCall.id
        };
      }

      if (event.type === "tool_result") {
        const preparedArgs = prepareToolCallArguments(
          event.toolCall.function.name,
          safeParseToolArguments(event.toolCall.function.arguments),
          requestEnv
        );
        const startedAt = toolStartedAt.get(event.toolCall.id);
        const durationMs = typeof startedAt === "number"
          ? Math.max(0, Date.now() - startedAt)
          : undefined;
        toolStartedAt.delete(event.toolCall.id);

        yield {
          type: "tool.result",
          name: event.toolCall.function.name,
          args: preparedArgs.eventArgs,
          toolCallId: event.toolCall.id,
          durationMs,
          result: redactToolResultForEvent(event.result, requestEnv)
        };
      }

      if (event.type === "tool_error") {
        const preparedArgs = prepareToolCallArguments(
          event.toolCall.function.name,
          safeParseToolArguments(event.toolCall.function.arguments),
          requestEnv
        );
        const startedAt = toolStartedAt.get(event.toolCall.id);
        const durationMs = typeof startedAt === "number"
          ? Math.max(0, Date.now() - startedAt)
          : undefined;
        toolStartedAt.delete(event.toolCall.id);

        yield {
          type: "tool.result",
          name: event.toolCall.function.name,
          args: preparedArgs.eventArgs,
          toolCallId: event.toolCall.id,
          durationMs,
          result: { error: event.error }
        };
      }

      if (event.type === "completed") {
        const content = event.result.output ?? "";
        yield {
          type: "message.done",
          message: {
            role: "assistant",
            content
          }
        };
      }

      if (event.type === "failed") {
        yield {
          type: "error",
          error: event.result.error ?? createRejectedTextTerminalError(event.result.status)
        };
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown llm-runtime error";
    yield {
      type: "error",
      error: message
    };
  } finally {
    if (environment) {
      await environment.dispose().catch(() => undefined);
    }
  }
}
