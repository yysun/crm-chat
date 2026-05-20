/*
 * Feature: workspace root resolution for request-time runtime access.
 * Notes: centralizes absolute path normalization for the mounted workspace root.
 * Recent changes: restored the workspace root helper after the runtime refactor.
 */

import path from "node:path";

export function resolveWorkspaceRoot(workspaceRoot: string | undefined): string {
  return path.resolve(workspaceRoot || "/workspace");
}

export function sanitizeUserIdForPath(userId: string, errorMessage = "userId is required"): string {
  const sanitizedUserId = userId.trim().replace(/[/\\.\0]/g, "_");
  if (!sanitizedUserId) {
    throw new Error(errorMessage);
  }

  return sanitizedUserId;
}

export function resolveUserWorkspaceRoot(workspaceRoot: string, userId: string): string {
  return path.join(resolveWorkspaceRoot(workspaceRoot), "users", sanitizeUserIdForPath(userId));
}

export function resolveApiResponseDirectory(workspaceRoot: string, userId: string): string {
  return path.join(resolveUserWorkspaceRoot(workspaceRoot, userId), "data", "api-responses");
}

export function resolveToolWorkspaceRoot(options: {
  workspaceRoot?: string;
  userId: string;
  defaultRoot?: string;
}): string {
  return resolveUserWorkspaceRoot(resolveBaseWorkspaceRoot(options), options.userId);
}

function resolveBaseWorkspaceRoot(options: {
  workspaceRoot?: string;
  defaultRoot?: string;
}): string {
  const workspaceRoot = trimOptionalString(options.workspaceRoot);
  if (workspaceRoot) {
    return path.resolve(workspaceRoot);
  }

  return path.resolve(options.defaultRoot ?? "./aiw-workspace");
}

function trimOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}