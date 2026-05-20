/*
 * Feature: shared runtime and API types for ai-workspace chat execution.
 * Notes: defines request and event contracts for the server-owned HTTP layer around llm-runtime.
 * Recent changes: removed normal client control over runtime provider/model and sampling policy.
 */

import type { LLMProviderName, LLMToolCall } from "llm-runtime";

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
  name?: string;
  tool_calls?: LLMToolCall[];
  tool_call_id?: string;
};

export type ChatCompletionRequest = {
  messages: ChatMessage[];
  stream?: boolean;
};

export type RunChatCompletionInput = {
  messages: ChatMessage[];
  stream: boolean;
  userId: string;
  workspaceRoot: string;
  agentsMd?: string | null;
  accessToken?: string;
  signal?: AbortSignal;
};

export type RuntimeEvent =
  | { type: "message.delta"; text: string }
  | { type: "message.done"; message: { role: "assistant"; content: string } }
  | { type: "tool.call"; name: string; args: unknown; toolCallId?: string }
  | { type: "tool.result"; name: string; args?: unknown; result: unknown; toolCallId?: string; durationMs?: number }
  | { type: "warning"; warning: string; code: "assistant_text_rejected_without_evidence" }
  | { type: "error"; error: string };

export type ResolvedRuntimeTarget = {
  provider: LLMProviderName;
  model: string;
};
