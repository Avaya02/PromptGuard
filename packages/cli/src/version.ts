import { readFileSync } from "node:fs";

/**
 * The CLI's own version, read from package.json.
 *
 * Resolved relative to this module, which sits one level below package.json
 * both in src/ (tests), dist/ (tsc) and the single-file bundle.
 */
function readVersion(): string {
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf-8");
    return (JSON.parse(raw) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const CLI_VERSION = readVersion();
