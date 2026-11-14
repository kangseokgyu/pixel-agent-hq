import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
  const serialized = JSON.stringify(emptySnapshot, null, 2);
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

export function syncOfficeHtml({
  rootDir = PROJECT_DIR,
  outPath,
  empty = false,
} = {}) {
  const indexPath = resolve(rootDir, "index.html");
  const officePath = resolve(rootDir, "wips-office.html");
  const emptyPath = resolve(rootDir, "fixtures/empty-snapshot.json");
  const targetPath = outPath ? resolve(rootDir, outPath) : indexPath;

  const indexHtml = readFileSync(indexPath, "utf8");
  const officeHtml = readFileSync(officePath, "utf8");
  const emptySnapshot = JSON.parse(readFileSync(emptyPath, "utf8"));

  const built = buildSyncedIndexHtml({ indexHtml, officeHtml, emptySnapshot, empty });
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, built, "utf8");
  return { outPath: targetPath, empty, bytes: Buffer.byteLength(built, "utf8") };
}

function parseArgs(argv) {
  let empty = false;
  let outPath;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--empty") {
      empty = true;
    } else if (arg === "--out" && i + 1 < argv.length) {
      outPath = argv[i + 1];
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { empty, outPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseArgs(process.argv.slice(2));
  const result = syncOfficeHtml(options);
  process.stdout.write(`Synced ${result.outPath} (empty=${result.empty}, ${result.bytes} bytes)\n`);
}
