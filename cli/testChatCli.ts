/*
 * Feature: executable entrypoint for the ai-workspace streaming test CLI.
 * Notes: loads CLI-only environment values before delegating to the reusable CLI implementation.
 * Recent changes: stopped reading Azure Functions local.settings.json from the CLI.
 */

import { loadCliEnv } from "./loadCliEnv.js";
import { runStreamingTestCli } from "./streamingTestCli.js";

loadCliEnv();

void runStreamingTestCli().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
