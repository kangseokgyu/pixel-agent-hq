import { validateConnectionConfig, validateSnapshot } from "./snapshot-schema.mjs";

export const OPFS_DIR_NAME = "wips-office-private-v1";
export const CONNECTION_FILE = "connection.json";
export const SNAPSHOT_CACHE_FILE = "snapshot-cache.json";

function defaultGetDirectory() {
  return globalThis.navigator?.storage?.getDirectory?.();
}

function isNotFoundError(error) {
  return error?.name === "NotFoundError";
}

function deepEqualJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createOpfsStore({ getDirectory } = {}) {
  const resolveDirectory = getDirectory === undefined
    ? () => defaultGetDirectory()
    : getDirectory;

  function isSupported() {
    if (typeof resolveDirectory !== "function") return false;
    if (getDirectory === undefined) {
      return typeof globalThis.navigator?.storage?.getDirectory === "function";
    }
    return true;
  }

  async function requireRootDirectory() {
    if (!isSupported()) {
      throw new Error("OPFS (Origin Private File System) is not supported in this browser.");
    }
    const root = await resolveDirectory();
    if (!root || typeof root.getDirectoryHandle !== "function") {
      throw new Error("OPFS root directory handle is unavailable.");
    }
    return root;
  }

  async function getPrivateDir({ create = false } = {}) {
    const root = await requireRootDirectory();
    try {
      return await root.getDirectoryHandle(OPFS_DIR_NAME, { create });
    } catch (error) {
      if (!create && isNotFoundError(error)) return null;
      throw error;
    }
  }

  async function writeVerifiedJson(fileName, payload) {
    const dir = await getPrivateDir({ create: true });
    const serialized = JSON.stringify(payload);
    const handle = await dir.getFileHandle(fileName, { create: true });
    const writable = await handle.createWritable();
    await writable.write(serialized);
    await writable.close();

    const file = await handle.getFile();
    const readbackText = await file.text();
    let parsedReadback;
    try {
      parsedReadback = JSON.parse(readbackText);
    } catch {
      throw new Error(`OPFS readback verification failed for ${fileName}: invalid JSON.`);
    }
    if (!deepEqualJson(parsedReadback, payload)) {
      throw new Error(`OPFS readback verification failed for ${fileName}: content mismatch.`);
    }
    return parsedReadback;
  }

  async function readJson(fileName) {
    const dir = await getPrivateDir({ create: false });
    if (!dir) return null;
    let handle;
    try {
      handle = await dir.getFileHandle(fileName, { create: false });
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
    const file = await handle.getFile();
    const text = await file.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  return {
    isSupported,
    async saveConnection(config) {
      const check = validateConnectionConfig(config);
      if (!check.ok) {
        throw new Error(check.error);
      }
      return writeVerifiedJson(CONNECTION_FILE, check.value);
    },
    async loadConnection() {
      const stored = await readJson(CONNECTION_FILE);
      if (!stored) return null;
      const check = validateConnectionConfig(stored);
      if (!check.ok) return null;
      return check.value;
    },
    async saveSnapshot(snapshot) {
      const check = validateSnapshot(snapshot);
      if (!check.ok) {
        throw new Error(check.error);
      }
      return writeVerifiedJson(SNAPSHOT_CACHE_FILE, check.value);
    },
    async loadSnapshot() {
      const stored = await readJson(SNAPSHOT_CACHE_FILE);
      if (!stored) return null;
      const check = validateSnapshot(stored);
      if (!check.ok) return null;
      return check.value;
    },
    async clearAll() {
      const dir = await getPrivateDir({ create: false });
      if (!dir) return { cleared: true };
      for (const fileName of [CONNECTION_FILE, SNAPSHOT_CACHE_FILE]) {
        try {
          await dir.removeEntry(fileName);
        } catch (error) {
          if (!isNotFoundError(error)) throw error;
        }
      }
      return { cleared: true };
    },
  };
}
