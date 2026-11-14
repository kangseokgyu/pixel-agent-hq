import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CONNECTION_FILE,
  OPFS_DIR_NAME,
  SNAPSHOT_CACHE_FILE,
  createOpfsStore,
} from "../lib/opfs-store.mjs";

const sampleSnapshot = JSON.parse(readFileSync(new URL("../fixtures/sample-snapshot.json", import.meta.url), "utf8"));

function createMockOpfs({ corruptReadback = false } = {}) {
  const dirs = new Map();
  const removedEntries = [];

  function makeDirHandle(dirName) {
    if (!dirs.has(dirName)) dirs.set(dirName, new Map());
    const files = dirs.get(dirName);
    return {
      async getFileHandle(fileName, { create = false } = {}) {
        if (!files.has(fileName)) {
          if (!create) {
            const error = new Error(`File not found: ${fileName}`);
            error.name = "NotFoundError";
            throw error;
          }
          files.set(fileName, "");
        }
        return {
          async createWritable() {
            let pending = "";
            return {
              async write(content) {
                pending = String(content);
              },
              async close() {
                files.set(fileName, corruptReadback ? "{\"broken\":true}" : pending);
              },
            };
          },
          async getFile() {
            return {
              async text() {
                if (!files.has(fileName)) {
                  const error = new Error(`File not found: ${fileName}`);
                  error.name = "NotFoundError";
                  throw error;
                }
                return files.get(fileName);
              },
            };
          },
        };
      },
      async removeEntry(fileName) {
        if (!files.has(fileName)) {
          const error = new Error(`File not found: ${fileName}`);
          error.name = "NotFoundError";
          throw error;
        }
        files.delete(fileName);
        removedEntries.push(fileName);
      },
    };
  }

  return {
    dirs,
    removedEntries,
    async getDirectory() {
      return {
        async getDirectoryHandle(name, { create = false } = {}) {
          if (!dirs.has(name) && !create) {
            const error = new Error(`Directory not found: ${name}`);
            error.name = "NotFoundError";
            throw error;
          }
          return makeDirHandle(name);
        },
      };
    },
  };
}

test("saves, reads back, and clears connection and snapshot cache via OPFS removeEntry", async () => {
  const mockOpfs = createMockOpfs();
  const store = createOpfsStore({ getDirectory: mockOpfs.getDirectory });

  assert.equal(store.isSupported(), true);
  assert.equal(await store.loadConnection(), null);
  assert.equal(await store.loadSnapshot(), null);

  const connection = {
    token: "demo_token_abc",
    dataSourceId: "11111111-2222-4333-8444-555555555555",
    corsProxyUrl: "https://relay.example.com/v1",
  };
  await store.saveConnection(connection);
  await store.saveSnapshot({ ...sampleSnapshot, lastSuccessAt: "2026-11-14T03:00:00.000Z" });

  assert.equal(mockOpfs.dirs.has(OPFS_DIR_NAME), true);
  assert.deepEqual(await store.loadConnection(), connection);
  assert.equal((await store.loadSnapshot()).results.length, 2);

  await store.clearAll();
  assert.deepEqual(mockOpfs.removedEntries.sort(), [CONNECTION_FILE, SNAPSHOT_CACHE_FILE].sort());
  assert.equal(await store.loadConnection(), null);
  assert.equal(await store.loadSnapshot(), null);
});

test("fails save when OPFS readback does not match written payload", async () => {
  const mockOpfs = createMockOpfs({ corruptReadback: true });
  const store = createOpfsStore({ getDirectory: mockOpfs.getDirectory });

  await assert.rejects(
    store.saveConnection({
      token: "demo_token_abc",
      dataSourceId: "11111111-2222-4333-8444-555555555555",
      corsProxyUrl: "https://relay.example.com/v1",
    }),
    /readback|verify/i,
  );
});

test("rejects operations cleanly when OPFS is unsupported", async () => {
  const store = createOpfsStore({ getDirectory: null });
  assert.equal(store.isSupported(), false);
  await assert.rejects(store.loadConnection(), /OPFS/i);
  await assert.rejects(store.clearAll(), /OPFS/i);
});
