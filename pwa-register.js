const CLEAR_SESSION_MESSAGE = Object.freeze({ type: "WIPS_CLEAR_SESSION" });

export async function sendClearSessionToSw(navigatorObj = globalThis.navigator) {
  const sw = navigatorObj?.serviceWorker;
  if (!sw) {
    return { supported: false, sentCount: 0 };
  }

  const targets = new Set();
  if (sw.controller && typeof sw.controller.postMessage === "function") {
    targets.add(sw.controller);
  }
  if (typeof sw.getRegistration === "function") {
    try {
      const reg = await sw.getRegistration("./");
      if (reg?.active && typeof reg.active.postMessage === "function") {
        targets.add(reg.active);
      }
    } catch {
      // Ignore registration lookup failures during logout cleanup.
    }
  }

  let sentCount = 0;
  for (const target of targets) {
    try {
      target.postMessage({ ...CLEAR_SESSION_MESSAGE });
      sentCount += 1;
    } catch {
      // Ignore detached worker port errors.
    }
  }
  return { supported: true, sentCount };
}

export async function registerPwa({
  windowObj = globalThis.window,
  navigatorObj = globalThis.navigator,
  swUrl = "./sw.js",
  scope = "./",
} = {}) {
  const clearSession = () => sendClearSessionToSw(navigatorObj);

  if (windowObj && typeof windowObj.addEventListener === "function") {
    windowObj.__wipsClearSwSession = clearSession;
    windowObj.addEventListener("wips:logout", () => {
      void clearSession();
    });
    windowObj.addEventListener("message", (event) => {
      if (
        event &&
        event.origin === windowObj.location?.origin &&
        event.data &&
        event.data.type === "wips:logout"
      ) {
        void clearSession();
      }
    });
  }

  const sw = navigatorObj?.serviceWorker;
  if (!sw || typeof sw.register !== "function") {
    return { supported: false, registration: null, clearSession };
  }

  try {
    const registration = await sw.register(swUrl, {
      scope,
      updateViaCache: "none",
    });
    return { supported: true, registration, clearSession };
  } catch (error) {
    return { supported: true, registration: null, error, clearSession };
  }
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  void registerPwa();
}
