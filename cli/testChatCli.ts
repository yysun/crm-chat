/*
 * Feature: executable entrypoint for the ai-workspace streaming test CLI.
 * Notes: delegates to the reusable CLI implementation so the entrypoint stays tiny and build-friendly.
 * Recent changes: added a developer-facing command for interactive streamed chat testing.
 */

import { loadLocalSettings } from "./loadLocalSettings.js";
import { runStreamingTestCli } from "./streamingTestCli.js";

loadLocalSettings();

void runStreamingTestCli().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
