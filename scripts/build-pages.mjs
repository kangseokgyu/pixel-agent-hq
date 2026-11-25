import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DIST_ALLOWLIST, SHELL_RELATIVE_PATHS, STATIC_COPIES } from "../lib/app-assets.mjs";
import { syncOfficeHtml } from "./sync-office.mjs";

const PROJECT_DIR = fileURLToPath(new URL("..", import.meta.url));
const SW_VERSION_PATTERN = /const SW_VERSION = "[^"]+";/;
const SW_SHELL_PATHS_PATTERN = /const SHELL_RELATIVE_PATHS = \[[\s\S]*?\];/;

export { DIST_ALLOWLIST };

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

  for (const relPath of STATIC_COPIES) {
    copyFileSync(resolve(rootDir, relPath), resolve(distDir, relPath));
  }

  const swRaw = readFileSync(resolve(rootDir, "sw.js"), "utf8");
  if (!SW_VERSION_PATTERN.test(swRaw)) {
    throw new Error("Could not find SW_VERSION constant in sw.js.");
  }
  if (!SW_SHELL_PATHS_PATTERN.test(swRaw)) {
    throw new Error("Could not find SHELL_RELATIVE_PATHS constant in sw.js.");
  }

  const shellPathsLiteral = `const SHELL_RELATIVE_PATHS = ${JSON.stringify(SHELL_RELATIVE_PATHS, null, 2)};`;
  const swTemplate = swRaw.replace(SW_SHELL_PATHS_PATTERN, shellPathsLiteral);

  const hash = createHash("sha256");
  for (const relPath of ["index.html", ...STATIC_COPIES]) {
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
