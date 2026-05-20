/*
 * Feature: user ID resolution via a configurable identity API for multi-user workspace routing.
 * Notes: exchanges a Bearer access token for a user ID by calling API_AUTH_URL. Accepts { id }, { userId }, or [{ userId }] responses.
 * Recent changes: initial implementation for multi-user chat support.
 */

export class UserIdResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserIdResolutionError";
  }
}

export async function resolveUserId(token: string, apiAuthUrl: string): Promise<string> {
  let response: Response;

  try {
    response = await fetch(apiAuthUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
  } catch (error) {
    throw new UserIdResolutionError(
      `Failed to reach user identity API: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!response.ok) {
    throw new UserIdResolutionError(
      `User identity API returned ${response.status}`
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new UserIdResolutionError("User identity API returned non-JSON response");
  }

  function extractId(obj: Record<string, unknown>): string | null {
    for (const key of ["id", "userId"]) {
      const val = obj[key];
      if (val !== undefined && val !== null && val !== "") {
        return String(val);
      }
    }
    return null;
  }

  // Support { id } or { userId } object format
  if (typeof body === "object" && body !== null && !Array.isArray(body)) {
    const uid = extractId(body as Record<string, unknown>);
    if (uid) return uid;
  }

  // Support [{ userId } | { id }] array format
  if (Array.isArray(body) && body.length > 0) {
    const uid = extractId(body[0] as Record<string, unknown>);
    if (uid) return uid;
  }

  throw new UserIdResolutionError("User identity API response missing or empty user ID field");
}
