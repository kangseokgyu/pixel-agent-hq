import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_DIR = fileURLToPath(new URL("..", import.meta.url));
export const DEFAULT_OFFICE_ENTRY = "src/office-app.mjs";

const IMPORT_PATTERN =
  /^import\s+(?:\*\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)|\{([\s\S]*?)\})\s+from\s+["']([^"']+)["'];?\r?\n?/gm;
const EXPORT_DECL_PATTERN =
  /^export\s+(?:(async\s+function|function|const|let|var|class)\s+([A-Za-z_$][A-Za-z0-9_$]*))/gm;
const EXPORT_LIST_PATTERN = /^export\s*\{([^}]*)\}\s*;?\r?\n?/gm;
const OFFICE_SCRIPT_PATTERN = /(<script id="office-model">)[\s\S]*?(<\/script>)/;

function parseNamedBindings(rawList) {
  return rawList
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((spec) => {
      const asMatch = spec.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)$/);
      if (asMatch) {
        return { imported: asMatch[1], local: asMatch[2] };
      }
      return { imported: spec, local: spec };
    });
}

function collectDependencyGraph(entryAbs) {
  const visited = new Set();
  const ordered = [];

  function visit(absPath) {
    if (visited.has(absPath)) return;
    visited.add(absPath);
    const source = readFileSync(absPath, "utf8");
    const deps = [];
    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const specifier = match[3];
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
        throw new Error(`Unsupported non-relative import "${specifier}" in ${absPath}`);
      }
      const depAbs = resolve(dirname(absPath), specifier);
      deps.push(depAbs);
      visit(depAbs);
    }
    ordered.push({ absPath, source, deps });
  }

  visit(entryAbs);
  return ordered;
}

function rewriteImports(source, absPath, modVars) {
  return source.replace(IMPORT_PATTERN, (_full, namespaceName, namedList, specifier) => {
    const depAbs = resolve(dirname(absPath), specifier);
    const modVar = modVars.get(depAbs);
    if (!modVar) {
      throw new Error(`Missing bundled module variable for ${depAbs}`);
    }
    if (namespaceName) {
      return `const ${namespaceName} = ${modVar};\n`;
    }
    const bindings = parseNamedBindings(namedList).map(({ imported, local }) => (
      imported === local ? local : `${imported}: ${local}`
    ));
    return `const { ${bindings.join(", ")} } = ${modVar};\n`;
  });
}

function rewriteExports(source) {
  const exported = [];
  let rewritten = source.replace(EXPORT_DECL_PATTERN, (_full, keyword, name) => {
    exported.push(`${name}: ${name}`);
    return `${keyword} ${name}`;
  });
  rewritten = rewritten.replace(EXPORT_LIST_PATTERN, (_full, rawList) => {
    for (const { imported, local } of parseNamedBindings(rawList)) {
      exported.push(imported === local ? local : `${local}: ${imported}`);
    }
    return "";
  });
  return { rewritten, exported };
}

function compactLines(text) {
  let inTemplate = false;
  const out = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (inTemplate) {
      out.push(rawLine);
      const backticks = (rawLine.match(/(?<!\\)`/g) || []).length;
      if (backticks % 2 === 1) inTemplate = false;
      continue;
    }
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("//")) continue;
    out.push(trimmed);
    const backticks = (trimmed.match(/(?<!\\)`/g) || []).length;
    if (backticks % 2 === 1) inTemplate = true;
  }
  return out.join("\n");
}

export function bundleModules(entryRelPath = DEFAULT_OFFICE_ENTRY, { rootDir = PROJECT_DIR } = {}) {
  const entryAbs = resolve(rootDir, entryRelPath);
  const graph = collectDependencyGraph(entryAbs);
  const libModules = graph.slice(0, -1);
  const entryModule = graph[graph.length - 1];

  const modVars = new Map();
  libModules.forEach((mod, index) => {
    modVars.set(mod.absPath, `__wips_mod_${index}`);
  });

  const chunks = ["(() => {"];
  for (const mod of libModules) {
    const modVar = modVars.get(mod.absPath);
    const withImports = rewriteImports(mod.source, mod.absPath, modVars);
    const { rewritten, exported } = rewriteExports(withImports);
    const returnLine = exported.length > 0 ? `return { ${exported.join(", ")} };` : "return {};";
    chunks.push(`const ${modVar} = (() => {\n${compactLines(rewritten)}\n${returnLine}\n})();`);
  }

  const entryWithImports = rewriteImports(entryModule.source, entryModule.absPath, modVars);
  const { rewritten: entryBody } = rewriteExports(entryWithImports);
  chunks.push(compactLines(entryBody));
  chunks.push("})();");
  return chunks.join("\n");
}

export function injectBundledOfficeScript(officeHtml, bundledJs) {
  if (!OFFICE_SCRIPT_PATTERN.test(officeHtml)) {
    throw new Error('Could not find <script id="office-model"> in wips-office.html.');
  }
  return officeHtml.replace(
    OFFICE_SCRIPT_PATTERN,
    (_match, openTag, closeTag) => `${openTag}\n${bundledJs}\n${closeTag}`,
  );
}
