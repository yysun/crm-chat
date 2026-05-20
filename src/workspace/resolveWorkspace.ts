/*
 * Feature: workspace root resolution for request-time runtime access.
 * Notes: centralizes absolute path normalization for the mounted workspace root.
 * Recent changes: restored the workspace root helper after the runtime refactor.
 */

import path from "node:path";

export function resolveWorkspaceRoot(workspaceRoot: string | undefined): string {
  return path.resolve(workspaceRoot || "/workspace");
}
