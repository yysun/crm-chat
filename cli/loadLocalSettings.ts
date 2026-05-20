import { readFileSync } from "node:fs";
import path from "node:path";

type LocalSettings = {
  Values?: Record<string, unknown>;
};

export function loadLocalSettings(filePath = "local.settings.json"): void {
  let rawSettings: string;

  try {
    rawSettings = readFileSync(path.resolve(filePath), "utf8");
  } catch {
    return;
  }

  let settings: LocalSettings;
  try {
    settings = JSON.parse(rawSettings) as LocalSettings;
  } catch {
    return;
  }

  for (const [key, value] of Object.entries(settings.Values ?? {})) {
    if (process.env[key] !== undefined || typeof value !== "string") {
      continue;
    }

    process.env[key] = value;
  }
}
