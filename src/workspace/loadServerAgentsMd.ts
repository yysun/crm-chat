/*
 * Feature: server-agents.md loader for workspace instruction enrichment.
 * Notes: supports cacheable loading and tolerant missing-file behavior.
 * Recent changes: switched the chat server contract from AGENTS.md to server-agents.md.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

export type LoadedServerAgentsMd = {
  path: string;
  content: string | null;
};

const SERVER_AGENTS_FILE_NAME = "server-agents.md";

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

export function resolveServerAgentsMdPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, SERVER_AGENTS_FILE_NAME);
}

export async function loadServerAgentsMdWithPath(workspaceRoot: string): Promise<LoadedServerAgentsMd> {
  const agentsPath = resolveServerAgentsMdPath(workspaceRoot);

  try {
    return {
      path: agentsPath,
      content: await readFile(agentsPath, "utf8")
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        path: agentsPath,
        content: null
      };
    }

    throw error;
  }
}

export async function loadServerAgentsMd(workspaceRoot: string): Promise<string | null> {
  const loaded = await loadServerAgentsMdWithPath(workspaceRoot);
  return loaded.content;
}
