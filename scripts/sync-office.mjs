import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DEFAULT_OFFICE_ENTRY, buildOfficeHtml, serializeJsonForHtmlScript } from "./bundle-office.mjs";

export const OUTER_CSP =
  "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://api.notion.com; worker-src 'self'; manifest-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";

export const SRCDOC_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://api.notion.com; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

export const BANNED_CDN_HOSTS = Object.freeze([
  "cdnjs.cloudflare.com",
  "cdn.jsdelivr.net",
  "esm.sh",
  "unpkg.com",
  "fonts.bunny.net",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "persistent.oaistatic.com",
]);

const PROJECT_DIR = fileURLToPath(new URL("..", import.meta.url));
const DATA_SCRIPT_PATTERN = /(<script type="application\/json" id="wips-office-data">)[\s\S]*?(<\/script>)/;
const CSP_META_PATTERN = /<meta http-equiv="Content-Security-Policy" content="[^"]*">/;
const SRCDOC_ATTR_PATTERN = /\bdata-srcdoc="([\s\S]*?)"/;
const OFFICE_ROOT_TO_BODY_PATTERN = /<div id="wips-office-root">[\s\S]*?<\/body>/;

function extractFunctionIife(source, fnName) {
  const marker = `export function ${fnName}()`;
  const start = source.indexOf(marker);
  if (start === -1) {
    throw new Error(`Could not find ${fnName} in src/shell/host-bridge.js.`);
  }
  const openBrace = source.indexOf("{", start + marker.length);
  let depth = 0;
  for (let i = openBrace; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        const body = source.slice(openBrace + 1, i);
        return `(() => {${body}})();`;
      }
    }
  }
  throw new Error(`Unterminated ${fnName} block in src/shell/host-bridge.js.`);
}

export function escapeHtmlAttr(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function unescapeHtmlAttr(value) {
  return String(value).replace(/&(?:quot|#x27|#39|lt|gt|amp);/g, (entity) => ({
    "&quot;": '"',
    "&#x27;": "'",
    "&#39;": "'",
    "&lt;": "<",
    "&gt;": ">",
    "&amp;": "&",
  })[entity]);
}

export function injectEmptySnapshot(officeHtml, emptySnapshot) {
  if (!DATA_SCRIPT_PATTERN.test(officeHtml)) {
    throw new Error("Could not find <script id=\"wips-office-data\"> in wips-office.html.");
  }
  const serialized = serializeJsonForHtmlScript(emptySnapshot);
  return officeHtml.replace(
    DATA_SCRIPT_PATTERN,
    (_match, openTag, closeTag) => `${openTag}\n${serialized}\n${closeTag}`,
  );
}

export function buildSyncedIndexHtml({ indexHtml, officeHtml, emptySnapshot, empty = false }) {
  const rawSrcdocMatch = indexHtml.match(SRCDOC_ATTR_PATTERN);
  if (!rawSrcdocMatch) {
    throw new Error("Could not find data-srcdoc attribute in index.html.");
  }

  let srcdoc = unescapeHtmlAttr(rawSrcdocMatch[1]);
  if (!CSP_META_PATTERN.test(srcdoc)) {
    throw new Error("Could not find Content-Security-Policy meta tag inside data-srcdoc.");
  }
  srcdoc = srcdoc.replace(
    CSP_META_PATTERN,
    () => `<meta http-equiv="Content-Security-Policy" content="${SRCDOC_CSP}">`,
  );

  if (!OFFICE_ROOT_TO_BODY_PATTERN.test(srcdoc)) {
    throw new Error("Could not find <div id=\"wips-office-root\">...</body> block inside data-srcdoc.");
  }

  const fragment = empty ? injectEmptySnapshot(officeHtml, emptySnapshot) : officeHtml;
  srcdoc = srcdoc.replace(
    OFFICE_ROOT_TO_BODY_PATTERN,
    () => `${fragment.trimEnd()}\n\n</body>`,
  );

  if (!CSP_META_PATTERN.test(indexHtml)) {
    throw new Error("Could not find Content-Security-Policy meta tag in outer index.html.");
  }

  const escapedSrcdoc = escapeHtmlAttr(srcdoc);
  return indexHtml
    .replace(
      CSP_META_PATTERN,
      () => `<meta http-equiv="Content-Security-Policy" content="${OUTER_CSP}">`,
    )
    .replace(
      SRCDOC_ATTR_PATTERN,
      () => `data-srcdoc="${escapedSrcdoc}"`,
    );
}

export function buildShellIndexHtml({
  rootDir = PROJECT_DIR,
  officeHtml,
  emptySnapshot,
  empty = false,
} = {}) {
  const indexTemplate = readFileSync(resolve(rootDir, "src/shell/index.template.html"), "utf8");
  const codexCss = readFileSync(resolve(rootDir, "src/shell/codex-host.css"), "utf8").trimEnd();
  const bridgeSource = readFileSync(resolve(rootDir, "src/shell/host-bridge.js"), "utf8");
  const innerBridge = extractFunctionIife(bridgeSource, "innerHostBridge");
  const outerBridge = extractFunctionIife(bridgeSource, "outerHostBridge");

  const fragment = empty ? injectEmptySnapshot(officeHtml, emptySnapshot) : officeHtml;
  const srcdoc = [
    "<!doctype html>",
    '<html lang="en" data-visualize-standalone>',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="referrer" content="no-referrer">',
    `<meta http-equiv="Content-Security-Policy" content="${SRCDOC_CSP}">`,
    "<title>Pixel Agent HQ</title>",
    "",
    "<style>",
    codexCss,
    "</style>",
    "</head>",
    "<body>",
    '<script type="application/json" id="codex-visualization-widget-state">__CODEX_VISUALIZATION_WIDGET_STATE__</script>',
    `<script>${innerBridge}</script>`,
    fragment.trimEnd(),
    "",
    "</body>",
    "</html>",
    "",
  ].join("\n");

  const escapedSrcdoc = escapeHtmlAttr(srcdoc);
  return indexTemplate
    .replace("__OUTER_CSP__", () => OUTER_CSP)
    .replace("__SRCDOC_ATTR__", () => escapedSrcdoc)
    .replace("<!--__OUTER_HOST_BRIDGE__-->", () => `<script>${outerBridge}</script>`);
}

function readSnapshotForSync(rootDir, rawOfficeHtml) {
  const wipsDataPath = resolve(rootDir, "wips-data.json");
  if (existsSync(wipsDataPath)) {
    return JSON.parse(readFileSync(wipsDataPath, "utf8"));
  }
  const match = rawOfficeHtml.match(DATA_SCRIPT_PATTERN);
  if (match) {
    const inner = match[0].replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "");
    return JSON.parse(inner);
  }
  return JSON.parse(readFileSync(resolve(rootDir, "fixtures/empty-snapshot.json"), "utf8"));
}

export function syncOfficeHtml({
  rootDir = PROJECT_DIR,
  outPath,
  empty = false,
  check = false,
  entryRelPath = DEFAULT_OFFICE_ENTRY,
} = {}) {
  const indexPath = resolve(rootDir, "index.html");
  const officePath = resolve(rootDir, "wips-office.html");
  const emptyPath = resolve(rootDir, "fixtures/empty-snapshot.json");
  const targetPath = outPath ? resolve(rootDir, outPath) : indexPath;

  const indexHtml = readFileSync(indexPath, "utf8");
  const rawOfficeHtml = readFileSync(officePath, "utf8");
  const snapshot = readSnapshotForSync(rootDir, rawOfficeHtml);
  const expectedOfficeHtml = buildOfficeHtml({ rootDir, snapshot, entryRelPath });
  const emptySnapshot = JSON.parse(readFileSync(emptyPath, "utf8"));

  const built = buildShellIndexHtml({
    rootDir,
    officeHtml: expectedOfficeHtml,
    emptySnapshot,
    empty,
  });

  if (check) {
    const drifted = [];
    if (rawOfficeHtml !== expectedOfficeHtml) drifted.push("wips-office.html");
    if (indexHtml !== built) drifted.push("index.html");
    return {
      ok: drifted.length === 0,
      drifted,
      outPath: targetPath,
      empty,
      bytes: Buffer.byteLength(built, "utf8"),
    };
  }

  if (!outPath) {
    writeFileSync(officePath, expectedOfficeHtml, "utf8");
  }
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, built, "utf8");
  return { outPath: targetPath, empty, bytes: Buffer.byteLength(built, "utf8") };
}

function parseArgs(argv) {
  let empty = false;
  let check = false;
  let outPath;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--empty") {
      empty = true;
    } else if (arg === "--check") {
      check = true;
    } else if (arg === "--out" && i + 1 < argv.length) {
      outPath = argv[i + 1];
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { empty, check, outPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseArgs(process.argv.slice(2));
  const result = syncOfficeHtml(options);
  if (options.check) {
    if (!result.ok) {
      process.stderr.write(`SYNC-CHECK DRIFT: ${result.drifted.join(", ")}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write("sync-office: OK (wips-office.html and index.html are up to date)\n");
    }
  } else {
    process.stdout.write(`Synced ${result.outPath} (empty=${result.empty}, ${result.bytes} bytes)\n`);
  }
}
