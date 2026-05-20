/*
 * Feature: interactive streaming test CLI for ai-workspace.
 * Notes: posts streaming chat requests to the local server, renders SSE deltas live, and keeps chat history in memory per process.
 * Recent changes: added compact tool-trace modes and human-input checkpoint rendering for interactive CLI turns.
 */

import { createInterface } from "node:readline/promises";
import { stdin, stdout, stderr } from "node:process";
import type { ChatMessage } from "../src/runtime/runtimeTypes.js";
import {
  formatToolEventLine,
  formatInlinePathExistsEventLine,
  formatToolResultEventLine,
  type TraceMode,
  renderToolCall,
  renderToolResult,
  summarizeToolCall,
  summarizeToolResult,
  type ToolCallView,
  type ToolResultView
} from "./toolTraceRenderer.js";

export type CliOptions = {
  baseUrl: string;
  accessToken?: string;
  autoContinue: boolean;
  autoContinueMessage: string;
  autoContinueTurns: number;
  traceMode: TraceMode;
};

export {
  formatToolEventLine,
  formatInlinePathExistsEventLine,
  formatToolResultEventLine,
  renderToolCall,
  renderToolResult,
  summarizeToolCall,
  summarizeToolResult
};

export type {
  TraceMode,
  ToolCallView,
  ToolResultView
};

export type ParsedSseEvent = {
  event: string;
  data: string;
};

export type StreamProgress = {
  assistantText: string;
  errorMessage?: string;
  warningMessages: string[];
  isComplete: boolean;
  isDone: boolean;
};

export type StreamTurnResult = {
  assistantText: string;
  sawToolActivity: boolean;
  warningMessages: string[];
  humanInputRequests: PendingHumanInputRequest[];
};

export type AutoContinueBudget = {
  remainingAutoTurns: number;
  remainingWarningGraceTurns: number;
};

type WritableLike = Pick<NodeJS.WriteStream, "write"> & {
  isTTY?: boolean;
};

type QuestionPrompt = {
  question(query: string): Promise<string>;
};

export type HumanInputSelectionType = "single-select" | "multiple-select";

export type HumanInputOption = {
  id: string;
  label: string;
  description?: string;
};

export type HumanInputQuestion = {
  header: string;
  id: string;
  question: string;
  options: HumanInputOption[];
  allowFreeformInput?: boolean;
};

export type PendingHumanInputRequest = {
  toolName: string;
  requestId: string;
  type: HumanInputSelectionType;
  allowSkip: boolean;
  questions: HumanInputQuestion[];
};

export type HumanInputSelection = {
  questionId: string;
  questionText?: string;
  skipped: boolean;
  selectedOptions: HumanInputOption[];
  enteredText?: string;
};

export type HumanInputAnswer = {
  requestId: string;
  selections: HumanInputSelection[];
};

export type HumanInputSelectionParseResult =
  | { ok: true; selection: HumanInputSelection }
  | { ok: false; error: string };

const WARNING_AUTO_CONTINUE_GRACE_TURNS = 2;
const EXIT_HUMAN_INPUT_TOKEN = "0";
const HUMAN_INPUT_TOOL_NAMES = new Set([
  "ask_user_input",
  "human_intervention_request",
  "ask_user_question"
]);

function readFlagValue(args: string[], flagName: string): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === flagName) {
      return args[index + 1];
    }

    if (arg?.startsWith(`${flagName}=`)) {
      return arg.slice(flagName.length + 1);
    }
  }

  return undefined;
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function readBooleanFlag(args: string[], flagName: string): boolean {
  return args.includes(flagName);
}

function resolveTraceMode(args: string[]): TraceMode {
  if (readBooleanFlag(args, "--debug")) {
    return "debug";
  }

  if (readBooleanFlag(args, "--verbose")) {
    return "verbose";
  }

  return "default";
}

function isTruthy(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? "");
}

function parseOptionalPositiveInteger(value: string | undefined): number | null {
  if (!value?.trim()) {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function formatGray(text: string, output: WritableLike): string {
  return output.isTTY ? `\u001b[90m${text}\u001b[0m` : text;
}

function createAssistantPendingDisplay(output: WritableLike): {
  start: () => void;
  clearPending: () => void;
  writeAssistantText: (text: string) => void;
  resumeAfterInterruption: (assistantText: string) => void;
  queueSpacerBeforeNextText: () => void;
  hasWrittenAssistantText: () => boolean;
} {
  const frames = [".", "..", "..."];
  let frameIndex = 2;
  let interval: NodeJS.Timeout | null = null;
  let pendingVisible = false;
  let assistantTextWritten = false;
  let spacerBeforeNextText = false;

  const writeFrame = (frame: string): void => {
    output.write(`\r\u001b[2K${frame}`);
  };

  const stopAnimation = (): void => {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
  };

  const start = (): void => {
    if (!output.isTTY || interval) {
      return;
    }

    pendingVisible = true;
    frameIndex = 2;
    output.write(frames[frameIndex] ?? "...");
    interval = setInterval(() => {
      frameIndex = (frameIndex + 1) % frames.length;
      writeFrame(frames[frameIndex] ?? "...");
    }, 250);
    interval.unref();
  };

  const clearPending = (): void => {
    stopAnimation();
    if (pendingVisible) {
      output.write("\r\u001b[2K");
      pendingVisible = false;
    }
  };

  const writeAssistantText = (text: string): void => {
    clearPending();
    if (text) {
      assistantTextWritten = true;
      const prefix = spacerBeforeNextText ? "\n" : "";
      spacerBeforeNextText = false;
      output.write(`${prefix}${text}`);
    }
  };

  const resumeAfterInterruption = (assistantText: string): void => {
    clearPending();
    if (assistantText) {
      assistantTextWritten = true;
      const prefix = spacerBeforeNextText ? "\n" : "";
      spacerBeforeNextText = false;
      output.write(`${prefix}${assistantText}`);
      return;
    }

    start();
  };

  const queueSpacerBeforeNextText = (): void => {
    spacerBeforeNextText = true;
  };

  return {
    start,
    clearPending,
    writeAssistantText,
    resumeAfterInterruption,
    queueSpacerBeforeNextText,
    hasWrittenAssistantText: () => assistantTextWritten
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readTrimmedString(record: Record<string, unknown>, fieldName: string): string | null {
  const value = record[fieldName];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function sanitizeHumanInputDisplayText(value: string): string {
  return value
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function readSanitizedHumanInputString(record: Record<string, unknown>, fieldName: string): string | null {
  const value = readTrimmedString(record, fieldName);
  if (!value) {
    return null;
  }

  const sanitized = sanitizeHumanInputDisplayText(value);
  return sanitized || null;
}

function parseHumanInputOption(value: unknown): HumanInputOption | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readTrimmedString(value, "id");
  const label = readSanitizedHumanInputString(value, "label");
  if (!id || !label) {
    return null;
  }

  const description = readSanitizedHumanInputString(value, "description");
  return {
    id,
    label,
    ...(description ? { description } : {})
  };
}

function parseHumanInputQuestion(value: unknown): HumanInputQuestion | null {
  if (!isRecord(value)) {
    return null;
  }

  const header = readSanitizedHumanInputString(value, "header");
  const id = readTrimmedString(value, "id");
  const question = readSanitizedHumanInputString(value, "question");
  if (!header || !id || !question || !Array.isArray(value.options)) {
    return null;
  }

  const options = value.options.map(parseHumanInputOption);
  if (options.some((option) => option === null)) {
    return null;
  }

  return {
    header,
    id,
    question,
    options: options as HumanInputOption[],
    ...(value.allowFreeformInput === false ? { allowFreeformInput: false } : {})
  };
}

function allowsFreeformInput(question: HumanInputQuestion): boolean {
  return question.allowFreeformInput !== false;
}

function normalizeHumanInputRequest(
  toolName: string,
  payload: unknown,
  fallbackRequestId: string,
  requirePendingArtifact: boolean
): PendingHumanInputRequest | null {
  if (!HUMAN_INPUT_TOOL_NAMES.has(toolName)) {
    return null;
  }

  const record = parseJsonRecord(payload);
  if (!record) {
    return null;
  }

  if (requirePendingArtifact && !(record.pending === true && record.status === "pending")) {
    return null;
  }

  const rawType = record.type;
  const type: HumanInputSelectionType = rawType === "multiple-select" ? "multiple-select" : "single-select";
  if (rawType !== undefined && rawType !== "single-select" && rawType !== "multiple-select") {
    return null;
  }

  if (!Array.isArray(record.questions) || record.questions.length === 0) {
    return null;
  }

  const questions = record.questions.map(parseHumanInputQuestion);
  if (questions.some((question) => question === null)) {
    return null;
  }

  return {
    toolName,
    requestId: readTrimmedString(record, "requestId") ?? fallbackRequestId,
    type,
    allowSkip: record.allowSkip === true,
    questions: questions as HumanInputQuestion[]
  };
}

export function parseHumanInputToolCall(
  toolName: string,
  args: unknown,
  fallbackRequestId = ""
): PendingHumanInputRequest | null {
  return normalizeHumanInputRequest(toolName, args, fallbackRequestId, false);
}

export function parsePendingHumanInputRequest(
  toolName: string,
  result: unknown,
  fallbackRequestId = ""
): PendingHumanInputRequest | null {
  return normalizeHumanInputRequest(toolName, result, fallbackRequestId, true);
}

export function shouldSuppressHumanInputToolEventLine(
  kind: "tool.call" | "tool.result",
  toolName: string,
  payload: unknown,
  fallbackRequestId = ""
): boolean {
  if (kind === "tool.call") {
    return parseHumanInputToolCall(toolName, payload, fallbackRequestId) !== null;
  }

  return parsePendingHumanInputRequest(toolName, payload, fallbackRequestId) !== null;
}

function humanInputRequestKey(request: PendingHumanInputRequest): string {
  const questionIds = request.questions.map((question) => question.id).join(",");
  return `${request.toolName}:${request.requestId}:${questionIds}`;
}

function appendHumanInputRequest(
  requests: PendingHumanInputRequest[],
  request: PendingHumanInputRequest | null
): void {
  if (!request) {
    return;
  }

  const key = humanInputRequestKey(request);
  if (!requests.some((existingRequest) => humanInputRequestKey(existingRequest) === key)) {
    requests.push(request);
  }
}

function resolveHumanInputOption(question: HumanInputQuestion, token: string): HumanInputOption | null {
  const index = Number(token);
  if (Number.isInteger(index) && index >= 1 && index <= question.options.length) {
    return question.options[index - 1] ?? null;
  }

  return question.options.find((option) => option.id === token) ?? null;
}

export function parseHumanInputSelection(
  question: HumanInputQuestion,
  selectionType: HumanInputSelectionType,
  allowSkip: boolean,
  rawInput: string
): HumanInputSelectionParseResult {
  const trimmedInput = rawInput.trim();
  if (!trimmedInput) {
    if (allowSkip) {
      return {
        ok: true,
        selection: {
          questionId: question.id,
          questionText: question.question,
          skipped: true,
          selectedOptions: []
        }
      };
    }

    return { ok: false, error: "Select an option before continuing." };
  }

  const tokens = trimmedInput.split(",").map((token) => token.trim()).filter(Boolean);
  if (selectionType === "single-select" && tokens.length !== 1) {
    if (allowsFreeformInput(question)) {
      return {
        ok: true,
        selection: {
          questionId: question.id,
          questionText: question.question,
          skipped: false,
          selectedOptions: [],
          enteredText: trimmedInput
        }
      };
    }

    return { ok: false, error: "Select exactly one option." };
  }

  const selectedOptions: HumanInputOption[] = [];
  for (const token of tokens) {
    const option = resolveHumanInputOption(question, token);
    if (!option) {
      if (allowsFreeformInput(question)) {
        return {
          ok: true,
          selection: {
            questionId: question.id,
            questionText: question.question,
            skipped: false,
            selectedOptions: [],
            enteredText: trimmedInput
          }
        };
      }

      return { ok: false, error: `Unknown option: ${token}` };
    }

    if (!selectedOptions.some((selectedOption) => selectedOption.id === option.id)) {
      selectedOptions.push(option);
    }
  }

  return {
    ok: true,
    selection: {
      questionId: question.id,
      questionText: question.question,
      skipped: false,
      selectedOptions
    }
  };
}

export function formatHumanInputCheckpoint(
  request: PendingHumanInputRequest,
  question: HumanInputQuestion
): string {
  const lines = ["assistant needs input:", `  ${question.question}`, ""];

  question.options.forEach((option, index) => {
    lines.push(`  ${index + 1}. ${option.label}`);
  });

  lines.push(`  ${EXIT_HUMAN_INPUT_TOKEN}. Exit UI`);

  if (request.allowSkip) {
    lines.push("", "  Press Enter to skip.");
  }

  return `${lines.join("\n")}\n`;
}

function writeHumanInputQuestion(
  output: WritableLike,
  request: PendingHumanInputRequest,
  question: HumanInputQuestion
): void {
  output.write(`\n${formatHumanInputCheckpoint(request, question)}`);
}

function createHumanInputPrompt(request: PendingHumanInputRequest, question: HumanInputQuestion): string {
  const selectionHint = question.options.length === 0
    ? "Type your answer"
    : request.type === "multiple-select"
      ? "Select numbers or option ids separated by commas"
      : "Select a number or option id";
  const freeformHint = allowsFreeformInput(question) ? ", or type a custom answer" : "";
  const skipHint = request.allowSkip ? ", or press Enter to skip" : "";
  return `${selectionHint}${freeformHint}${skipHint}. Enter ${EXIT_HUMAN_INPUT_TOKEN} to exit UI: `;
}

export async function collectHumanInputAnswers(
  requests: PendingHumanInputRequest[],
  prompt: QuestionPrompt,
  output: WritableLike
): Promise<HumanInputAnswer[] | null> {
  const answers: HumanInputAnswer[] = [];

  for (const request of requests) {
    const selections: HumanInputSelection[] = [];

    for (const question of request.questions) {
      writeHumanInputQuestion(output, request, question);

      while (true) {
        const rawSelection = await prompt.question(createHumanInputPrompt(request, question));
        if (rawSelection.trim() === EXIT_HUMAN_INPUT_TOKEN) {
          return null;
        }

        const parsedSelection = parseHumanInputSelection(
          question,
          request.type,
          request.allowSkip,
          rawSelection
        );

        if (parsedSelection.ok === true) {
          selections.push(parsedSelection.selection);
          break;
        }

        output.write(`${parsedSelection.error}\n`);
      }
    }

    answers.push({
      requestId: request.requestId,
      selections
    });
  }

  return answers;
}

export function formatHumanInputAnswerMessage(answers: HumanInputAnswer[]): string {
  const lines: string[] = [];

  for (const answer of answers) {
    for (const selection of answer.selections) {
      const questionLabel = selection.questionText
        ? `${selection.questionId} (${selection.questionText})`
        : selection.questionId;

      if (selection.skipped) {
        lines.push(`  - ${questionLabel}: skipped`);
        continue;
      }

      if (selection.enteredText) {
        lines.push(`  - ${questionLabel}: ${selection.enteredText}`);
        continue;
      }

      const optionIds = selection.selectedOptions.map((option) => option.id).join(", ");
      const optionLabels = selection.selectedOptions.map((option) => option.label).join(", ");
      lines.push(`  - ${questionLabel}: ${optionIds} (${optionLabels})`);
    }
  }

  return lines.join("\n");
}

export function writeQueuedHumanInputFollowUp(output: WritableLike, answerMessage: string): void {
  output.write(`${answerMessage}\n`);
}

export function isReadlineExitError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && ["ERR_USE_AFTER_CLOSE", "ABORT_ERR"].includes(String((error as { code?: unknown }).code));
}

export function resolveCliOptions(args: string[], env: NodeJS.ProcessEnv): CliOptions {
  const rawBaseUrl = readFlagValue(args, "--chat-base-url")
    ?? readFlagValue(args, "--url")
    ?? env.CHAT_BASE_URL
    ?? env.AI_WORKSPACE_BASE_URL
    ?? "http://localhost:7072";
  const rawAccessToken = readFlagValue(args, "--bearer-token")
    ?? readFlagValue(args, "--api-pat")
    ?? env.CHAT_BEARER_TOKEN
    ?? env.API_PAT;
  const rawAutoContinueMessage = readFlagValue(args, "--auto-continue-message")
    ?? env.AI_WORKSPACE_AUTO_CONTINUE_MESSAGE
    ?? "go ahead";
  const autoContinueTurns = parseOptionalPositiveInteger(
    readFlagValue(args, "--auto-continue-turns") ?? env.AI_WORKSPACE_AUTO_CONTINUE_TURNS
  ) ?? 1;

  return {
    baseUrl: trimTrailingSlashes(rawBaseUrl.trim()),
    accessToken: rawAccessToken?.trim() || undefined,
    autoContinue: readBooleanFlag(args, "--auto-continue") || isTruthy(env.AI_WORKSPACE_AUTO_CONTINUE),
    autoContinueMessage: rawAutoContinueMessage.trim() || "go ahead",
    autoContinueTurns,
    traceMode: resolveTraceMode(args)
  };
}

export function buildTurnMessages(history: ChatMessage[], userInput: string): ChatMessage[] {
  return [
    ...history,
    {
      role: "user",
      content: userInput
    }
  ];
}

export function commitTurn(history: ChatMessage[], userInput: string, assistantText: string): ChatMessage[] {
  return [
    ...history,
    {
      role: "user",
      content: userInput
    },
    {
      role: "assistant",
      content: assistantText
    }
  ];
}

function createHumanInputToolArguments(request: PendingHumanInputRequest): Record<string, unknown> {
  return {
    type: request.type,
    allowSkip: request.allowSkip,
    questions: request.questions
  };
}

export function createHumanInputAssistantMessage(request: PendingHumanInputRequest): ChatMessage {
  return {
    role: "assistant",
    content: "",
    tool_calls: [
      {
        id: request.requestId,
        type: "function",
        function: {
          name: request.toolName,
          arguments: JSON.stringify(createHumanInputToolArguments(request))
        }
      }
    ]
  };
}

export function commitHumanInputRequestTurn(
  history: ChatMessage[],
  userInput: string | null,
  requests: PendingHumanInputRequest[]
): ChatMessage[] {
  return [
    ...history,
    ...(userInput === null ? [] : [{ role: "user" as const, content: userInput }]),
    ...requests.map(createHumanInputAssistantMessage)
  ];
}

export function commitAssistantResponse(history: ChatMessage[], assistantText: string): ChatMessage[] {
  return [
    ...history,
    {
      role: "assistant",
      content: assistantText
    }
  ];
}

function createHumanInputAnswerPayload(answer: HumanInputAnswer): Record<string, unknown> {
  return {
    requestId: answer.requestId,
    answers: Object.fromEntries(
      answer.selections.map((selection) => [
        selection.questionId,
        selection.skipped ? null : selection.enteredText ?? selection.selectedOptions.map((option) => option.id)
      ])
    ),
    selections: answer.selections
  };
}

export function appendHumanInputAnswerMessages(
  history: ChatMessage[],
  requests: PendingHumanInputRequest[],
  answers: HumanInputAnswer[]
): ChatMessage[] {
  const requestsById = new Map(requests.map((request) => [request.requestId, request]));
  const answerMessages = answers.map((answer): ChatMessage => {
    const request = requestsById.get(answer.requestId);
    return {
      role: "tool",
      content: JSON.stringify(createHumanInputAnswerPayload(answer)),
      tool_call_id: answer.requestId,
      ...(request ? { name: request.toolName } : {})
    };
  });

  return [
    ...history,
    ...answerMessages
  ];
}

export function extractSseEventBlocks(buffer: string): { eventBlocks: string[]; remainder: string } {
  const eventBlocks: string[] = [];
  let cursor = 0;

  while (cursor < buffer.length) {
    const match = /\r?\n\r?\n/.exec(buffer.slice(cursor));
    if (!match) {
      break;
    }

    const boundaryIndex = cursor + (match.index ?? 0);
    eventBlocks.push(buffer.slice(cursor, boundaryIndex));
    cursor = boundaryIndex + match[0].length;
  }

  return {
    eventBlocks,
    remainder: buffer.slice(cursor)
  };
}

export function parseSseEventBlock(block: string): ParsedSseEvent | null {
  const lines = block.split(/\r?\n/);
  let event = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith(":")) {
      continue;
    }

    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
      continue;
    }

    if (line.startsWith("data:")) {
      const rawValue = line.slice(5);
      dataLines.push(rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue);
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return {
    event,
    data: dataLines.join("\n")
  };
}

export async function* readSseEvents(stream: ReadableStream<Uint8Array>): AsyncGenerator<ParsedSseEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();

    if (done) {
      buffer += decoder.decode();
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const { eventBlocks, remainder } = extractSseEventBlocks(buffer);
    buffer = remainder;

    for (const block of eventBlocks) {
      const event = parseSseEventBlock(block);
      if (event) {
        yield event;
      }
    }
  }

  if (buffer.trim()) {
    const event = parseSseEventBlock(buffer);
    if (event) {
      yield event;
    }
  }
}

function parseRuntimePayload<T>(event: ParsedSseEvent): T | null {
  try {
    return JSON.parse(event.data) as T;
  } catch {
    return null;
  }
}

export function applyStreamEvent(progress: StreamProgress, event: ParsedSseEvent): StreamProgress {
  if (event.event === "done") {
    return {
      ...progress,
      isDone: true
    };
  }

  if (event.event === "message.delta") {
    const payload = parseRuntimePayload<{ text?: unknown }>(event);
    if (typeof payload?.text !== "string") {
      return progress;
    }

    return {
      ...progress,
      assistantText: progress.assistantText + payload.text
    };
  }

  if (event.event === "message.done") {
    const payload = parseRuntimePayload<{ message?: { content?: unknown } }>(event);
    if (typeof payload?.message?.content !== "string") {
      return {
        ...progress,
        isComplete: true
      };
    }

    return {
      ...progress,
      assistantText: payload.message.content,
      isComplete: true
    };
  }

  if (event.event === "error") {
    const payload = parseRuntimePayload<{ error?: unknown }>(event);
    return {
      ...progress,
      errorMessage: typeof payload?.error === "string" ? payload.error : "Unknown runtime error"
    };
  }

  if (event.event === "warning") {
    const payload = parseRuntimePayload<{ warning?: unknown }>(event);
    if (typeof payload?.warning !== "string") {
      return progress;
    }

    return {
      ...progress,
      warningMessages: [...progress.warningMessages, payload.warning]
    };
  }

  return progress;
}

async function readErrorResponse(response: Response): Promise<string> {
  const responseText = await response.text();
  const statusLabel = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim();

  try {
    const payload = JSON.parse(responseText) as { error?: unknown; message?: unknown; details?: unknown };
    if (typeof payload.error === "string") {
      return `${statusLabel}: ${payload.error}`;
    }

    if (typeof payload.message === "string") {
      return `${statusLabel}: ${payload.message}`;
    }
  } catch {
    // Fall through to the raw body text.
  }

  const trimmedText = responseText.trim();
  if (!trimmedText) {
    return `${statusLabel}: empty response body`;
  }

  const bodyPreview = trimmedText.length > 1000
    ? `${trimmedText.slice(0, 1000)}...`
    : trimmedText;
  return `${statusLabel}${contentType ? ` (${contentType})` : ""}: ${bodyPreview}`;
}

export function shouldAutoContinue(assistantText: string, sawToolActivity: boolean): boolean {
  if (sawToolActivity) {
    return false;
  }

  const normalizedText = assistantText.trim();
  if (!normalizedText) {
    return false;
  }

  return /\b(i('|’)ll|i will)\b/i.test(normalizedText)
    || /\bbefore i proceed\b/i.test(normalizedText)
    || /\bwould you like me to\b/i.test(normalizedText)
    || /\bdo you want me to\b/i.test(normalizedText)
    || /\bshall i\b/i.test(normalizedText)
    || /\bshould i\b/i.test(normalizedText)
    || /\bif you'd like\b/i.test(normalizedText)
    || /\bif you want\b/i.test(normalizedText)
    || /\?$/.test(normalizedText);
}

export function consumeAutoContinueBudget(
  remainingAutoTurns: number,
  remainingWarningGraceTurns: number,
  warningMessages: string[]
): AutoContinueBudget | null {
  if (remainingAutoTurns > 0) {
    return {
      remainingAutoTurns: remainingAutoTurns - 1,
      remainingWarningGraceTurns
    };
  }

  if (warningMessages.length > 0 && remainingWarningGraceTurns > 0) {
    return {
      remainingAutoTurns,
      remainingWarningGraceTurns: remainingWarningGraceTurns - 1
    };
  }

  return null;
}

export async function streamAssistantTurn(
  options: CliOptions,
  history: ChatMessage[],
  userInput: string | null,
  output: WritableLike,
  errorOutput: WritableLike
): Promise<StreamTurnResult> {
  const messages = userInput === null ? history : buildTurnMessages(history, userInput);
  const assistantDisplay = createAssistantPendingDisplay(output);
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (options.accessToken) {
    headers.Authorization = `Bearer ${options.accessToken}`;
  }

  let progress: StreamProgress = {
    assistantText: "",
    warningMessages: [],
    isComplete: false,
    isDone: false
  };
  let sawToolActivity = false;
  const humanInputRequests: PendingHumanInputRequest[] = [];
  const pendingToolCalls = new Map<string, { name: string; args: unknown }>();

  assistantDisplay.start();

  try {
    const response = await fetch(`${options.baseUrl}/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        stream: true,
        messages
      })
    });

    if (!response.ok) {
      throw new Error(await readErrorResponse(response));
    }

    if (!response.body) {
      throw new Error("Streaming response body is missing");
    }

    for await (const event of readSseEvents(response.body)) {
      const previousText = progress.assistantText;
      progress = applyStreamEvent(progress, event);

      if (
        (event.event === "message.delta" || event.event === "message.done")
        && progress.assistantText.startsWith(previousText)
        && progress.assistantText.length > previousText.length
      ) {
        assistantDisplay.writeAssistantText(progress.assistantText.slice(previousText.length));
      }

      if (event.event === "tool.call") {
        sawToolActivity = true;
        const payload = parseRuntimePayload<{ name?: unknown; args?: unknown; toolCallId?: unknown }>(event);
        if (typeof payload?.name === "string") {
          const toolCallId = typeof payload.toolCallId === "string" ? payload.toolCallId : "";
          const inlinePathExists = payload.name === "path_exists"
            && toolCallId.length > 0
            && options.traceMode !== "debug";
          appendHumanInputRequest(
            humanInputRequests,
            parseHumanInputToolCall(
              payload.name,
              payload.args,
              toolCallId
            )
          );
          if (toolCallId.length > 0) {
            pendingToolCalls.set(toolCallId, {
              name: payload.name,
              args: payload.args
            });
          }
          if (!shouldSuppressHumanInputToolEventLine("tool.call", payload.name, payload.args, toolCallId)) {
            if (inlinePathExists) {
              continue;
            }
            assistantDisplay.clearPending();
            errorOutput.write(`${formatGray(formatToolEventLine("tool.call", payload.name, payload.args, options.traceMode), errorOutput)}`);
            assistantDisplay.queueSpacerBeforeNextText();
            if (progress.assistantText) {
              assistantDisplay.resumeAfterInterruption(progress.assistantText);
            }
          }
        }
      }

      if (event.event === "tool.result") {
        sawToolActivity = true;
        const payload = parseRuntimePayload<{ name?: unknown; args?: unknown; result?: unknown; toolCallId?: unknown; durationMs?: unknown }>(event);
        if (typeof payload?.name === "string") {
          const toolCallId = typeof payload.toolCallId === "string" ? payload.toolCallId : "";
          const pendingToolCall = toolCallId.length > 0 ? pendingToolCalls.get(toolCallId) : undefined;
          const inlinePathExistsArgs = payload.name === "path_exists"
            ? (pendingToolCall?.name === "path_exists"
              ? pendingToolCall.args
              : payload.args)
            : undefined;
          const toolCallArgs = typeof payload.args !== "undefined"
            ? payload.args
            : (pendingToolCall?.name === payload.name ? pendingToolCall.args : undefined);
          const toolDurationMs = typeof payload.durationMs === "number" && Number.isFinite(payload.durationMs)
            ? payload.durationMs
            : undefined;
          appendHumanInputRequest(
            humanInputRequests,
            parsePendingHumanInputRequest(
              payload.name,
              payload.result,
              toolCallId
            )
          );
          if (toolCallId.length > 0) {
            pendingToolCalls.delete(toolCallId);
          }
          if (!shouldSuppressHumanInputToolEventLine("tool.result", payload.name, payload.result, toolCallId)) {
            if (typeof inlinePathExistsArgs !== "undefined") {
              const inlineTrace = formatInlinePathExistsEventLine(
                inlinePathExistsArgs,
                payload.result,
                options.traceMode
              );
              if (inlineTrace) {
                assistantDisplay.clearPending();
                errorOutput.write(`${formatGray(inlineTrace, errorOutput)}`);
                assistantDisplay.queueSpacerBeforeNextText();
                if (progress.assistantText) {
                  assistantDisplay.resumeAfterInterruption(progress.assistantText);
                }
                continue;
              }
            }
            assistantDisplay.clearPending();
            if (!pendingToolCall) {
              errorOutput.write(`${formatGray(formatToolEventLine("tool.call", payload.name, toolCallArgs, options.traceMode), errorOutput)}`);
            }
            errorOutput.write(`${formatGray(formatToolResultEventLine(payload.name, payload.result, options.traceMode, toolCallArgs, toolDurationMs), errorOutput)}`);
            assistantDisplay.queueSpacerBeforeNextText();
            if (progress.assistantText) {
              assistantDisplay.resumeAfterInterruption(progress.assistantText);
            }
          }
        }
      }

      if (event.event === "warning") {
        const payload = parseRuntimePayload<{ warning?: unknown }>(event);
        if (typeof payload?.warning === "string") {
          assistantDisplay.clearPending();
          errorOutput.write(`${formatGray(`\n[warning] ${payload.warning}\n`, errorOutput)}`);
          assistantDisplay.queueSpacerBeforeNextText();
        }
      }

      if (progress.isDone) {
        break;
      }
    }
  } finally {
    assistantDisplay.clearPending();
  }

  if (assistantDisplay.hasWrittenAssistantText()) {
    output.write("\n");
  }

  if (progress.errorMessage) {
    throw new Error(progress.errorMessage);
  }

  if (!progress.assistantText.trim() && !progress.isComplete && humanInputRequests.length === 0) {
    throw new Error("Stream ended before an assistant response was completed");
  }

  return {
    assistantText: progress.assistantText,
    sawToolActivity,
    warningMessages: progress.warningMessages,
    humanInputRequests
  };
}

export async function runStreamingTestCli(args = process.argv.slice(2)): Promise<void> {
  const options = resolveCliOptions(args, process.env);
  if (!options.accessToken) {
    throw new Error("CLI auth token is required. Set API_PAT or CHAT_BEARER_TOKEN in cli/.env.");
  }

  const readline = createInterface({
    input: stdin,
    output: stdout
  });
  let history: ChatMessage[] = [];

  stdout.write(`Streaming test CLI connected to ${options.baseUrl}\n`);
  if (options.autoContinue) {
    stdout.write(`Auto-continue: ${options.autoContinueMessage} (${options.autoContinueTurns} max per prompt)\n`);
  }
  stdout.write("Commands: /clear to reset history, /exit to quit\n\n");

  try {
    while (true) {
      let input = "";

      try {
        input = (await readline.question("> ")).trim();
      } catch (error) {
        if (isReadlineExitError(error)) {
          stdout.write("\n");
          break;
        }

        throw error;
      }

      if (!input) {
        continue;
      }

      if (input === "/exit" || input === "/quit") {
        break;
      }

      if (input === "/clear") {
        history = [];
        stdout.write("history cleared\n\n");
        continue;
      }

      try {
        let nextInput: string | null = input;
        let remainingAutoTurns = options.autoContinue ? options.autoContinueTurns : 0;
        let remainingWarningGraceTurns = options.autoContinue ? WARNING_AUTO_CONTINUE_GRACE_TURNS : 0;

        while (true) {
          const result = await streamAssistantTurn(options, history, nextInput, stdout, stderr);
          if (result.humanInputRequests.length > 0) {
            history = commitHumanInputRequestTurn(history, nextInput, result.humanInputRequests);
          } else if (nextInput === null) {
            history = commitAssistantResponse(history, result.assistantText);
          } else {
            history = commitTurn(history, nextInput, result.assistantText);
          }
          stdout.write("\n");

          if (result.humanInputRequests.length > 0) {
            const answers = await collectHumanInputAnswers(result.humanInputRequests, readline, stdout);
            if (answers === null) {
              stdout.write("exiting\n");
              return;
            }

            history = appendHumanInputAnswerMessages(history, result.humanInputRequests, answers);
            writeQueuedHumanInputFollowUp(stdout, formatHumanInputAnswerMessage(answers));
            nextInput = null;
            continue;
          }

          if (!shouldAutoContinue(result.assistantText, result.sawToolActivity)) {
            break;
          }

          const nextBudget = consumeAutoContinueBudget(
            remainingAutoTurns,
            remainingWarningGraceTurns,
            result.warningMessages
          );
          if (!nextBudget) {
            break;
          }

          remainingAutoTurns = nextBudget.remainingAutoTurns;
          remainingWarningGraceTurns = nextBudget.remainingWarningGraceTurns;
          nextInput = options.autoContinueMessage;
          stdout.write(formatGray(`[auto] > ${nextInput}\n`, stdout));
        }

        stdout.write("\n");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        stderr.write(`request failed: ${message}\n\n`);
      }
    }
  } finally {
    readline.close();
  }
}
