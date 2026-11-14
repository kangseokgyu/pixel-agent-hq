import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { syncOfficeHtml } from "./sync-office.mjs";

const PROJECT_DIR = fileURLToPath(new URL("..", import.meta.url));
const SW_VERSION_PATTERN = /const SW_VERSION = "[^"]+";/;

export const DIST_ALLOWLIST = Object.freeze([
  "index.html",
  "manifest.webmanifest",
  "pwa-register.js",
  "sw.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
]);

export function buildPages({
  rootDir = PROJECT_DIR,
  distDir = resolve(rootDir, "dist"),
} = {}) {
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(resolve(distDir, "icons"), { recursive: true });

  syncOfficeHtml({
    rootDir,
    outPath: resolve(distDir, "index.html"),
    empty: true,
  });

  const staticCopies = [
    "manifest.webmanifest",
    "pwa-register.js",
    "icons/icon-192.png",
    "icons/icon-512.png",
  ];
  for (const relPath of staticCopies) {
    copyFileSync(resolve(rootDir, relPath), resolve(distDir, relPath));
  }

  const swTemplate = readFileSync(resolve(rootDir, "sw.js"), "utf8");
  if (!SW_VERSION_PATTERN.test(swTemplate)) {
    throw new Error("Could not find SW_VERSION constant in sw.js.");
  }

  const hash = createHash("sha256");
  for (const relPath of ["index.html", ...staticCopies]) {
    hash.update(relPath);
    hash.update(readFileSync(resolve(distDir, relPath)));
  }
  hash.update(swTemplate);
  const swVersion = `wips-${hash.digest("hex").slice(0, 12)}`;

  const builtSw = swTemplate.replace(SW_VERSION_PATTERN, `const SW_VERSION = "${swVersion}";`);
  writeFileSync(resolve(distDir, "sw.js"), builtSw, "utf8");

  return {
    distDir,
    swVersion,
    files: [...DIST_ALLOWLIST],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = buildPages();
  process.stdout.write(
    `Built GitHub Pages dist at ${result.distDir} (swVersion=${result.swVersion}, files=${result.files.length})\n`,
  );
}
