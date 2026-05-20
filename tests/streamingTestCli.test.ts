import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveCliOptions,
  streamAssistantTurn,
  type CliOptions
} from "../cli/streamingTestCli.ts";

function createWritableCapture(isTTY = false): {
  output: { isTTY: boolean; write: (chunk: string) => boolean };
  text: () => string;
} {
  let value = "";

  return {
    output: {
      isTTY,
      write(chunk: string) {
        value += chunk;
        return true;
      }
    },
    text() {
      return value;
    }
  };
}

function createSseResponse(events: Array<{ event: string; data: unknown }>): Response {
  const body = events.map(({ event, data }) => [
    `event: ${event}`,
    `data: ${JSON.stringify(data)}`,
    ""
  ].join("\n")).join("\n");

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream"
    }
  });
}

function createOptions(overrides: Partial<CliOptions> = {}): CliOptions {
  return {
    baseUrl: "http://localhost:7072",
    accessToken: "test-token",
    autoContinue: false,
    autoContinueMessage: "go ahead",
    autoContinueTurns: 1,
    traceMode: "default",
    ...overrides
  };
}

test("resolveCliOptions uses CRM chat defaults and bearer token env", () => {
  assert.deepEqual(resolveCliOptions([], {
    CHAT_BEARER_TOKEN: "token-1"
  }), {
    baseUrl: "http://localhost:7072",
    accessToken: "token-1",
    autoContinue: false,
    autoContinueMessage: "go ahead",
    autoContinueTurns: 1,
    traceMode: "default"
  });
});

test("streamAssistantTurn shows pending dots while waiting for response headers", async () => {
  const output = createWritableCapture(true);
  const errorOutput = createWritableCapture();
  const originalFetch = global.fetch;
  let resolveFetch: ((response: Response) => void) | undefined;

  global.fetch = (() => new Promise<Response>((resolve) => {
    resolveFetch = resolve;
  })) as typeof fetch;

  try {
    const turnPromise = streamAssistantTurn(
      createOptions(),
      [],
      "hello",
      output.output,
      errorOutput.output
    );

    assert.equal(output.text(), "...");

    resolveFetch?.(createSseResponse([
      {
        event: "message.delta",
        data: {
          type: "message.delta",
          text: "hi"
        }
      },
      {
        event: "message.done",
        data: {
          type: "message.done",
          message: {
            role: "assistant",
            content: "hi"
          }
        }
      },
      {
        event: "done",
        data: {}
      }
    ]));

    const result = await turnPromise;
    assert.equal(result.assistantText, "hi");
    assert.equal(output.text().includes("\r\u001b[2Khi\n"), true);
  } finally {
    global.fetch = originalFetch;
  }
});

test("streamAssistantTurn reports HTTP failures with status and body detail", async () => {
  const output = createWritableCapture(true);
  const errorOutput = createWritableCapture();
  const originalFetch = global.fetch;

  global.fetch = (async () => new Response(JSON.stringify({
    error: "workspace is misconfigured"
  }), {
    status: 500,
    statusText: "Internal Server Error",
    headers: {
      "Content-Type": "application/json"
    }
  })) as typeof fetch;

  try {
    await assert.rejects(
      streamAssistantTurn(createOptions(), [], "hello", output.output, errorOutput.output),
      /HTTP 500 Internal Server Error: workspace is misconfigured/
    );
    assert.equal(output.text(), "...\r\u001b[2K");
  } finally {
    global.fetch = originalFetch;
  }
});
