import test from "node:test";
import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

function walkFiles(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = relative(base, full).replaceAll("\\", "/");
    if (entry.isDirectory()) {
      out.push(...walkFiles(full, base));
    } else {
      out.push(rel);
    }
  }
  return out.sort();
}

test("build-pages.mjs produces allowlisted zero-data dist/ with content-hashed SW version", async () => {
  const { buildPages } = await import(`../scripts/build-pages.mjs?t=${Date.now()}`);
  const tempRoot = mkdtempSync(join(tmpdir(), "wips-build-"));
  const distDir = join(tempRoot, "dist");

  try {
    const buildResult = buildPages({ rootDir: ROOT, distDir });
    assert.deepEqual(walkFiles(distDir), [
      "icons/icon-192.png",
      "icons/icon-512.png",
      "index.html",
      "manifest.webmanifest",
      "pwa-register.js",
      "sw.js",
    ]);

    assert.ok(buildResult.swVersion && !buildResult.swVersion.includes("wips-dev-1"));
    const builtSw = readFileSync(join(distDir, "sw.js"), "utf8");
    assert.match(builtSw, new RegExp(`const SW_VERSION = "${buildResult.swVersion}";`));

    const builtHtml = readFileSync(join(distDir, "index.html"), "utf8");
    assert.ok(!builtHtml.includes("00000000-0000-4000-8000-000000000000"));
    assert.ok(!builtHtml.includes("00000000000000000000000000000000"));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("verify-dist.mjs passes clean dist/ and fails on all security/leak regressions", async () => {
  const { buildPages } = await import(`../scripts/build-pages.mjs?t=${Date.now()}`);
  const { verifyDist } = await import(`../scripts/verify-dist.mjs?t=${Date.now()}`);

  const tempRoot = mkdtempSync(join(tmpdir(), "wips-verify-"));
  const cleanDist = join(tempRoot, "clean-dist");

  try {
    buildPages({ rootDir: ROOT, distDir: cleanDist });
    const cleanReport = verifyDist({ rootDir: ROOT, distDir: cleanDist });
    assert.equal(cleanReport.ok, true, `Clean dist must pass verification: ${cleanReport.errors.join("; ")}`);

    const cases = [
      {
        name: "extra file wips-data.json",
        mutate(dir) {
          writeFileSync(join(dir, "wips-data.json"), "{}");
        },
      },
      {
        name: "symlink inside dist",
        mutate(dir) {
          symlinkSync(join(dir, "index.html"), join(dir, "icons", "link.png"));
        },
      },
      {
        name: "real DATA_SOURCE_ID leak",
        mutate(dir) {
          writeFileSync(
            join(dir, "pwa-register.js"),
            `${readFileSync(join(dir, "pwa-register.js"), "utf8")}\n// 00000000-0000-4000-8000-000000000000\n`,
          );
        },
      },
      {
        name: "real SOURCE_URL page ID leak",
        mutate(dir) {
          writeFileSync(
            join(dir, "pwa-register.js"),
            `${readFileSync(join(dir, "pwa-register.js"), "utf8")}\n// 00000000000000000000000000000000\n`,
          );
        },
      },
      {
        name: "Notion token literal leak",
        mutate(dir) {
          writeFileSync(
            join(dir, "pwa-register.js"),
            `${readFileSync(join(dir, "pwa-register.js"), "utf8")}\nconst leak = "ntn_1234567890abcdefghij";\n`,
          );
        },
      },
      {
        name: "banned external CDN host",
        mutate(dir) {
          const html = readFileSync(join(dir, "index.html"), "utf8");
          writeFileSync(join(dir, "index.html"), html.replace("</head>", '<script src="https://cdn.jsdelivr.net/x.js"></script></head>'));
        },
      },
      {
        name: "dangerous innerHTML sink",
        mutate(dir) {
          writeFileSync(
            join(dir, "pwa-register.js"),
            `${readFileSync(join(dir, "pwa-register.js"), "utf8")}\nfunction bad(el){ el.innerHTML = "x"; }\n`,
          );
        },
      },
      {
        name: "sensitive localStorage usage",
        mutate(dir) {
          writeFileSync(
            join(dir, "pwa-register.js"),
            `${readFileSync(join(dir, "pwa-register.js"), "utf8")}\nlocalStorage.setItem("notion_token", "x");\n`,
          );
        },
      },
      {
        name: "root-absolute asset path",
        mutate(dir) {
          const m = JSON.parse(readFileSync(join(dir, "manifest.webmanifest"), "utf8"));
          m.start_url = "/";
          writeFileSync(join(dir, "manifest.webmanifest"), JSON.stringify(m));
        },
      },
      {
        name: "missing strict CSP",
        mutate(dir) {
          const html = readFileSync(join(dir, "index.html"), "utf8");
          writeFileSync(join(dir, "index.html"), html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, ""));
        },
      },
      {
        name: "disallowed external URL",
        mutate(dir) {
          writeFileSync(
            join(dir, "pwa-register.js"),
            `${readFileSync(join(dir, "pwa-register.js"), "utf8")}\nconst relay = "https://relay.example.com/v1";\n`,
          );
        },
      },
    ];

    if (existsSync(join(ROOT, "wips-data.json"))) {
      const sample = JSON.parse(readFileSync(join(ROOT, "wips-data.json"), "utf8"));
      const realTask = (sample.results || []).find((t) => typeof t?.title === "string" && t.title.trim().length >= 4);
      if (realTask) {
        cases.push({
          name: "local wips-data.json real task title leak",
          mutate(dir) {
            writeFileSync(
              join(dir, "pwa-register.js"),
              `${readFileSync(join(dir, "pwa-register.js"), "utf8")}\n// ${realTask.title}\n`,
            );
          },
        });
      }
    }

    for (const c of cases) {
      const mutatedDir = join(tempRoot, c.name.replaceAll(/[^a-z0-9]+/gi, "-"));
      mkdirSync(mutatedDir, { recursive: true });
      cpSync(cleanDist, mutatedDir, { recursive: true });
      c.mutate(mutatedDir);
      const report = verifyDist({ rootDir: ROOT, distDir: mutatedDir });
      assert.equal(report.ok, false, `Expected verifyDist to fail for: ${c.name}`);
      assert.ok(report.errors.length > 0, `Expected errors for: ${c.name}`);
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
