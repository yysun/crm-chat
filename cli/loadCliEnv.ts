import { readFileSync } from "node:fs";
import path from "node:path";

function stripOptionalQuotes(value: string): string {
  const trimmed = value.trim();
  const quote = trimmed[0];

  if ((quote !== "\"" && quote !== "'") || trimmed.at(-1) !== quote) {
    return trimmed;
  }

  const inner = trimmed.slice(1, -1);
  return quote === "\"" ? inner.replace(/\\n/g, "\n").replace(/\\"/g, "\"") : inner;
}

function parseEnvLine(line: string): [string, string] | null {
  const trimmed = line.trim();

  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const normalized = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trimStart() : trimmed;
  const separatorIndex = normalized.indexOf("=");
  if (separatorIndex <= 0) {
    return null;
  }

  const key = normalized.slice(0, separatorIndex).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return null;
  }

  const rawValue = normalized.slice(separatorIndex + 1);
  return [key, stripOptionalQuotes(rawValue)];
}

export function loadCliEnv(filePath = process.env.CRM_CHAT_CLI_ENV_FILE ?? "cli/.env"): void {
  let rawEnv: string;

  try {
    rawEnv = readFileSync(path.resolve(filePath), "utf8");
  } catch {
    return;
  }

  for (const line of rawEnv.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) {
      continue;
    }

    const [key, value] = parsed;
    if (process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = value;
  }
}
