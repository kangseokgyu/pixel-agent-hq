export function innerHostBridge() {
  const root = document.documentElement;
  const mediaQuery = globalThis.matchMedia("(prefers-color-scheme: dark)");
  const apply = Reflect.apply;
  const isArray = Array.isArray;
  const hasOwn = Object.hasOwn;
  const parentWindow = globalThis.parent;
  const stringify = JSON.stringify;
  const parse = JSON.parse;
  const encode = TextEncoder.prototype.encode.bind(new TextEncoder());
  const initialStateElement = document.getElementById(
    "codex-visualization-widget-state",
  );
  const initialGlobals = parse(initialStateElement?.textContent ?? "{}");
  initialStateElement?.remove();
  let state = initialGlobals.widgetState ?? null;
  const statePersistence = initialGlobals.statePersistence ?? "none";
  let nextStateRequestId = 0;
  const pendingStateWrites = new Map();
  const persistenceError = () =>
    Object.assign(
      new Error("The host could not persist the widget state update"),
      {
        code: -32000,
        data: { code: "widget_state_persistence_failed", retryable: false },
      },
    );
  const getPrototypeGetter = (prototype, property) => {
    const getter = Object.getOwnPropertyDescriptor(prototype, property)?.get;
    if (getter == null) {
      throw new Error(`Missing ${property} getter`);
    }
    return getter;
  };
  const getMessageData = getPrototypeGetter(MessageEvent.prototype, "data");
  const getMessagePorts = getPrototypeGetter(MessageEvent.prototype, "ports");
  const getMessageSource = getPrototypeGetter(MessageEvent.prototype, "source");
  const addHostMessageListener = MessagePort.prototype.addEventListener;
  const postHostMessage = MessagePort.prototype.postMessage;
  const startHostPort = MessagePort.prototype.start;
  const stopMessagePropagation = Event.prototype.stopImmediatePropagation;
  let hostPort = null;
  const postToHost = (type, payload) => {
    if (hostPort != null) {
      apply(postHostMessage, hostPort, [{ type, ...payload }]);
    }
  };
  const openExternal = ({ href }) => {
    if (globalThis.navigator.userActivation?.isActive === true) {
      postToHost("open-external", { href });
    }
  };
  const setWidgetState = async (next) => {
    const nextState = typeof next === "function" ? next(state) : next;
    if (
      nextState == null ||
      typeof nextState !== "object" ||
      isArray(nextState)
    ) {
      throw new TypeError("Widget state must be a JSON object");
    }
    const inputState = stringify(nextState, (_key, value) => {
      if (
        typeof value === "undefined" ||
        typeof value === "function" ||
        typeof value === "symbol" ||
        (typeof value === "number" && !Number.isFinite(value))
      ) {
        throw new TypeError("Widget state must be a JSON object");
      }
      return value;
    });
    const parsedState = parse(inputState);
    if (
      parsedState == null ||
      typeof parsedState !== "object" ||
      isArray(parsedState)
    ) {
      throw new TypeError("Widget state must be a JSON object");
    }
    const storedState = {
      modelContent: null,
      privateContent: null,
      ...parsedState,
    };
    const serializedState = stringify(storedState);
    if (encode(serializedState).length > 16 * 1024) {
      throw new TypeError(
        "Widget state must be a JSON object of at most 16 KiB",
      );
    }
    if (
      hasOwn(storedState, "imageIds") &&
      (!isArray(storedState.imageIds) ||
        storedState.imageIds.some((id) => typeof id !== "string"))
    ) {
      throw new TypeError("Widget state imageIds must be an array of strings");
    }
    if (storedState.imageIds?.length > 0) {
      throw Object.assign(
        new TypeError("Visualization state does not support image attachments"),
        { code: -32602, data: { code: "images_unsupported" } },
      );
    }
    state = storedState;
    globalThis.openai.widgetState = state;
    globalThis.dispatchEvent(
      new CustomEvent("openai:set_globals", {
        detail: { globals: { widgetState: state } },
      }),
    );
    if (statePersistence === "none") {
      throw persistenceError();
    }
    const id = ++nextStateRequestId;
    return new Promise((resolve, reject) => {
      const timeout = globalThis.setTimeout(() => {
        pendingStateWrites.delete(id);
        reject(persistenceError());
      }, 30_000);
      pendingStateWrites.set(id, { resolve, reject, timeout, serializedState });
      postToHost("widget-state-write", { id, state: serializedState });
    });
  };
  const syncTheme = () => {
    const theme = mediaQuery.matches ? "dark" : "light";
    root.dataset.theme = theme;
    globalThis.openai = {
      ...globalThis.openai,
      openExternal,
      setWidgetState,
      theme,
      visualizationStyleVariables: {},
      visualizationTheme: theme,
      widgetState: state,
      statePersistence,
      stateModelContext: "none",
    };
    globalThis.dispatchEvent(
      new CustomEvent("openai:set_globals", {
        detail: { globals: globalThis.openai },
      }),
    );
  };
  const sendHeight = () => {
    postToHost("height", {
      height: Math.ceil(
        Math.max(
          document.body.scrollHeight,
          document.body.getBoundingClientRect().height,
        ),
      ),
    });
  };

  globalThis.addEventListener(
    "message",
    (event) => {
      const data = apply(getMessageData, event, []);
      const ports = apply(getMessagePorts, event, []);
      const source = apply(getMessageSource, event, []);
      if (
        hostPort != null ||
        source !== parentWindow ||
        typeof data !== "object" ||
        data?.type !== "codex-visualization-initialize" ||
        !isArray(ports) ||
        ports.length !== 1
      ) {
        return;
      }
      apply(stopMessagePropagation, event, []);
      const nextHostPort = ports[0];
      try {
        apply(addHostMessageListener, nextHostPort, [
          "message",
          (event) => {
            const data = apply(getMessageData, event, []);
            if (typeof data === "object" && data?.type === "measure") {
              sendHeight();
            } else if (
              typeof data === "object" &&
              data?.type === "widget-state-result"
            ) {
              const id = data.id;
              if (typeof id !== "number") {
                return;
              }
              const pending = pendingStateWrites.get(id);
              if (pending != null) {
                pendingStateWrites.delete(id);
                globalThis.clearTimeout(pending.timeout);
                if (data.ok === true) {
                  pending.resolve();
                } else {
                  pending.reject(persistenceError());
                }
              }
            }
          },
        ]);
        apply(startHostPort, nextHostPort, []);
      } catch {
        return;
      }
      hostPort = nextHostPort;
      for (const [id, { serializedState }] of pendingStateWrites) {
        postToHost("widget-state-write", { id, state: serializedState });
      }
      sendHeight();
    },
    { capture: true },
  );
  document.currentScript?.remove();
  mediaQuery.addEventListener("change", syncTheme);
  globalThis.addEventListener("click", (event) => {
    if (event.defaultPrevented) {
      return;
    }
    let element = null;
    if (event.target instanceof globalThis.Element) {
      element = event.target;
    } else if (event.target instanceof globalThis.Node) {
      element = event.target.parentElement;
    }
    const link = element?.closest("a[href]");
    const href = link?.getAttribute("href");
    if (href == null) {
      return;
    }
    if (href.startsWith("#")) {
      let id;
      try {
        id = decodeURIComponent(href.slice(1));
      } catch {
        return;
      }
      const target = id.length === 0 ? root : document.getElementById(id);
      if (
        target == null ||
        globalThis.navigator.userActivation?.isActive !== true
      ) {
        return;
      }
      event.preventDefault();
      postToHost("scroll-to", {
        top: target.getBoundingClientRect().top + globalThis.scrollY,
      });
      return;
    }
    event.preventDefault();
    openExternal({ href });
  });
  new ResizeObserver(sendHeight).observe(document.body);
  syncTheme();
}

export function outerHostBridge() {
  const frame = document.getElementById("codex-visualization");
  if (!(frame instanceof HTMLIFrameElement)) {
    return;
  }
  let viewportHeight = globalThis.innerHeight;
  const storageKey = `codex:visualization-widget-state-v2:${JSON.stringify([
    globalThis.location.pathname,
    globalThis.location.search,
  ])}`;
  const parseState = (serializedState) => {
    if (
      typeof serializedState !== "string" ||
      new TextEncoder().encode(serializedState).length > 16 * 1024
    ) {
      throw new TypeError(
        "Widget state must be a JSON object of at most 16 KiB",
      );
    }
    const state = JSON.parse(serializedState);
    if (
      state == null ||
      typeof state !== "object" ||
      Array.isArray(state) ||
      ("imageIds" in state &&
        (!Array.isArray(state.imageIds) || state.imageIds.length > 0))
    ) {
      throw new TypeError("Widget state must be a JSON object");
    }
    const storedState = { modelContent: null, privateContent: null, ...state };
    const canonicalState = JSON.stringify(storedState, (_key, value) => {
      if (typeof value === "number" && !Number.isFinite(value)) {
        throw new TypeError("Widget state must contain finite numbers");
      }
      return value;
    });
    if (new TextEncoder().encode(canonicalState).length > 16 * 1024) {
      throw new TypeError(
        "Widget state must be a JSON object of at most 16 KiB",
      );
    }
    return storedState;
  };
  let storage = null;
  let state = null;
  try {
    const localStorage = globalThis.localStorage;
    const probeKey = `${storageKey}:probe`;
    localStorage.setItem(probeKey, "1");
    localStorage.removeItem(probeKey);
    storage = localStorage;
    const savedState = storage.getItem(storageKey);
    if (savedState != null) {
      try {
        state = parseState(savedState);
      } catch {
      }
    }
  } catch {
    storage = null;
  }
  const initialGlobals = {
    widgetState: state,
    statePersistence: storage == null ? "none" : "local",
  };

  const channel = new MessageChannel();
  channel.port1.addEventListener("message", (event) => {
    const data = event.data;
    if (typeof data !== "object" || data == null) {
      return;
    }
    if (data.type === "widget-state-write") {
      if (!Number.isSafeInteger(data.id) || data.id <= 0) {
        return;
      }
      let ok = false;
      try {
        if (storage != null) {
          const state = parseState(data.state);
          storage.setItem(storageKey, JSON.stringify(state));
          ok = true;
        }
      } catch {
      }
      channel.port1.postMessage({
        type: "widget-state-result",
        id: data.id,
        ok,
      });
      return;
    }
    if (data.type === "height") {
      const height = data.height;
      if (
        typeof height !== "number" ||
        !Number.isFinite(height) ||
        height < 0
      ) {
        return;
      }
      if (height <= 10_000) {
        frame.style.height = Math.ceil(height) + "px";
      }
      return;
    }
    if (data.type === "scroll-to") {
      const top = data.top;
      if (
        typeof top === "number" &&
        Number.isFinite(top) &&
        top >= 0 &&
        globalThis.navigator.userActivation?.isActive === true
      ) {
        globalThis.scrollTo({
          top: Math.ceil(
            globalThis.scrollY + frame.getBoundingClientRect().top + top,
          ),
        });
      }
      return;
    }
    if (data.type === "open-external") {
      const rawHref = data.href;
      if (typeof rawHref !== "string") {
        return;
      }
      let href;
      let isNotionApp = false;
      try {
        const url = new URL(rawHref, document.baseURI);
        if (url.protocol === "notion:") {
          const notionHosts = ["app.notion.com", "notion.so", "www.notion.so"];
          if (
            !notionHosts.includes(url.hostname) ||
            url.host !== url.hostname ||
            url.username !== "" ||
            url.password !== ""
          ) {
            return;
          }
          isNotionApp = true;
        } else if (url.protocol !== "https:") {
          return;
        }
        href = url.href;
      } catch {
        return;
      }
      if (globalThis.navigator.userActivation?.isActive === true) {
        const anchor = document.createElement("a");
        anchor.href = href;
        if (!isNotionApp) {
          anchor.rel = "noopener noreferrer";
          anchor.target = "_blank";
        }
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      }
    }
  });
  channel.port1.start();
  const srcdoc = frame.dataset.srcdoc;
  if (srcdoc == null) {
    return;
  }
  globalThis.addEventListener("resize", () => {
    const height = Number.parseFloat(frame.style.height);
    if (!Number.isFinite(height) || height <= viewportHeight) {
      frame.style.removeProperty("height");
    }
    viewportHeight = globalThis.innerHeight;
    channel.port1.postMessage({ type: "measure" });
  });
  frame.addEventListener(
    "load",
    () => {
      frame.contentWindow?.postMessage(
        { type: "codex-visualization-initialize" },
        "*",
        [channel.port2],
      );
    },
    { once: true },
  );
  const frameHtml = srcdoc.replace(
    '<script type="application/json" id="codex-visualization-widget-state">__CODEX_VISUALIZATION_WIDGET_STATE__<\/script>',
    () =>
      '<script type="application/json" id="codex-visualization-widget-state">' +
      JSON.stringify(initialGlobals).replaceAll("<", "\\u003c") +
      "<\/script>",
  );
  frame.srcdoc = frameHtml;
  delete frame.dataset.srcdoc;
}
