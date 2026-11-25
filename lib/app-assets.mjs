import { readFileSync } from "node:fs";

export const STATIC_COPIES = Object.freeze([
  "manifest.webmanifest",
  "pwa-register.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
]);

export const DIST_ALLOWLIST = Object.freeze([
  "index.html",
  ...STATIC_COPIES,
  "sw.js",
]);

export const SHELL_RELATIVE_PATHS = Object.freeze([
  "./",
  "./index.html",
  ...STATIC_COPIES.map((relPath) => `./${relPath}`),
]);

export const SERVER_ALLOWED_FILES = new Map([
  ["/", "index.html"],
  ["/wips-office.html", "wips-office.html"],
  ["/wips-data.json", "wips-data.json"],
  ...DIST_ALLOWLIST.map((relPath) => [`/${relPath}`, relPath]),
]);

export function parseDotEnv(content) {
  const parsed = {};
  for (const rawLine of String(content || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    const quotedMatch = value.match(/^"([^"]*)"(?:\s+#.*)?$|^'([^']*)'(?:\s+#.*)?$/);
    if (quotedMatch) {
      value = quotedMatch[1] ?? quotedMatch[2] ?? "";
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    parsed[match[1]] = value;
  }
  return parsed;
}

export function readDotEnvFile(filePath) {
  try {
    return parseDotEnv(readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}
