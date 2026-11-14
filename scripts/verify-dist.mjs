import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DIST_ALLOWLIST } from "./build-pages.mjs";
import { BANNED_CDN_HOSTS, OUTER_CSP, SRCDOC_CSP, unescapeHtmlAttr } from "./sync-office.mjs";

const PROJECT_DIR = fileURLToPath(new URL("..", import.meta.url));
const KNOWN_FORBIDDEN_IDENTIFIERS = Object.freeze([
  "00000000-0000-4000-8000-000000000000",
  "00000000000040008000000000000000",
  "00000000000000000000000000000000",
]);
const TOKEN_LITERAL_PATTERN = /\b(?:ntn|secret)_[A-Za-z0-9]{16,}\b/;
const DANGEROUS_SINK_PATTERN = /\b(?:innerHTML|outerHTML|insertAdjacentHTML)\b|\beval\s*\(|\bnew\s+Function\b/;
const TEXT_EXTENSIONS = new Set([".html", ".js", ".webmanifest", ".json", ".css", ".svg"]);

function collectDistFiles(dir, base = dir, files = [], violations = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = relative(base, full).replaceAll("\\", "/");
    const stat = lstatSync(full);
    if (entry.isSymbolicLink() || stat.isSymbolicLink()) {
      violations.push(`Symlink not permitted in dist/: ${rel}`);
      continue;
    }
    if (entry.isDirectory()) {
      collectDistFiles(full, base, files, violations);
    } else {
      files.push({ rel, full });
    }
  }
  return { files, violations };
}

function loadLocalSecretIndicators(rootDir) {
  const secretLiterals = [];
  const taskIndicators = [];

  const envPath = resolve(rootDir, ".env");
  if (existsSync(envPath)) {
    const rawEnv = readFileSync(envPath, "utf8");
    for (const line of rawEnv.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx <= 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (val && val.length >= 6) {
        secretLiterals.push({ label: `.env ${key}`, value: val });
      }
    }
  }

  const dataPath = resolve(rootDir, "wips-data.json");
  if (existsSync(dataPath)) {
    try {
      const data = JSON.parse(readFileSync(dataPath, "utf8"));
      if (typeof data.sourceUrl === "string" && data.sourceUrl.trim()) {
        taskIndicators.push({ label: "wips-data.json sourceUrl", value: data.sourceUrl.trim() });
      }
      for (const item of data.results || []) {
        if (typeof item?.title === "string" && item.title.trim().length >= 3) {
          taskIndicators.push({ label: "wips-data.json task title", value: item.title.trim() });
        }
        if (typeof item?.url === "string" && item.url.trim()) {
          taskIndicators.push({ label: "wips-data.json task url", value: item.url.trim() });
        }
      }
    } catch {
      // Ignore unparseable local cache file when not present cleanly
    }
  }

  return { secretLiterals, taskIndicators };
}

function extractJsCode(rel, text) {
  if (!rel.startsWith("index.html")) {
    return text;
  }
  const chunks = [];
  for (const match of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = match[1] || "";
    if (/type="application\/json"/i.test(attrs)) continue;
    chunks.push(match[2] || "");
  }
  return chunks.join("\n");
}

function checkLocalStorageSafety(rel, text, errors) {
  if (rel !== "index.html" && rel !== "index.html#srcdoc") {
    if (/\b(?:localStorage|sessionStorage|indexedDB)\b/.test(text)) {
      errors.push(`Browser storage reference forbidden in ${rel}`);
    }
    return;
  }

  const jsCode = extractJsCode(rel, text);
  if (/\b(?:sessionStorage|indexedDB)\b/.test(jsCode)) {
    errors.push(`sessionStorage/indexedDB forbidden in ${rel}`);
  }

  const literalStoragePattern = /(?:localStorage|storage)\s*\.\s*(?:getItem|setItem|removeItem)\s*\(\s*["']([^"']+)["']/g;
  for (const match of jsCode.matchAll(literalStoragePattern)) {
    const key = match[1];
    if (key !== "wips-office-seating-v1" && !key.startsWith("codex:visualization-")) {
      errors.push(`Disallowed storage key "${key}" in ${rel}`);
    }
  }

  for (const m of jsCode.matchAll(/\blocalStorage\b/g)) {
    const start = Math.max(0, m.index - 220);
    const end = Math.min(jsCode.length, m.index + 220);
    const windowText = jsCode.slice(start, end);
    const hasApprovedContext =
      windowText.includes("seatingKey") ||
      windowText.includes("wips-office-seating-v1") ||
      windowText.includes("storageKey") ||
      windowText.includes("sizeStorageKey") ||
      windowText.includes("codex:visualization-");
    const hasSensitiveTerm = /\b(?:token|secret|snapshot|dataSourceId|corsProxy|connection)\b/i.test(windowText);
    if (!hasApprovedContext || hasSensitiveTerm) {
      errors.push(`Unapproved localStorage access context in ${rel}`);
    }
  }
}

export function verifyDist({
  rootDir = PROJECT_DIR,
  distDir = resolve(rootDir, "dist"),
} = {}) {
  const errors = [];
  if (!existsSync(distDir)) {
    return { ok: false, errors: [`Missing dist directory: ${distDir}`] };
  }

  const { files, violations } = collectDistFiles(distDir);
  errors.push(...violations);

  const allowSet = new Set(DIST_ALLOWLIST);
  const foundSet = new Set(files.map((f) => f.rel));
  for (const rel of foundSet) {
    if (!allowSet.has(rel)) {
      errors.push(`Unexpected file in dist/: ${rel}`);
    }
  }
  for (const req of allowSet) {
    if (!foundSet.has(req)) {
      errors.push(`Missing required file in dist/: ${req}`);
    }
  }

  const { secretLiterals, taskIndicators } = loadLocalSecretIndicators(rootDir);
  const scanUnits = [];

  for (const { rel, full } of files) {
    const isText = [...TEXT_EXTENSIONS].some((ext) => rel.endsWith(ext));
    if (!isText) continue;
    const content = readFileSync(full, "utf8");

    if (rel === "index.html") {
      if (!content.includes(`<meta http-equiv="Content-Security-Policy" content="${OUTER_CSP}">`)) {
        errors.push("Missing or weakened outer Content-Security-Policy meta tag in dist/index.html");
      }

      const outerShellOnly = content.replace(/\bdata-srcdoc="[\s\S]*?"/, "");
      scanUnits.push({ label: "index.html", text: outerShellOnly });
      if (/<(?:link|script)\b[^>]*\b(?:href|src)="\//i.test(outerShellOnly)) {
        errors.push("Root-absolute link/script path found in outer dist/index.html");
      }

      const srcdocMatch = content.match(/\bdata-srcdoc="([\s\S]*?)"/);
      if (!srcdocMatch) {
        errors.push("Missing data-srcdoc iframe payload in dist/index.html");
      } else {
        const srcdoc = unescapeHtmlAttr(srcdocMatch[1]);
        scanUnits.push({ label: "index.html#srcdoc", text: srcdoc });

        if (!srcdoc.includes(`<meta http-equiv="Content-Security-Policy" content="${SRCDOC_CSP}">`)) {
          errors.push("Missing or weakened srcdoc Content-Security-Policy meta tag in dist/index.html");
        }

        const dataMatch = srcdoc.match(/<script type="application\/json" id="wips-office-data">([\s\S]*?)<\/script>/);
        if (!dataMatch) {
          errors.push("Missing embedded #wips-office-data JSON in dist/index.html");
        } else {
          try {
            const embedded = JSON.parse(dataMatch[1]);
            if (
              !Array.isArray(embedded.results) ||
              embedded.results.length !== 0 ||
              embedded.snapshotDate !== "" ||
              (embedded.sourceUrl || "") !== "" ||
              (Array.isArray(embedded.data_source_ids) && embedded.data_source_ids.length !== 0)
            ) {
              errors.push("Embedded #wips-office-data in dist/index.html is not an empty snapshot");
            }
          } catch {
            errors.push("Embedded #wips-office-data in dist/index.html is not valid JSON");
          }
        }
      }
      continue;
    }

    scanUnits.push({ label: rel, text: content });

    if (rel === "manifest.webmanifest") {
      try {
        const manifest = JSON.parse(content);
        if (manifest.start_url !== "./" || manifest.scope !== "./") {
          errors.push("manifest.webmanifest must use start_url: './' and scope: './'");
        }
        if (!Array.isArray(manifest.icons) || manifest.icons.some((i) => typeof i.src !== "string" || i.src.startsWith("/"))) {
          errors.push("manifest.webmanifest icon src must be relative (no leading '/')");
        }
      } catch {
        errors.push("dist/manifest.webmanifest is invalid JSON");
      }
    }

    if (rel === "pwa-register.js" || rel === "sw.js") {
      if (/register\(\s*["']\/|["']\/(?:index\.html|manifest\.webmanifest|sw\.js|icons\/)/.test(content)) {
        errors.push(`Root-absolute PWA asset path found in dist/${rel}`);
      }
    }
  }

  for (const unit of scanUnits) {
    for (const id of KNOWN_FORBIDDEN_IDENTIFIERS) {
      if (unit.text.includes(id)) {
        errors.push(`Forbidden identifier leaked in dist/${unit.label}`);
      }
    }
    if (TOKEN_LITERAL_PATTERN.test(unit.text)) {
      errors.push(`Notion token-like literal leaked in dist/${unit.label}`);
    }
    for (const secret of secretLiterals) {
      if (unit.text.includes(secret.value)) {
        errors.push(`${secret.label} leaked in dist/${unit.label}`);
      }
    }
    for (const indicator of taskIndicators) {
      if (unit.text.includes(indicator.value)) {
        errors.push(`${indicator.label} leaked in dist/${unit.label}`);
      }
    }
    for (const cdnHost of BANNED_CDN_HOSTS) {
      if (unit.text.includes(cdnHost)) {
        errors.push(`Banned external CDN host (${cdnHost}) found in dist/${unit.label}`);
      }
    }
    for (const urlMatch of unit.text.matchAll(/\bhttps?:\/\/[^\s"'`<>);]+/g)) {
      const externalUrl = urlMatch[0];
      const isAllowedNotionApi =
        externalUrl === "https://api.notion.com" ||
        externalUrl === "https://api.notion.com/v1" ||
        externalUrl.startsWith("https://api.notion.com/v1/");
      const isAllowedSvgNs = externalUrl === "http://www.w3.org/2000/svg";
      const isAllowedSwFallback = unit.label === "sw.js" && externalUrl === "http://localhost/";
      if (!isAllowedNotionApi && !isAllowedSvgNs && !isAllowedSwFallback) {
        errors.push(`Disallowed external URL (${externalUrl}) found in dist/${unit.label}`);
      }
    }
    if (DANGEROUS_SINK_PATTERN.test(unit.text)) {
      errors.push(`Forbidden dynamic HTML/eval sink found in dist/${unit.label}`);
    }
    checkLocalStorageSafety(unit.label, unit.text, errors);
  }

  return {
    ok: errors.length === 0,
    errors: [...new Set(errors)],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = verifyDist();
  if (!report.ok) {
    for (const err of report.errors) {
      process.stderr.write(`VERIFY-DIST ERROR: ${err}\n`);
    }
    process.exitCode = 1;
  } else {
    process.stdout.write("verify-dist: OK (zero data, zero secrets, strict CSP, allowlist verified)\n");
  }
}
