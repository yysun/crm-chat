/*
 * Feature: AGENTS.md loader for workspace instruction enrichment.
 * Notes: supports one-time startup loading and tolerant missing-file behavior.
 * Recent changes: added startup cache metadata so the server can log the resolved AGENTS.md path once and reuse the content for chat requests.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

export type LoadedAgentsMd = {
  path: string;
  content: string | null;
};

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

export function resolveAgentsMdPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, "AGENTS.md");
}

export async function loadAgentsMdCache(workspaceRoot: string): Promise<LoadedAgentsMd> {
  const agentsPath = resolveAgentsMdPath(workspaceRoot);

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

export async function loadAgentsMd(workspaceRoot: string): Promise<string | null> {
  const loaded = await loadAgentsMdCache(workspaceRoot);
  return loaded.content;
}