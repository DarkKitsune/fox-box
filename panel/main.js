"use strict";
(() => {
  // node_modules/@openchamber/sdk/dist/api-version.js
  var OPENCHAMBER_SDK_CHANNEL = "openchamber.sdk";
  var OPENCHAMBER_SDK_API_VERSION = 1;

  // node_modules/@openchamber/sdk/dist/scrollbar-style.js
  var GUEST_SCROLLING_ATTRIBUTE = "data-oc-scrolling";
  var GUEST_SCROLLBAR_CSS = `
:root {
  /* Quiet at rest like the app's own thumbs; hover gives a clear grab target. */
  --oc-scrollbar-thumb: color-mix(in srgb, var(--oc-muted, currentColor) 18%, transparent);
  --oc-scrollbar-thumb-hover: color-mix(in srgb, var(--oc-muted, currentColor) 36%, transparent);
  scrollbar-gutter: stable;
}
* {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}
:hover, [${GUEST_SCROLLING_ATTRIBUTE}] {
  scrollbar-color: var(--oc-scrollbar-thumb) transparent;
}
/* Chromium's standard scrollbar properties otherwise override its pseudo-elements. */
@supports selector(::-webkit-scrollbar) {
  *, :hover, [${GUEST_SCROLLING_ATTRIBUTE}] { scrollbar-width: auto; scrollbar-color: auto; }
  ::-webkit-scrollbar { width: 6px; height: 6px; background: transparent; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 999px;
    min-width: 24px;
    min-height: 24px;
  }
  :hover::-webkit-scrollbar-thumb, [${GUEST_SCROLLING_ATTRIBUTE}]::-webkit-scrollbar-thumb { background: var(--oc-scrollbar-thumb); }
  ::-webkit-scrollbar-thumb:hover { background: var(--oc-scrollbar-thumb-hover); }
  ::-webkit-scrollbar-corner { background: transparent; }
  ::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
}
@media (forced-colors: active) {
  *, :hover, [${GUEST_SCROLLING_ATTRIBUTE}] { scrollbar-color: auto; }
  ::-webkit-scrollbar-thumb, ::-webkit-scrollbar-thumb:hover { background: CanvasText; }
}
`;
  function installGuestScrollbarActivity(doc) {
    const root2 = doc.documentElement;
    if (root2.hasAttribute("data-oc-scrollbar-activity"))
      return;
    root2.setAttribute("data-oc-scrollbar-activity", "");
    const timers = /* @__PURE__ */ new WeakMap();
    doc.addEventListener("scroll", (event) => {
      const target = event.target === doc ? root2 : event.target;
      if (!(target instanceof Element))
        return;
      if (!target.hasAttribute("data-oc-scrolling"))
        target.setAttribute("data-oc-scrolling", "");
      const pending = timers.get(target);
      if (pending !== void 0)
        clearTimeout(pending);
      timers.set(target, setTimeout(() => {
        timers.delete(target);
        target.removeAttribute("data-oc-scrolling");
      }, 1e3));
    }, { capture: true, passive: true });
  }
  var GUEST_SCROLLBAR_SCRIPT = `(${installGuestScrollbarActivity.toString()})(document);`;

  // node_modules/@openchamber/sdk/dist/workspace.js
  var GUEST_STORAGE_KEY_MAX = 128;
  var GUEST_STORAGE_VALUE_BYTES = 65536;

  // node_modules/@openchamber/sdk/dist/shells.js
  var GUEST_SHELL_ID_MAX = 128;
  var GUEST_SHELL_OUTPUT_TAIL_MAX = 65536;

  // node_modules/@openchamber/sdk/dist/microphone.js
  var GUEST_MICROPHONE_SAMPLE_RATE_MIN = 8e3;
  var GUEST_MICROPHONE_SAMPLE_RATE_MAX = 192e3;
  var GUEST_MICROPHONE_OPEN_TIMEOUT_MS = 12e4;
  var createSampleQueue = (capacity) => {
    const chunks = [];
    let offset = 0;
    let queued = 0;
    return {
      push: (samples) => {
        chunks.push(samples);
        queued += samples.length;
        while (queued - offset > capacity && chunks.length > 1) {
          const dropped = chunks.shift();
          queued -= dropped?.length ?? 0;
          offset = 0;
        }
      },
      /** Fills `out` from the queue and pads the rest with silence. */
      pull: (out) => {
        let written = 0;
        while (written < out.length && chunks.length > 0) {
          const head = chunks[0];
          const count = Math.min(out.length - written, head.length - offset);
          out.set(head.subarray(offset, offset + count), written);
          written += count;
          offset += count;
          if (offset >= head.length) {
            chunks.shift();
            queued -= head.length;
            offset = 0;
          }
        }
        out.fill(0, written);
      },
      clear: () => {
        chunks.length = 0;
        offset = 0;
        queued = 0;
      },
      get size() {
        return queued - offset;
      }
    };
  };

  // node_modules/@openchamber/sdk/dist/status-controls.js
  var GUEST_STATUS_CONTROLS_MAX = 4;
  var GUEST_STATUS_CONTROL_ID = /^[a-z][a-z0-9-]{0,39}$/;
  var GUEST_STATUS_CONTROL_LABEL_MAX = 60;
  var GUEST_STATUS_CONTROL_OPTIONS_MAX = 16;
  var GUEST_STATUS_CONTROL_VALUE_MAX = 80;
  var isControlObject = (value) => Object(value) === value && !Array.isArray(value);
  var hasOnlyKeys = (value, keys) => Object.keys(value).every((key) => keys.includes(key));
  var isLabel = (value) => String(value) === value && value.length >= 1 && value.length <= GUEST_STATUS_CONTROL_LABEL_MAX;
  var isValue = (value) => String(value) === value && value.length >= 1 && value.length <= GUEST_STATUS_CONTROL_VALUE_MAX;
  var isGuestStatusControls = (controls) => {
    if (!Array.isArray(controls) || controls.length > GUEST_STATUS_CONTROLS_MAX)
      return false;
    const ids = /* @__PURE__ */ new Set();
    for (const control of controls) {
      if (!isControlObject(control) || !GUEST_STATUS_CONTROL_ID.test(control.id) || !isLabel(control.label))
        return false;
      if (control.disabled !== void 0 && control.disabled !== true && control.disabled !== false)
        return false;
      if (ids.has(control.id))
        return false;
      ids.add(control.id);
      if (control.kind === "button") {
        if (!hasOnlyKeys(control, ["kind", "id", "label", "disabled"]))
          return false;
        continue;
      }
      if (control.kind !== "select" || !hasOnlyKeys(control, ["kind", "id", "label", "value", "options", "disabled"]))
        return false;
      if (!isValue(control.value) || !Array.isArray(control.options) || control.options.length < 1 || control.options.length > GUEST_STATUS_CONTROL_OPTIONS_MAX)
        return false;
      const values = /* @__PURE__ */ new Set();
      for (const option of control.options) {
        if (!isControlObject(option) || !hasOnlyKeys(option, ["value", "label"]) || !isValue(option.value) || !isLabel(option.label) || values.has(option.value))
          return false;
        values.add(option.value);
      }
      if (!values.has(control.value))
        return false;
    }
    return true;
  };

  // node_modules/@openchamber/sdk/dist/manifest.js
  var GUEST_PROVIDER_LOGO_BYTES_MAX = 1024 * 1024;
  var TRACKER_URL_TOKENS = ["{id}", "{segment}", "{segments+}"];
  var TRACKER_URL_TOKEN_SET = new Set(TRACKER_URL_TOKENS);

  // node_modules/@openchamber/sdk/dist/session-events.js
  var GUEST_SESSION_EVENT_TYPES = [
    "turn-finished",
    "turn-failed",
    "permission-asked",
    "question-asked",
    "turn-started",
    "session-created",
    "session-archived",
    "session-deleted"
  ];
  var SESSION_EVENTS_IDLE_MS = 10 * 6e4;
  var EVENT_TYPES = new Set(GUEST_SESSION_EVENT_TYPES);

  // node_modules/@openchamber/sdk/dist/service-host.js
  var SERVICE_SCHEDULE_IDLE_MS = 10 * 6e4;
  var MENTIONS_IDLE_MS = 10 * 6e4;

  // node_modules/@openchamber/sdk/dist/file-editor.js
  var GUEST_FILE_EDITOR_CONTENT_MAX = 2e7;
  var GUEST_FILE_EDITOR_VERSION_MAX = 256;
  var fileEditorPayloadSize = (value) => "bytes" in value ? value.bytes.byteLength : value.content.length;
  var sameFileEditorDocument = (left, right) => {
    if (left.path !== right.path || left.readOnly !== right.readOnly)
      return false;
    if (left.encoding === "text" || right.encoding === "text") {
      return left.encoding === "text" && right.encoding === "text" && left.content === right.content;
    }
    if (left.bytes.byteLength !== right.bytes.byteLength)
      return false;
    for (let index = 0; index < left.bytes.byteLength; index += 1) {
      if (left.bytes[index] !== right.bytes[index])
        return false;
    }
    return true;
  };

  // node_modules/@openchamber/sdk/dist/popover.js
  var GUEST_POPOVER_ID = /^[A-Za-z0-9_-]{1,80}$/;
  var GUEST_POPOVER_COORDINATE_MAX = 1e5;
  var GUEST_POPOVER_WIDTH_MIN = 160;
  var GUEST_POPOVER_WIDTH_MAX = 640;
  var GUEST_POPOVER_HEIGHT_MIN = 48;
  var GUEST_POPOVER_HEIGHT_MAX = 480;
  var GUEST_POPOVER_DATA_MAX = 16e3;
  var GUEST_POPOVER_DATA_DEPTH_MAX = 32;
  var GUEST_POPOVER_SIDES = ["left", "right", "top", "bottom"];
  var hasBoundedJsonTree = (value, depth = 0, budget = { remaining: GUEST_POPOVER_DATA_MAX }) => {
    if (--budget.remaining < 0 || depth >= GUEST_POPOVER_DATA_DEPTH_MAX)
      return false;
    if (value === null)
      return true;
    const children = Array.isArray(value) ? value : Object(value) === value ? Object.values(value) : [];
    for (const item of children) {
      if (!hasBoundedJsonTree(item, depth + 1, budget))
        return false;
    }
    return true;
  };
  var isFiniteJson = (value) => {
    if (value === null || value === true || value === false)
      return true;
    if (Array.isArray(value))
      return Object.keys(value).every((key) => /^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length) && value.every(isFiniteJson);
    if (Object(value) === value) {
      const prototype = Object.getPrototypeOf(value);
      return (prototype === null || prototype === Object.prototype) && Object.values(value).every(isFiniteJson);
    }
    return String(value) === value || Number.isFinite(value);
  };
  var isGuestPopoverRequest = (request) => {
    try {
      if (String(request.id) !== request.id || !GUEST_POPOVER_ID.test(request.id) || !Number.isFinite(request.anchor.x) || Math.abs(request.anchor.x) > GUEST_POPOVER_COORDINATE_MAX || !Number.isFinite(request.anchor.y) || Math.abs(request.anchor.y) > GUEST_POPOVER_COORDINATE_MAX || !Number.isFinite(request.anchor.width) || !Number.isFinite(request.anchor.height) || request.anchor.width <= 0 || request.anchor.height <= 0 || request.anchor.width > GUEST_POPOVER_COORDINATE_MAX || request.anchor.height > GUEST_POPOVER_COORDINATE_MAX || !Number.isInteger(request.width) || request.width < GUEST_POPOVER_WIDTH_MIN || request.width > GUEST_POPOVER_WIDTH_MAX || !Number.isInteger(request.height) || request.height < GUEST_POPOVER_HEIGHT_MIN || request.height > GUEST_POPOVER_HEIGHT_MAX || request.side !== void 0 && !GUEST_POPOVER_SIDES.includes(request.side) || request.focus !== void 0 && request.focus !== true && request.focus !== false || !hasBoundedJsonTree(request.data) || !isFiniteJson(request.data))
        return false;
      return JSON.stringify(request.data).length <= GUEST_POPOVER_DATA_MAX;
    } catch {
      return false;
    }
  };

  // node_modules/@openchamber/sdk/dist/contract.js
  var GUEST_BLOCK_ANSWER_MAX = 2e3;
  var GUEST_FILE_STAT_KINDS = ["file", "directory", "other", "missing"];
  var isStartSessionResult = (value) => Boolean(value && "sessionId" in value);
  var isPromptResult = (value) => Boolean(value && "sent" in value && !("sessionId" in value));
  var GUEST_COMMIT_SHA = /^[0-9a-f]{7,64}$/i;
  var isGuestCommitSha = (value) => GUEST_COMMIT_SHA.test(value);
  var GUEST_TOAST_MAX = 500;
  var GUEST_CLIPBOARD_TEXT_MAX = 32e3;
  var GUEST_COMPOSE_TEXT_MAX = 16e3;
  var GUEST_ATTACH_ID_MAX = 128;
  var GUEST_ATTACH_TITLE_MAX = 200;
  var GUEST_ATTACH_URL_MAX = 2e3;
  var GUEST_ATTACH_TEXT_MAX = 16e3;
  var GUEST_ATTACH_AUTHOR_MAX = 80;
  var GUEST_ATTACH_BRANCH_MAX = 200;
  var GUEST_ATTACH_DATA_MAX = 16e3;
  var GUEST_REQUEST_PATH_MAX = 2e3;
  var GUEST_REQUEST_TIMEOUT_MS = 2e4;
  var GUEST_FILE_PATH_MAX = 1024;
  var GUEST_FILE_CONTENT_MAX = 2e6;
  var GUEST_GENERATE_PROMPT_MAX = 64e3;
  var GUEST_GENERATE_SYSTEM_MAX = 8e3;
  var GUEST_GENERATE_OUTPUT_TOKENS_MAX = 4e3;
  var GUEST_GENERATE_TIMEOUT_MS = 96e4;
  var GUEST_GENERATE_LATE_KEEP_MS = 60 * 6e4;
  var GUEST_BADGE_MAX = 999;
  var GUEST_FRAME_HEIGHT_MAX = 1e4;
  var GUEST_RESOLVE_ERROR_MAX = 500;
  var HOST_REQUEST_ERROR_CODES = [
    "HOST_UNAVAILABLE",
    "HOST_TIMEOUT",
    "HOST_REJECTED",
    "DISCONNECTED",
    "DISABLED",
    "BAD_PATH",
    "NO_INTEGRATION",
    "NO_SERVICE",
    "SERVICE_FAILED",
    "REQUEST_FAILED",
    "RESPONSE_TOO_LARGE",
    "NO_SESSION",
    "SESSION_BUSY",
    "NOT_GRANTED",
    "NO_DIRECTORY",
    "NOT_FOUND",
    "FILE_TOO_LARGE",
    "DENIED",
    "NO_MODEL",
    "MODEL_FAILED",
    "UNSUPPORTED"
  ];
  var SERVICE_STATUS_VALUES = ["stopped", "starting", "ready", "failed"];
  var hostRequestErrorCodeSet = new Set(HOST_REQUEST_ERROR_CODES);
  var isHostRequestErrorCode = (value) => hostRequestErrorCodeSet.has(value);
  var resolveHostRequestErrorCode = (value) => value && isHostRequestErrorCode(value) ? value : "HOST_REJECTED";
  var isJsonValue = (value) => {
    if (value === void 0)
      return false;
    if (value === null || value === true || value === false)
      return true;
    if (String(value) === value)
      return true;
    if (Number(value) === value)
      return Number.isFinite(value);
    if (Array.isArray(value))
      return value.every(isJsonValue);
    if (Object(value) === value)
      return Object.values(value).every(isJsonValue);
    return false;
  };
  var isAttachData = (value) => isJsonValue(value) && JSON.stringify(value).length <= GUEST_ATTACH_DATA_MAX;
  var clampBranch = (value) => value?.trim().slice(0, GUEST_ATTACH_BRANCH_MAX) ?? "";
  var clampAttachRequest = (request) => {
    const id = request.id.trim().slice(0, GUEST_ATTACH_ID_MAX);
    const title = request.title.trim().slice(0, GUEST_ATTACH_TITLE_MAX);
    const url = request.url.trim().slice(0, GUEST_ATTACH_URL_MAX);
    const text = request.text?.trim().slice(0, GUEST_ATTACH_TEXT_MAX);
    const author = request.author?.trim().slice(0, GUEST_ATTACH_AUTHOR_MAX);
    const kind = request.kind === "pull" ? "pull" : "issue";
    const next = {
      providerId: request.providerId.trim(),
      id,
      title: title || id,
      url,
      kind
    };
    if (text) {
      next.text = text;
    }
    if (author) {
      next.author = author;
    }
    if (kind === "pull") {
      const head = clampBranch(request.branches?.head);
      const base = clampBranch(request.branches?.base);
      if (head && base) {
        next.branches = { head, base };
      }
    }
    if (isAttachData(request.data)) {
      next.data = request.data;
    }
    return next;
  };
  var clampStartSessionRequest = (request) => {
    const next = clampAttachRequest(request);
    if (request.projectId)
      next.projectId = request.projectId;
    if (request.navigation)
      next.navigation = request.navigation;
    if (request.worktree) {
      next.worktree = request.worktree;
    }
    return next;
  };
  var clampPromptRequest = (request) => {
    const next = {
      text: request.text.trim().slice(0, GUEST_COMPOSE_TEXT_MAX)
    };
    if (request.send) {
      next.send = true;
    }
    return next;
  };
  var clampBadgeCount = (count) => {
    if (count === null || !Number.isFinite(count))
      return null;
    return Math.min(GUEST_BADGE_MAX, Math.max(0, Math.round(count)));
  };
  var clampFrameHeight = (height) => {
    if (!Number.isFinite(height))
      return 0;
    return Math.min(GUEST_FRAME_HEIGHT_MAX, Math.max(0, Math.ceil(height)));
  };
  var isGuestFilePath = (value) => value.length > 0 && value.length <= GUEST_FILE_PATH_MAX && !value.includes("\0") && !value.includes("\\");
  var isGuestRequestPath = (value) => {
    if (!value.startsWith("/") || value.includes("\0") || value.includes("\\") || value.includes("://")) {
      return false;
    }
    if (value.length > GUEST_REQUEST_PATH_MAX) {
      return false;
    }
    const segments = value.split("/");
    return !segments.some((segment) => segment === "." || segment === "..");
  };
  var serviceStatusSet = new Set(SERVICE_STATUS_VALUES);
  var isServiceStatusResult = (value) => Boolean(value && "status" in value && serviceStatusSet.has(String(value.status)) && !("body" in value));
  var isGuestRequestResult = (value) => Boolean(value && "status" in value && "body" in value && Number.isInteger(value.status));
  var isFileReadResult = (value) => Boolean(value && "content" in value && String(value.content) === value.content);
  var isFileWriteResult = (value) => Boolean(value && "written" in value && value.written === true);
  var isFileListResult = (value) => Boolean(value && "entries" in value && Array.isArray(value.entries));
  var fileStatKindSet = new Set(GUEST_FILE_STAT_KINDS);
  var isFileStatResult = (value) => Boolean(value && "kind" in value && "size" in value && fileStatKindSet.has(String(value.kind)) && Number.isFinite(value.size));
  var isGenerateResult = (value) => Boolean(value && "text" in value && String(value.text) === value.text && !("status" in value));
  var HOST_PUSH_TYPES = /* @__PURE__ */ new Set([
    "workspace",
    "shells",
    "ready",
    "directory",
    "session",
    "connection",
    "settings",
    "session-lifecycle",
    "item",
    "resolve",
    "action",
    "service-event",
    "status-control-event",
    "popover-closed",
    "file-open",
    "file-snapshot",
    "file-saved",
    "generate-late",
    "microphone-audio",
    "microphone-ended"
  ]);
  var asWireRecord = (data) => Object(data) === data ? data : null;
  var isNonEmptyString = (value) => String(value) === value && value.length > 0;
  var readResultMessage = (wire) => {
    if (!isNonEmptyString(wire.id))
      return null;
    if (wire.ok === true) {
      const message = {
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "result",
        id: wire.id,
        ok: true
      };
      if (Object(wire.payload) === wire.payload) {
        message.payload = wire.payload;
      }
      return message;
    }
    if (wire.ok === false && isNonEmptyString(wire.error)) {
      return {
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "result",
        id: wire.id,
        ok: false,
        error: wire.error,
        code: resolveHostRequestErrorCode(isNonEmptyString(wire.code) ? wire.code : void 0)
      };
    }
    return null;
  };
  var readHostMessage = (data) => {
    const wire = asWireRecord(data);
    if (!wire || wire.channel !== OPENCHAMBER_SDK_CHANNEL || wire.v !== OPENCHAMBER_SDK_API_VERSION)
      return null;
    if (wire.type === "result")
      return readResultMessage(wire);
    if (!HOST_PUSH_TYPES.has(String(wire.type)) || Object(wire.payload) !== wire.payload)
      return null;
    return wire;
  };

  // node_modules/@openchamber/sdk/dist/host.js
  var isKeyEvent = (event) => "key" in event && "metaKey" in event && "ctrlKey" in event;
  var isSaveShortcut = (event) => (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "s";
  var HostRequestError = class extends Error {
    code;
    constructor(code, message) {
      super(message);
      this.name = "HostRequestError";
      this.code = code;
    }
  };
  var rejectBadPath = () => Promise.reject(new HostRequestError("BAD_PATH", 'Request path must start with "/" and stay on the declared origin.'));
  var rejectBadFilePath = () => Promise.reject(new HostRequestError("BAD_PATH", `File path must be 1 to ${GUEST_FILE_PATH_MAX} characters without NUL or backslash.`));
  var deviceStorageScope = (options) => {
    if (options === void 0)
      return void 0;
    if (Object(options) !== options || Array.isArray(options) || options.scope !== void 0 && options.scope !== "instance" && options.scope !== "device") {
      throw new HostRequestError("HOST_REJECTED", 'Storage scope must be "instance" or "device".');
    }
    return options.scope === "device" ? "device" : void 0;
  };
  var nextId = (n) => {
    n.value += 1;
    return `oc-${n.value}`;
  };
  var connectHost = (options = {}) => {
    const target = options.target ?? ("window" in globalThis ? window : null);
    if (!target) {
      throw new HostRequestError("HOST_UNAVAILABLE", "No window. connectHost runs in a browser frame.");
    }
    const acceptSource = options.acceptSource ?? ((source) => source === target.parent);
    const requestTimeoutMs = options.requestTimeoutMs ?? GUEST_REQUEST_TIMEOUT_MS;
    const readyListeners = /* @__PURE__ */ new Set();
    const directoryListeners = /* @__PURE__ */ new Set();
    const sessionListeners = /* @__PURE__ */ new Set();
    const lifecycleListeners = /* @__PURE__ */ new Set();
    const connectionListeners = /* @__PURE__ */ new Set();
    const settingsListeners = /* @__PURE__ */ new Set();
    const itemListeners = /* @__PURE__ */ new Set();
    const blockListeners = /* @__PURE__ */ new Set();
    const serviceEventListeners = /* @__PURE__ */ new Set();
    const statusControlListeners = /* @__PURE__ */ new Set();
    const popoverClosedListeners = /* @__PURE__ */ new Set();
    const lateGenerateListeners = /* @__PURE__ */ new Set();
    const unclaimedLateGenerate = [];
    let resolveHandler = null;
    let actionHandler = null;
    const fileOpenListeners = /* @__PURE__ */ new Set();
    const fileSavedListeners = /* @__PURE__ */ new Set();
    let fileSnapshotHandler = null;
    let lastFile = null;
    let saveShortcutInstalled = false;
    const pending = /* @__PURE__ */ new Map();
    const workspaceListeners = /* @__PURE__ */ new Map();
    const shellsListeners = /* @__PURE__ */ new Map();
    let disposed = false;
    const ids = { value: 0 };
    let lastReady = null;
    let lastLifecycle = null;
    let popoverPointerActive = false;
    let popoverFocusActive = false;
    let popoverActivityReported = null;
    let microphone = null;
    const lifecycleFromSession = (session) => {
      if (!session)
        return null;
      return {
        sessionId: session.id,
        phase: session.busy ? "started" : "completed"
      };
    };
    const post = (message) => {
      target.parent.postMessage(message, "*");
    };
    const listenForLateGenerate = () => {
      if (disposed || target.parent === target || lateGenerateListeners.size === 0 || lastReady?.features?.lateGenerateResults !== true)
        return;
      post({ channel: OPENCHAMBER_SDK_CHANNEL, v: OPENCHAMBER_SDK_API_VERSION, type: "generate-late-listen" });
    };
    const emit = (listeners, value) => {
      for (const listener of listeners) {
        try {
          listener(value);
        } catch (error) {
          console.error(error);
        }
      }
    };
    const onMessage = (event) => {
      if (!(event instanceof MessageEvent))
        return;
      if (!acceptSource(event.source))
        return;
      const message = readHostMessage(event.data);
      if (!message)
        return;
      if (message.type === "workspace") {
        const listener = workspaceListeners.get(message.payload.subscriptionId);
        if (listener)
          emit([listener], message.payload.snapshot);
        return;
      }
      if (message.type === "shells") {
        const listener = shellsListeners.get(message.payload.subscriptionId);
        if (listener)
          emit([listener], message.payload.snapshot);
        return;
      }
      if (message.type === "microphone-audio") {
        microphone?.queue.push(message.payload.samples);
        return;
      }
      if (message.type === "microphone-ended") {
        const open = microphone;
        if (!open)
          return;
        microphone = null;
        open.release();
        emit(open.endedListeners, message.payload.reason);
        return;
      }
      if (message.type === "ready") {
        lastReady = message.payload;
        lastLifecycle = lifecycleFromSession(message.payload.session);
        emit(readyListeners, message.payload);
        emit(directoryListeners, message.payload.directory);
        emit(sessionListeners, message.payload.session);
        if (lastLifecycle) {
          emit(lifecycleListeners, lastLifecycle);
        }
        emit(connectionListeners, message.payload.connection);
        emit(settingsListeners, message.payload.settings);
        emit(itemListeners, message.payload.item);
        if (message.payload.block)
          emit(blockListeners, message.payload.block);
        listenForLateGenerate();
        return;
      }
      if (message.type === "service-event") {
        emit(serviceEventListeners, message.payload);
        return;
      }
      if (message.type === "generate-late") {
        if (lateGenerateListeners.size === 0)
          unclaimedLateGenerate.push(message.payload);
        else
          emit(lateGenerateListeners, message.payload);
        return;
      }
      if (message.type === "directory") {
        if (lastReady) {
          lastReady = { ...lastReady, directory: message.payload.directory };
        }
        emit(directoryListeners, message.payload.directory);
        return;
      }
      if (message.type === "session") {
        if (lastReady) {
          lastReady = { ...lastReady, session: message.payload.session };
        }
        if (!message.payload.session) {
          lastLifecycle = null;
        } else if (lastLifecycle?.sessionId !== message.payload.session.id) {
          lastLifecycle = lifecycleFromSession(message.payload.session);
        }
        emit(sessionListeners, message.payload.session);
        return;
      }
      if (message.type === "session-lifecycle") {
        lastLifecycle = message.payload;
        emit(lifecycleListeners, message.payload);
        return;
      }
      if (message.type === "connection") {
        if (lastReady) {
          lastReady = { ...lastReady, connection: message.payload.connection };
        }
        emit(connectionListeners, message.payload.connection);
        return;
      }
      if (message.type === "settings") {
        if (lastReady) {
          lastReady = { ...lastReady, settings: message.payload.settings };
        }
        emit(settingsListeners, message.payload.settings);
        return;
      }
      if (message.type === "item") {
        if (lastReady) {
          lastReady = { ...lastReady, item: message.payload.item };
        }
        emit(itemListeners, message.payload.item);
        return;
      }
      if (message.type === "status-control-event") {
        emit(statusControlListeners, message.payload);
        return;
      }
      if (message.type === "popover-closed") {
        emit(popoverClosedListeners, message.payload);
        return;
      }
      if (message.type === "action") {
        const answer = (payload) => {
          if (!disposed)
            post({
              channel: OPENCHAMBER_SDK_CHANNEL,
              v: OPENCHAMBER_SDK_API_VERSION,
              type: "action-result",
              id: message.id,
              payload
            });
        };
        const handler = actionHandler;
        if (!handler) {
          answer({ ok: false, error: "This extension does not handle background actions." });
          return;
        }
        Promise.resolve().then(() => handler(message.payload)).then(() => answer({ ok: true }), (error) => {
          const text = (error instanceof Error ? error.message : String(error)).trim();
          answer({ ok: false, error: (text || "Action failed.").slice(0, GUEST_RESOLVE_ERROR_MAX) });
        });
        return;
      }
      if (message.type === "file-open") {
        const next = message.payload;
        if (lastFile && sameFileEditorDocument(lastFile, next))
          return;
        lastFile = next;
        emit(fileOpenListeners, message.payload);
        return;
      }
      if (message.type === "file-saved") {
        emit(fileSavedListeners, message.payload.version);
        return;
      }
      if (message.type === "file-snapshot") {
        const answer = (payload) => {
          if (!disposed)
            post({
              channel: OPENCHAMBER_SDK_CHANNEL,
              v: OPENCHAMBER_SDK_API_VERSION,
              type: "file-snapshot-result",
              id: message.id,
              payload
            });
        };
        const fail = (text) => answer({ error: (text.trim() || "Could not read the edited file.").slice(0, GUEST_RESOLVE_ERROR_MAX) });
        const handler = fileSnapshotHandler;
        if (!handler) {
          fail("This extension does not edit files.");
          return;
        }
        Promise.resolve().then(() => handler(message.payload.purpose)).then((snapshot) => {
          if (fileEditorPayloadSize(snapshot) > GUEST_FILE_EDITOR_CONTENT_MAX) {
            fail(`The file is over ${GUEST_FILE_EDITOR_CONTENT_MAX} ${"bytes" in snapshot ? "bytes" : "characters"}.`);
            return;
          }
          if (snapshot.version.length > GUEST_FILE_EDITOR_VERSION_MAX) {
            fail(`The snapshot version is over ${GUEST_FILE_EDITOR_VERSION_MAX} characters.`);
            return;
          }
          answer({ snapshot: "bytes" in snapshot ? { bytes: snapshot.bytes, version: snapshot.version } : { content: snapshot.content, version: snapshot.version } });
        }, (error) => fail(error instanceof Error ? error.message : String(error)));
        return;
      }
      if (message.type === "resolve") {
        const answer = (payload) => {
          post({
            channel: OPENCHAMBER_SDK_CHANNEL,
            v: OPENCHAMBER_SDK_API_VERSION,
            type: "resolve-result",
            id: message.id,
            payload
          });
        };
        const handler = resolveHandler;
        if (!handler) {
          answer({ error: "This extension does not resolve commands." });
          return;
        }
        Promise.resolve().then(() => handler(message.payload)).then((item) => answer({ item: item ? clampAttachRequest(item) : null }), (error) => {
          const text = (error instanceof Error ? error.message : String(error)).trim();
          answer({ error: (text || "Command failed.").slice(0, GUEST_RESOLVE_ERROR_MAX) });
        });
        return;
      }
      const waiter = pending.get(message.id);
      if (!waiter)
        return;
      clearTimeout(waiter.timer);
      pending.delete(message.id);
      if (message.ok) {
        waiter.resolve(message.payload);
        return;
      }
      waiter.reject(new HostRequestError(message.code, message.error));
    };
    target.addEventListener("message", onMessage);
    post({
      channel: OPENCHAMBER_SDK_CHANNEL,
      v: OPENCHAMBER_SDK_API_VERSION,
      type: "hello"
    });
    const send = (message, timeoutMs = requestTimeoutMs) => {
      if (disposed || target.parent === target) {
        return Promise.reject(new HostRequestError("HOST_UNAVAILABLE", "No host frame. This page is not in an iframe."));
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(message.id);
          reject(new HostRequestError("HOST_TIMEOUT", "Host did not answer in time."));
        }, timeoutMs);
        pending.set(message.id, { resolve, reject, timer });
        post(message);
      });
    };
    const request = (message) => send(message).then(() => void 0);
    const envelope = { channel: OPENCHAMBER_SDK_CHANNEL, v: OPENCHAMBER_SDK_API_VERSION };
    const notify = (message) => {
      if (!disposed && target.parent !== target)
        post(message);
    };
    const requestFileSave = () => notify({ ...envelope, type: "file-save" });
    const postMicrophoneClose = () => {
      if (!disposed && target.parent !== target)
        post({ ...envelope, type: "microphone-close", id: nextId(ids) });
    };
    const openMicrophone = async () => {
      if (microphone)
        throw new HostRequestError("HOST_REJECTED", "The microphone is already open in this frame.");
      if (lastReady?.features?.microphone !== true) {
        throw new HostRequestError("UNSUPPORTED", "This OpenChamber cannot share the microphone with extensions.");
      }
      const AudioContextCtor = globalThis.AudioContext;
      if (typeof AudioContextCtor !== "function")
        throw new HostRequestError("UNSUPPORTED", "This frame has no Web Audio.");
      const context = new AudioContextCtor();
      if (context.sampleRate < GUEST_MICROPHONE_SAMPLE_RATE_MIN || context.sampleRate > GUEST_MICROPHONE_SAMPLE_RATE_MAX) {
        void context.close().catch(() => void 0);
        throw new HostRequestError("UNSUPPORTED", `Audio at ${context.sampleRate} Hz is not supported.`);
      }
      const resumed = context.state === "suspended" ? context.resume().catch(() => void 0) : void 0;
      const queue = createSampleQueue(Math.round(context.sampleRate / 4));
      const processor = context.createScriptProcessor(1024, 1, 1);
      processor.onaudioprocess = (event) => queue.pull(event.outputBuffer.getChannelData(0));
      const destination = context.createMediaStreamDestination();
      processor.connect(destination);
      const endedListeners = /* @__PURE__ */ new Set();
      const open = {
        queue,
        endedListeners,
        release: () => {
          processor.onaudioprocess = null;
          processor.disconnect();
          queue.clear();
          for (const track of destination.stream.getTracks())
            track.stop();
          void context.close().catch(() => void 0);
        }
      };
      microphone = open;
      try {
        const result = await send(
          { ...envelope, type: "microphone-open", id: nextId(ids), payload: { sampleRate: context.sampleRate } },
          // The host may be waiting on the system's permission prompt.
          GUEST_MICROPHONE_OPEN_TIMEOUT_MS
        );
        if (!result || !("opened" in result) || result.opened !== true) {
          throw new HostRequestError("HOST_REJECTED", "Host did not open the microphone.");
        }
        await resumed;
        if (microphone !== open)
          throw new HostRequestError("DISCONNECTED", "The microphone closed while it was opening.");
      } catch (error) {
        if (microphone === open)
          microphone = null;
        open.release();
        postMicrophoneClose();
        throw error;
      }
      return {
        stream: destination.stream,
        close: () => {
          if (microphone !== open)
            return;
          microphone = null;
          open.release();
          postMicrophoneClose();
        },
        onEnded: (listener) => {
          endedListeners.add(listener);
          return () => {
            endedListeners.delete(listener);
          };
        }
      };
    };
    const onSaveShortcut = (event) => {
      if (!isKeyEvent(event) || !isSaveShortcut(event))
        return;
      event.preventDefault();
      requestFileSave();
    };
    const onPopoverEscape = (event) => {
      if (!isKeyEvent(event) || event.key !== "Escape" || lastReady?.surface !== "popover" || !lastReady.popover)
        return;
      event.preventDefault();
      void closePopover(lastReady.popover.id, "escape").catch(() => void 0);
    };
    const reportPopoverActivity = () => {
      const popover = lastReady?.surface === "popover" ? lastReady.popover : void 0;
      if (!popover)
        return;
      const active2 = popoverPointerActive || popoverFocusActive;
      if (popoverActivityReported === active2)
        return;
      popoverActivityReported = active2;
      void setPopoverAnchorActive(popover.id, active2).catch(() => void 0);
    };
    const onPopoverPointerOver = () => {
      if (lastReady?.surface !== "popover" || popoverPointerActive)
        return;
      popoverPointerActive = true;
      reportPopoverActivity();
    };
    const onPopoverPointerOut = (event) => {
      if (lastReady?.surface !== "popover" || event.relatedTarget !== null || !popoverPointerActive)
        return;
      popoverPointerActive = false;
      reportPopoverActivity();
    };
    const onPopoverFocus = () => {
      if (lastReady?.surface !== "popover" || popoverFocusActive)
        return;
      popoverFocusActive = true;
      reportPopoverActivity();
    };
    const onPopoverBlur = () => {
      if (lastReady?.surface !== "popover" || !popoverFocusActive)
        return;
      popoverFocusActive = false;
      reportPopoverActivity();
    };
    const requireIdentity = (value, maximum = 1024) => {
      if (!value.trim() || value.length > maximum)
        throw new HostRequestError("HOST_REJECTED", `Identity must contain 1 to ${maximum} characters.`);
    };
    const readWorkspace = async (query) => {
      if (query.kind !== "projects")
        requireIdentity(query.projectId);
      const result = await send({ ...envelope, type: "workspace-read", id: nextId(ids), payload: query });
      if (!result || !("kind" in result) || !("state" in result) || result.kind !== query.kind) {
        throw new HostRequestError("HOST_REJECTED", "Host did not return workspace data.");
      }
      return result;
    };
    const subscribeWorkspace = async (query, listener) => {
      if (query.kind !== "projects")
        requireIdentity(query.projectId);
      const subscriptionId = nextId(ids);
      workspaceListeners.set(subscriptionId, listener);
      try {
        await request({ ...envelope, type: "workspace-subscribe", id: nextId(ids), payload: { subscriptionId, query } });
      } catch (error) {
        workspaceListeners.delete(subscriptionId);
        if (!disposed)
          post({ ...envelope, type: "workspace-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
        throw error;
      }
      return () => {
        if (!workspaceListeners.delete(subscriptionId) || disposed)
          return;
        post({ ...envelope, type: "workspace-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
      };
    };
    const subscribeShells = async (scope, listener) => {
      if (scope.kind === "session")
        requireIdentity(scope.sessionId);
      if (scope.kind === "project")
        requireIdentity(scope.projectId);
      const subscriptionId = nextId(ids);
      shellsListeners.set(subscriptionId, listener);
      try {
        await request({ ...envelope, type: "shells-subscribe", id: nextId(ids), payload: { subscriptionId, scope } });
      } catch (error) {
        shellsListeners.delete(subscriptionId);
        if (!disposed)
          post({ ...envelope, type: "shells-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
        throw error;
      }
      return () => {
        if (!shellsListeners.delete(subscriptionId) || disposed)
          return;
        post({ ...envelope, type: "shells-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
      };
    };
    const storage = async (payload) => {
      if ("key" in payload && (payload.key.length === 0 || payload.key.length > GUEST_STORAGE_KEY_MAX)) {
        throw new HostRequestError("HOST_REJECTED", "Storage key must contain 1 to 128 characters.");
      }
      if (payload.op === "set" && !isJsonValue(payload.value)) {
        throw new HostRequestError("HOST_REJECTED", "Storage values must be JSON.");
      }
      if (payload.op === "set" && new TextEncoder().encode(JSON.stringify(payload.value)).length > GUEST_STORAGE_VALUE_BYTES) {
        throw new HostRequestError("HOST_REJECTED", "Storage value exceeds 64 KiB.");
      }
      if (payload.scope === "device" && lastReady?.features?.deviceStorage !== true) {
        throw new HostRequestError("UNSUPPORTED", "This host does not support device storage.");
      }
      const result = await send({ ...envelope, type: "storage", id: nextId(ids), payload });
      if (!result || !("storage" in result) || result.op !== payload.op)
        throw new HostRequestError("HOST_REJECTED", "Host did not return storage data.");
      return result;
    };
    const closePopover = (id, reason) => lastReady?.features?.popovers !== true && !(lastReady?.surface === "popover" && lastReady.popover?.id === id) ? Promise.reject(new HostRequestError("UNSUPPORTED", "This host does not support popovers.")) : request({ ...envelope, type: "popover-close", id: nextId(ids), payload: reason ? { id, reason } : { id } });
    const setPopoverAnchorActive = (id, active2) => lastReady?.features?.popovers !== true && !(lastReady?.surface === "popover" && lastReady.popover?.id === id) ? Promise.reject(new HostRequestError("UNSUPPORTED", "This host does not support popovers.")) : request({ ...envelope, type: "popover-anchor", id: nextId(ids), payload: { id, active: active2 } });
    target.addEventListener("keydown", onPopoverEscape, true);
    target.addEventListener("pointerover", onPopoverPointerOver);
    target.addEventListener("pointermove", onPopoverPointerOver);
    target.addEventListener("pointerout", onPopoverPointerOut);
    target.addEventListener("focus", onPopoverFocus);
    target.addEventListener("blur", onPopoverBlur);
    return {
      onAction: (handler) => {
        actionHandler = handler;
        return () => {
          if (actionHandler === handler)
            actionHandler = null;
        };
      },
      listProjects: async () => {
        const result = await readWorkspace({ kind: "projects" });
        if (result.kind !== "projects")
          throw new HostRequestError("HOST_REJECTED", "Expected projects.");
        return result;
      },
      listWorktrees: async (projectId2) => {
        const result = await readWorkspace({ kind: "worktrees", projectId: projectId2 });
        if (result.kind !== "worktrees")
          throw new HostRequestError("HOST_REJECTED", "Expected worktrees.");
        return result;
      },
      listSessions: async (projectId2) => {
        const result = await readWorkspace({ kind: "sessions", projectId: projectId2 });
        if (result.kind !== "sessions")
          throw new HostRequestError("HOST_REJECTED", "Expected sessions.");
        return result;
      },
      onProjects: (listener) => subscribeWorkspace({ kind: "projects" }, (snapshot) => {
        if (snapshot.kind === "projects")
          listener(snapshot);
      }),
      onWorktrees: (projectId2, listener) => subscribeWorkspace({ kind: "worktrees", projectId: projectId2 }, (snapshot) => {
        if (snapshot.kind === "worktrees")
          listener(snapshot);
      }),
      onSessions: (projectId2, listener) => subscribeWorkspace({ kind: "sessions", projectId: projectId2 }, (snapshot) => {
        if (snapshot.kind === "sessions")
          listener(snapshot);
      }),
      onRunningShells: (scope, listener) => subscribeShells(scope, listener),
      readShellOutput: async (shellId, options2) => {
        requireIdentity(shellId, GUEST_SHELL_ID_MAX);
        const cursor = options2?.cursor;
        if (cursor !== void 0 && (!Number.isInteger(cursor) || cursor < 0)) {
          throw new HostRequestError("HOST_REJECTED", "Shell output cursor must be a non-negative integer.");
        }
        const tailBytes = options2?.tailBytes;
        if (tailBytes !== void 0 && (!Number.isInteger(tailBytes) || tailBytes < 1 || tailBytes > GUEST_SHELL_OUTPUT_TAIL_MAX)) {
          throw new HostRequestError("HOST_REJECTED", `Shell output tailBytes must be an integer between 1 and ${GUEST_SHELL_OUTPUT_TAIL_MAX}.`);
        }
        const result = await send({ ...envelope, type: "shell-output", id: nextId(ids), payload: { shellId, cursor, tailBytes } });
        const output = result;
        if (!output || typeof output.output !== "string" || !Number.isFinite(output.cursor)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return shell output.");
        }
        return output;
      },
      stopShell: async (shellId) => {
        requireIdentity(shellId, GUEST_SHELL_ID_MAX);
        const result = await send({ ...envelope, type: "shell-stop", id: nextId(ids), payload: { shellId } });
        if (result?.stopped !== true)
          throw new HostRequestError("HOST_REJECTED", "Host did not stop the shell.");
        return { stopped: true };
      },
      openSession: async (sessionId2) => {
        requireIdentity(sessionId2);
        await request({ ...envelope, type: "open-session", id: nextId(ids), payload: { sessionId: sessionId2 } });
      },
      storage: {
        get: async (key, options2) => {
          const scope = deviceStorageScope(options2);
          const payload = { op: "get", key };
          if (scope)
            payload.scope = scope;
          const result = await storage(payload);
          return result.op === "get" && result.found ? result.value : void 0;
        },
        set: async (key, value, options2) => {
          const scope = deviceStorageScope(options2);
          const payload = { op: "set", key, value };
          if (scope)
            payload.scope = scope;
          await storage(payload);
        },
        delete: async (key, options2) => {
          const scope = deviceStorageScope(options2);
          const payload = { op: "delete", key };
          if (scope)
            payload.scope = scope;
          await storage(payload);
        },
        keys: async (options2) => {
          const scope = deviceStorageScope(options2);
          const payload = { op: "keys" };
          if (scope)
            payload.scope = scope;
          const result = await storage(payload);
          if (result.op !== "keys")
            throw new HostRequestError("HOST_REJECTED", "Expected storage keys.");
          return result.keys;
        }
      },
      onReady: (listener) => {
        readyListeners.add(listener);
        if (lastReady)
          listener(lastReady);
        return () => {
          readyListeners.delete(listener);
        };
      },
      onDirectory: (listener) => {
        directoryListeners.add(listener);
        if (lastReady)
          listener(lastReady.directory);
        return () => {
          directoryListeners.delete(listener);
        };
      },
      onSession: (listener) => {
        sessionListeners.add(listener);
        if (lastReady)
          listener(lastReady.session);
        return () => {
          sessionListeners.delete(listener);
        };
      },
      onSessionLifecycle: (listener) => {
        lifecycleListeners.add(listener);
        if (lastLifecycle)
          listener(lastLifecycle);
        return () => {
          lifecycleListeners.delete(listener);
        };
      },
      onConnection: (listener) => {
        connectionListeners.add(listener);
        if (lastReady)
          listener(lastReady.connection);
        return () => {
          connectionListeners.delete(listener);
        };
      },
      onSettings: (listener) => {
        settingsListeners.add(listener);
        if (lastReady)
          listener(lastReady.settings);
        return () => {
          settingsListeners.delete(listener);
        };
      },
      onItem: (listener) => {
        itemListeners.add(listener);
        if (lastReady)
          listener(lastReady.item);
        return () => {
          itemListeners.delete(listener);
        };
      },
      onBlock: (listener) => {
        blockListeners.add(listener);
        if (lastReady?.block)
          listener(lastReady.block);
        return () => {
          blockListeners.delete(listener);
        };
      },
      onServiceEvent: (listener) => {
        serviceEventListeners.add(listener);
        return () => {
          serviceEventListeners.delete(listener);
        };
      },
      onStatusControl: (listener) => {
        statusControlListeners.add(listener);
        return () => {
          statusControlListeners.delete(listener);
        };
      },
      onPopoverClosed: (listener) => {
        popoverClosedListeners.add(listener);
        return () => {
          popoverClosedListeners.delete(listener);
        };
      },
      setStatusControls: (controls) => {
        if (lastReady?.features?.statusControls !== true) {
          return Promise.reject(new HostRequestError("UNSUPPORTED", "This host does not support status controls."));
        }
        if (!isGuestStatusControls(controls)) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", "Status controls must have unique bounded ids and valid selected options."));
        }
        return request({ ...envelope, type: "status-controls", id: nextId(ids), payload: { controls } });
      },
      openPopover: (payload) => {
        if (lastReady?.features?.popovers !== true) {
          return Promise.reject(new HostRequestError("UNSUPPORTED", "This host does not support popovers."));
        }
        if (!isGuestPopoverRequest(payload)) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", "Popover requests need bounded geometry and JSON data."));
        }
        return request({ ...envelope, type: "popover-open", id: nextId(ids), payload });
      },
      closePopover,
      setPopoverAnchorActive,
      onResolve: (handler) => {
        resolveHandler = handler;
        return () => {
          if (resolveHandler === handler)
            resolveHandler = null;
        };
      },
      toast: (payload) => {
        const message = payload.message.trim();
        if (!message || message.length > GUEST_TOAST_MAX) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", `Toast message must contain 1 to ${GUEST_TOAST_MAX} characters.`));
        }
        if (payload.copy && payload.copy !== true && (!payload.copy.text.length || payload.copy.text.length > GUEST_CLIPBOARD_TEXT_MAX)) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", `Toast copy text must contain 1 to ${GUEST_CLIPBOARD_TEXT_MAX} characters.`));
        }
        return request({
          channel: OPENCHAMBER_SDK_CHANNEL,
          v: OPENCHAMBER_SDK_API_VERSION,
          type: "toast",
          id: nextId(ids),
          payload: { ...payload, message }
        });
      },
      openUrl: (url) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "open-url",
        id: nextId(ids),
        payload: { url }
      }),
      openCommit: (sha) => isGuestCommitSha(sha) ? request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "open-commit",
        id: nextId(ids),
        payload: { sha }
      }) : Promise.reject(new HostRequestError("HOST_REJECTED", "Commit id must be 7 to 64 hex characters.")),
      answerBlock: (text) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "block-answer",
        id: nextId(ids),
        payload: { text: text.trim().slice(0, GUEST_BLOCK_ANSWER_MAX) }
      }),
      openSurface: (surfaceId) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "open-surface",
        id: nextId(ids),
        payload: { surfaceId }
      }),
      writeClipboard: (text) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "clipboard-write",
        id: nextId(ids),
        payload: { text }
      }),
      compose: (payload) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "compose",
        id: nextId(ids),
        payload
      }),
      attach: (payload) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "attach",
        id: nextId(ids),
        payload: clampAttachRequest(payload)
      }),
      startSession: async (payload) => {
        if (payload.projectId !== void 0)
          requireIdentity(payload.projectId);
        const worktree = payload.worktree;
        if (worktree && worktree !== true) {
          if (worktree.kind === "existing")
            requireIdentity(worktree.directory);
          else {
            if (worktree.name !== void 0)
              requireIdentity(worktree.name, 200);
            if (worktree.baseBranch !== void 0)
              requireIdentity(worktree.baseBranch, 200);
          }
        }
        const result = await send({
          channel: OPENCHAMBER_SDK_CHANNEL,
          v: OPENCHAMBER_SDK_API_VERSION,
          type: "start-session",
          id: nextId(ids),
          payload: clampStartSessionRequest(payload)
        }, options.requestTimeoutMs ?? 18e4);
        if (!isStartSessionResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return a session.");
        }
        return result;
      },
      prompt: (payload) => send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "prompt",
        id: nextId(ids),
        payload: clampPromptRequest(payload)
      }).then((result) => {
        if (!isPromptResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return a prompt result.");
        }
        return result;
      }),
      sessionLink: (payload) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "session-link",
        id: nextId(ids),
        payload: clampAttachRequest(payload)
      }),
      close: () => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "close",
        id: nextId(ids)
      }),
      oauthStart: () => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "oauth-start",
        id: nextId(ids)
      }),
      oauthDisconnect: () => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "oauth-disconnect",
        id: nextId(ids)
      }),
      request: (payload) => (isGuestRequestPath(payload.path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "request",
        id: nextId(ids),
        payload
      }) : rejectBadPath()).then((result) => {
        if (!isGuestRequestResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host request result was empty.");
        }
        return result;
      }),
      serviceRequest: (payload) => (isGuestRequestPath(payload.path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "service-request",
        id: nextId(ids),
        payload
      }) : rejectBadPath()).then((result) => {
        if (!isGuestRequestResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host service request result was empty.");
        }
        return result;
      }),
      serviceStatus: () => send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "service-status",
        id: nextId(ids)
      }).then((result) => {
        if (!isServiceStatusResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return service status.");
        }
        return result;
      }),
      readFile: (path) => (isGuestFilePath(path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "file-read",
        id: nextId(ids),
        payload: { path }
      }) : rejectBadFilePath()).then((result) => {
        if (!isFileReadResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return file content.");
        }
        return result;
      }),
      writeFile: (path, content) => {
        if (!isGuestFilePath(path)) {
          return rejectBadFilePath();
        }
        if (content.length > GUEST_FILE_CONTENT_MAX) {
          return Promise.reject(new HostRequestError("FILE_TOO_LARGE", `Content is over ${GUEST_FILE_CONTENT_MAX} characters.`));
        }
        return send({
          channel: OPENCHAMBER_SDK_CHANNEL,
          v: OPENCHAMBER_SDK_API_VERSION,
          type: "file-write",
          id: nextId(ids),
          payload: { path, content }
        }).then((result) => {
          if (!isFileWriteResult(result)) {
            throw new HostRequestError("HOST_REJECTED", "Host did not confirm the write.");
          }
          return result;
        });
      },
      listDir: (path) => (isGuestFilePath(path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "file-list",
        id: nextId(ids),
        payload: { path }
      }) : rejectBadFilePath()).then((result) => {
        if (!isFileListResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return directory entries.");
        }
        return result;
      }),
      stat: (path) => (isGuestFilePath(path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "file-stat",
        id: nextId(ids),
        payload: { path }
      }) : rejectBadFilePath()).then((result) => {
        if (!isFileStatResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return file status.");
        }
        return result;
      }),
      generate: (input) => {
        const prompt = input.prompt.trim();
        const system = input.system?.trim();
        if (prompt.length === 0 || prompt.length > GUEST_GENERATE_PROMPT_MAX) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", `Prompt must be 1 to ${GUEST_GENERATE_PROMPT_MAX} characters.`));
        }
        if (system !== void 0 && (system.length === 0 || system.length > GUEST_GENERATE_SYSTEM_MAX)) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", `System prompt must be 1 to ${GUEST_GENERATE_SYSTEM_MAX} characters.`));
        }
        const maxOutputTokens = input.maxOutputTokens === void 0 ? void 0 : Math.min(GUEST_GENERATE_OUTPUT_TOKENS_MAX, Math.max(1, Math.floor(input.maxOutputTokens)));
        if (maxOutputTokens !== void 0 && !Number.isFinite(maxOutputTokens)) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", "maxOutputTokens must be a number."));
        }
        const payload = { prompt };
        if (system !== void 0)
          payload.system = system;
        if (maxOutputTokens !== void 0)
          payload.maxOutputTokens = maxOutputTokens;
        return send({
          channel: OPENCHAMBER_SDK_CHANNEL,
          v: OPENCHAMBER_SDK_API_VERSION,
          type: "generate",
          id: nextId(ids),
          payload
        }, options.requestTimeoutMs ?? GUEST_GENERATE_TIMEOUT_MS).then((result) => {
          if (!isGenerateResult(result)) {
            throw new HostRequestError("HOST_REJECTED", "Host did not return generated text.");
          }
          return result;
        });
      },
      onLateGenerateResult: (listener) => {
        lateGenerateListeners.add(listener);
        for (const result of unclaimedLateGenerate.splice(0))
          emit([listener], result);
        listenForLateGenerate();
        return () => {
          lateGenerateListeners.delete(listener);
        };
      },
      openMicrophone,
      setBadge: (count) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "badge",
        id: nextId(ids),
        payload: { count: clampBadgeCount(count) }
      }),
      setHeight: (height) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "resize",
        id: nextId(ids),
        payload: { height: clampFrameHeight(height) }
      }),
      onFileOpen: (listener) => {
        fileOpenListeners.add(listener);
        if (!saveShortcutInstalled) {
          saveShortcutInstalled = true;
          target.addEventListener("keydown", onSaveShortcut, true);
        }
        if (lastFile)
          listener(lastFile);
        return () => {
          fileOpenListeners.delete(listener);
        };
      },
      onFileSnapshot: (handler) => {
        fileSnapshotHandler = handler;
        return () => {
          if (fileSnapshotHandler === handler)
            fileSnapshotHandler = null;
        };
      },
      onFileSaved: (listener) => {
        fileSavedListeners.add(listener);
        return () => {
          fileSavedListeners.delete(listener);
        };
      },
      reportFileChange: (change) => notify({ ...envelope, type: "file-change", payload: { dirty: change.dirty, edited: change.edited } }),
      requestFileSave,
      reportFileUnsupported: () => notify({ ...envelope, type: "file-unsupported" }),
      dispose: () => {
        for (const subscriptionId of workspaceListeners.keys()) {
          post({ ...envelope, type: "workspace-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
        }
        workspaceListeners.clear();
        for (const subscriptionId of shellsListeners.keys()) {
          post({ ...envelope, type: "shells-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
        }
        shellsListeners.clear();
        if (microphone) {
          postMicrophoneClose();
          microphone.release();
          microphone = null;
        }
        disposed = true;
        resolveHandler = null;
        actionHandler = null;
        fileSnapshotHandler = null;
        fileOpenListeners.clear();
        fileSavedListeners.clear();
        if (saveShortcutInstalled)
          target.removeEventListener("keydown", onSaveShortcut, true);
        target.removeEventListener("message", onMessage);
        target.removeEventListener("keydown", onPopoverEscape, true);
        target.removeEventListener("pointerover", onPopoverPointerOver);
        target.removeEventListener("pointermove", onPopoverPointerOver);
        target.removeEventListener("pointerout", onPopoverPointerOut);
        target.removeEventListener("focus", onPopoverFocus);
        target.removeEventListener("blur", onPopoverBlur);
        for (const waiter of pending.values()) {
          clearTimeout(waiter.timer);
          waiter.reject(new HostRequestError("HOST_UNAVAILABLE", "Host client was disposed."));
        }
        pending.clear();
        readyListeners.clear();
        directoryListeners.clear();
        sessionListeners.clear();
        lifecycleListeners.clear();
        connectionListeners.clear();
        settingsListeners.clear();
        itemListeners.clear();
        blockListeners.clear();
        serviceEventListeners.clear();
        statusControlListeners.clear();
        popoverClosedListeners.clear();
        lateGenerateListeners.clear();
        unclaimedLateGenerate.length = 0;
      }
    };
  };

  // node_modules/@openchamber/sdk/dist/service-providers.js
  var BROWSER_CONTROL_ACTIONS = [
    "browser.open",
    "browser.snapshot",
    "browser.click",
    "browser.type",
    "browser.select",
    "browser.scroll",
    "browser.back",
    "browser.forward",
    "browser.inspect",
    "browser.capture",
    "browser.resize",
    "browser.close"
  ];
  var BROWSER_PROVIDER_IDLE_MS = 10 * 6e4;
  var CONTROL_ACTIONS = new Set(BROWSER_CONTROL_ACTIONS);
  var SOURCE_CONTROL_PROVIDER_IDLE_MS = 10 * 6e4;
  var NOTIFICATIONS_PROVIDER_IDLE_MS = 10 * 6e4;
  var TRACKER_PROVIDER_IDLE_MS = 10 * 6e4;
  var QUOTA_PROVIDER_IDLE_MS = 10 * 6e4;

  // node_modules/@openchamber/sdk/dist/service-surface.js
  var SURFACE_CONTROLLERS = ["none", "agent", "user"];
  var CONTROLLERS = new Set(SURFACE_CONTROLLERS);

  // node_modules/@openchamber/sdk/dist/ui/theme.js
  var TOKEN_VARS = [
    ["--oc-bg", "background"],
    ["--oc-elevated", "elevated"],
    ["--oc-fg", "foreground"],
    ["--oc-muted", "muted"],
    ["--oc-subtle", "subtle"],
    ["--oc-border", "border"],
    ["--oc-hover", "hover"],
    ["--oc-selection", "selection"],
    ["--oc-focus", "focus"],
    ["--oc-primary", "primary"],
    ["--oc-muted-surface", "mutedSurface"],
    ["--oc-elevated-fg", "elevatedForeground"],
    ["--oc-active", "active"],
    ["--oc-selection-fg", "selectionForeground"],
    ["--oc-primary-fg", "primaryForeground"],
    ["--oc-primary-text", "primaryText"],
    ["--oc-success-text", "successText"],
    ["--oc-warning-text", "warningText"],
    ["--oc-error-text", "errorText"],
    ["--oc-info-text", "infoText"],
    ["--oc-success", "success"],
    ["--oc-warning", "warning"],
    ["--oc-error", "error"],
    ["--oc-info", "info"],
    ["--oc-font", "font"],
    ["--oc-mono", "mono"],
    ["--oc-radius", "radius"],
    ["--surface-background", "background"],
    ["--surface-elevated", "elevated"],
    ["--surface-foreground", "foreground"],
    ["--surface-muted-foreground", "muted"],
    ["--surface-subtle", "subtle"],
    ["--interactive-border", "border"],
    ["--interactive-hover", "hover"],
    ["--interactive-selection", "selection"],
    ["--interactive-focus-ring", "focus"],
    ["--primary", "primary"],
    ["--surface-muted", "mutedSurface"],
    ["--surface-elevated-foreground", "elevatedForeground"],
    ["--interactive-active", "active"],
    ["--interactive-selection-foreground", "selectionForeground"],
    ["--primary-foreground", "primaryForeground"],
    ["--primary-text", "primaryText"],
    ["--success-text", "successText"],
    ["--warning-text", "warningText"],
    ["--error-text", "errorText"],
    ["--info-text", "infoText"],
    ["--status-success", "success"],
    ["--status-warning", "warning"],
    ["--status-error", "error"],
    ["--status-info", "info"],
    ["--font-sans", "font"],
    ["--font-mono", "mono"],
    ["--radius", "radius"]
  ];
  var SYNTAX_TOKEN_VARS = [
    ["--oc-syntax-keyword", "--syntax-keyword", "syntaxKeyword"],
    ["--oc-syntax-string", "--syntax-string", "syntaxString"],
    ["--oc-syntax-number", "--syntax-number", "syntaxNumber"],
    ["--oc-syntax-function", "--syntax-function", "syntaxFunction"],
    ["--oc-syntax-type", "--syntax-type", "syntaxType"],
    ["--oc-syntax-comment", "--syntax-comment", "syntaxComment"],
    ["--oc-syntax-variable", "--syntax-variable", "syntaxVariable"],
    ["--oc-syntax-operator", "--syntax-operator", "syntaxOperator"]
  ];
  var applyHostTheme = (theme, root2) => {
    root2.style.colorScheme = theme.mode;
    for (const [name, key] of TOKEN_VARS) {
      root2.style.setProperty(name, theme.tokens[key]);
    }
    for (const [alias, hostName, key] of SYNTAX_TOKEN_VARS) {
      const value = theme.tokens[key] ?? "";
      root2.style.setProperty(alias, value);
      root2.style.setProperty(hostName, value);
    }
    root2.style.setProperty("font-family", theme.tokens.font);
    root2.style.setProperty("font-size", theme.tokens.fontSize ?? "0.875rem");
    root2.style.setProperty("line-height", "1.45");
    root2.style.setProperty("color", theme.tokens.foreground);
  };
  var applyHostReady = (ctx, root2) => {
    applyHostTheme(ctx.theme, root2);
    if (root2.dataset) {
      root2.dataset.ocSurface = ctx.surface;
      root2.dataset.ocTheme = ctx.theme.mode;
    }
  };

  // node_modules/@openchamber/sdk/dist/ui/style.js
  var OC_ALIAS = {
    "surface-background": "bg",
    "surface-elevated": "elevated",
    "surface-elevated-foreground": "elevated-fg",
    "surface-foreground": "fg",
    "surface-muted-foreground": "muted",
    "surface-muted": "muted-surface",
    "surface-subtle": "subtle",
    "interactive-border": "border",
    "interactive-hover": "hover",
    "interactive-active": "active",
    "interactive-selection": "selection",
    "interactive-selection-foreground": "selection-fg",
    "interactive-focus-ring": "focus",
    "primary": "primary",
    "primary-foreground": "primary-fg",
    "primary-text": "primary-text",
    "success-text": "success-text",
    "warning-text": "warning-text",
    "error-text": "error-text",
    "info-text": "info-text",
    "status-success": "success",
    "status-warning": "warning",
    "status-error": "error",
    "status-info": "info",
    "font-sans": "font",
    "font-mono": "mono",
    "radius": "radius"
  };
  var v = (name, fallback) => `var(--${name}, var(--oc-${OC_ALIAS[name]}, ${fallback}))`;
  var bg = v("surface-background", "transparent");
  var elevated = v("surface-elevated", "transparent");
  var elevatedFg = v("surface-elevated-foreground", "inherit");
  var fg = v("surface-foreground", "inherit");
  var muted = v("surface-muted-foreground", "gray");
  var secondary = v("surface-muted", "transparent");
  var border = v("interactive-border", "currentColor");
  var hover = v("interactive-hover", "transparent");
  var active = v("interactive-active", "transparent");
  var selection = v("interactive-selection", "transparent");
  var selectionFg = v("interactive-selection-foreground", "inherit");
  var primary = v("primary", "currentColor");
  var primaryText = v("primary-text", "inherit");
  var errorText = v("error-text", "inherit");
  var font = v("font-sans", "inherit");
  var mono = v("font-mono", "monospace");
  var radius = v("radius", "9px");
  var controlRadius = `calc(${radius} - 2px)`;
  var smallRadius = `calc(${radius} - 4px)`;
  var mix = (color, pct, base = "transparent") => `color-mix(in srgb, ${color} ${pct}%, ${base})`;
  var focusFill = `background-image: linear-gradient(${hover}, ${hover});`;
  var field = (edge, width = "0.5px") => `box-shadow: inset 0 0 0 ${width} ${edge}, var(--oc-sdk-field-lift);`;
  var raised = "border-color: var(--oc-sdk-edge); box-shadow: var(--oc-sdk-raised-lift);";
  var litButton = "box-shadow: var(--oc-sdk-lit);";
  var darkLift = `inset 0 0.5px 0 0 ${mix(fg, 8)}, 0 1px 2px 0 rgb(0 0 0 / 0.4)`;
  var THEME_VARS = `
:root {
  --oc-sdk-edge: ${mix(fg, 16)};
  --oc-sdk-field-bg: ${elevated};
  --oc-sdk-raised-bg: ${bg};
  --oc-sdk-field-lift: inset 0 1px 2px 0 rgb(0 0 0 / 0.04);
  --oc-sdk-raised-lift: 0 1px 1.5px 0 rgb(0 0 0 / 0.08);
  --oc-sdk-lit: inset 0 1px 0 0 rgb(255 255 255 / 0.2), 0 1px 1.5px 0 rgb(0 0 0 / 0.1);
  --oc-sdk-float-edge: rgb(0 0 0 / 0.14);
  --oc-sdk-float: inset 0 1px 0 0 rgb(255 255 255 / 0.7), 0 1px 2px -0.5px rgb(0 0 0 / 0.06), 0 4px 8px -2px rgb(0 0 0 / 0.08), 0 12px 20px -4px rgb(0 0 0 / 0.06);
}
:root[data-oc-theme="dark"] {
  --oc-sdk-edge: ${mix(fg, 14)};
  --oc-sdk-field-bg: ${mix(bg, 50, elevated)};
  --oc-sdk-raised-bg: ${elevated};
  --oc-sdk-field-lift: ${darkLift};
  --oc-sdk-raised-lift: ${darkLift};
  --oc-sdk-lit: ${darkLift};
  --oc-sdk-float-edge: rgb(0 0 0 / 0.55);
  --oc-sdk-float: inset 0 1px 0 0 rgb(255 255 255 / 0.04), inset 0 0 0 0.5px rgb(255 255 255 / 0.08), 0 8px 16px 0 rgb(0 0 0 / 0.25), 0 4px 8px 0 rgb(0 0 0 / 0.25);
}`;
  var tone = (name) => {
    const color = v(`status-${name}`, "currentColor");
    return `
.oc-sdk[data-tone="${name}"], .oc-sdk [data-tone="${name}"] { --oc-sdk-tone: ${color}; --oc-sdk-tone-text: ${v(`${name}-text`, "inherit")}; }`;
  };
  var len = (px) => `calc(${px}rem / 14)`;
  var UI_SIZE_CSS = `
.oc-sdk { box-sizing: border-box; font-size: 0.875rem; line-height: 1.45; }
.oc-sdk *, .oc-sdk *::before, .oc-sdk *::after { box-sizing: border-box; }
/* :where() keeps the reset at zero specificity so every primitive class below overrides it. */
:where(.oc-sdk) :where(button, input, textarea), :where(button.oc-sdk, input.oc-sdk, textarea.oc-sdk) { font: inherit; color: inherit; margin: 0; }
:where(.oc-sdk) :where(button), :where(button.oc-sdk) { cursor: pointer; background: none; border: 0; padding: 0; }
.oc-sdk button:disabled, button.oc-sdk:disabled, .oc-sdk[aria-disabled="true"], .oc-sdk [aria-disabled="true"] { opacity: .5; pointer-events: none; }

.oc-sdk-btn { display: inline-flex; align-items: center; justify-content: center; gap: ${len(8)}; height: ${len(32)}; padding: 0 ${len(12)}; border: 1px solid transparent; font-size: 0.875rem; font-weight: 500; line-height: 1; white-space: nowrap; }
.oc-sdk-btn[data-size="sm"] { gap: ${len(6)}; height: ${len(28)}; padding: 0 ${len(10)}; font-size: 0.8125rem; }
.oc-sdk-btn[data-size="xs"] { gap: ${len(4)}; height: ${len(24)}; padding: 0 ${len(8)}; font-size: 0.75rem; }
.oc-sdk-btn[data-loading="true"] { opacity: .5; pointer-events: none; }
.oc-sdk-btn > .oc-sdk-spinner-ring { width: ${len(14)}; height: ${len(14)}; }

.oc-sdk-field { display: flex; flex-direction: column; gap: ${len(4)}; min-width: 0; }
.oc-sdk-field-label { font-size: 0.8125rem; font-weight: 500; }
.oc-sdk-field-note { font-size: 0.75rem; }
.oc-sdk-input { display: block; width: 100%; min-width: 0; height: ${len(32)}; padding: 0 ${len(10)}; border: 0; font-size: 0.875rem; line-height: 1.45; appearance: none; }
textarea.oc-sdk-input { height: auto; padding: ${len(8)} ${len(10)}; resize: vertical; }

.oc-sdk-search { position: relative; min-width: 0; }
.oc-sdk-search .oc-sdk-input { padding-left: ${len(34)}; padding-right: ${len(34)}; }
.oc-sdk-search-icon { position: absolute; left: ${len(11)}; top: 50%; transform: translateY(-50%); pointer-events: none; }
.oc-sdk-search-clear { position: absolute; right: ${len(6)}; top: 50%; transform: translateY(-50%); display: none; align-items: center; justify-content: center; width: ${len(24)}; height: ${len(24)}; }
.oc-sdk-search[data-active="true"] .oc-sdk-search-clear { display: inline-flex; }

.oc-sdk-select { position: relative; display: flex; flex-direction: column; gap: ${len(4)}; min-width: 0; }
.oc-sdk-trigger { display: inline-flex; align-items: center; gap: ${len(6)}; align-self: flex-start; width: auto; max-width: 100%; min-width: 0; height: ${len(28)}; padding: 0 ${len(10)}; border: 1px solid transparent; font-size: 0.8125rem; text-align: left; }
.oc-sdk-trigger-value { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-trigger-chevron { flex: 0 0 auto; }
.oc-sdk-popup { position: fixed; z-index: 50; display: flex; flex-direction: column; gap: ${len(2)}; min-width: ${len(160)}; max-width: calc(100vw - ${len(16)}); max-height: min(${len(320)}, calc(100vh - ${len(16)})); overflow: auto; padding: ${len(4)}; border: 1px solid transparent; }
.oc-sdk-popup-search { flex: 0 0 auto; padding: ${len(2)} ${len(2)} ${len(4)}; }
.oc-sdk-popup-search .oc-sdk-input { height: ${len(28)}; font-size: 0.8125rem; }
.oc-sdk-option { display: flex; align-items: center; gap: ${len(8)}; width: 100%; padding: ${len(6)} ${len(8)}; font-size: 0.8125rem; text-align: left; }
.oc-sdk-option-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-option-hint { flex: 0 0 auto; font-size: 0.75rem; }
.oc-sdk-option-check { flex: 0 0 auto; display: inline-flex; width: ${len(14)}; visibility: hidden; }
.oc-sdk-option[aria-selected="true"] > .oc-sdk-option-check { visibility: visible; }
.oc-sdk-popup-empty { padding: ${len(8)}; font-size: 0.8125rem; }

.oc-sdk-check { display: inline-flex; align-items: flex-start; gap: ${len(8)}; width: 100%; text-align: left; }
.oc-sdk-check-box { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: ${len(14)}; height: ${len(14)}; margin-top: ${len(3)}; border: 1px solid transparent; }
.oc-sdk-check-box > svg { display: none; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-box > svg { display: block; }
.oc-sdk-check-thumb { flex: 0 0 auto; position: relative; width: ${len(36)}; height: ${len(20)}; --oc-sdk-thumb-travel: ${len(16)}; }
.oc-sdk-check-thumb::after { content: ""; position: absolute; top: ${len(2)}; left: ${len(2)}; width: ${len(16)}; height: ${len(16)}; }
.oc-sdk-check-text { display: flex; flex-direction: column; min-width: 0; }
.oc-sdk-check-label { font-size: 0.875rem; }
.oc-sdk-check-desc { font-size: 0.75rem; }

.oc-sdk-tabs { display: inline-flex; gap: ${len(2)}; padding: ${len(2)}; max-width: 100%; overflow: auto; }
.oc-sdk-tab { display: inline-flex; align-items: center; gap: ${len(6)}; height: ${len(28)}; padding: 0 ${len(10)}; border: 1px solid transparent; font-size: 0.8125rem; font-weight: 500; white-space: nowrap; }
.oc-sdk-tab-count { font-size: 0.75rem; font-variant-numeric: tabular-nums; }

.oc-sdk-badge { display: inline-flex; align-items: center; padding: ${len(1)} ${len(6)}; font-size: ${len(11)}; font-weight: 500; line-height: ${len(16)}; white-space: nowrap; }

.oc-sdk-list { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.oc-sdk-row { display: flex; align-items: center; gap: ${len(8)}; width: 100%; padding: ${len(6)} ${len(8)}; text-align: left; }
.oc-sdk-row-lead { flex: 0 0 auto; width: ${len(64)}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.75rem; }
.oc-sdk-row-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.oc-sdk-row-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-row-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.75rem; }
.oc-sdk-row-meta { flex: 0 0 auto; font-size: 0.75rem; font-variant-numeric: tabular-nums; }
.oc-sdk-list-empty { padding: ${len(16)} ${len(8)}; text-align: center; font-size: 0.8125rem; }

.oc-sdk-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: ${len(4)}; padding: ${len(40)} ${len(16)}; text-align: center; }
.oc-sdk-empty-title { margin: 0; font-size: 0.8125rem; font-weight: 600; }
.oc-sdk-empty-body { margin: 0; max-width: 32rem; font-size: 0.8125rem; }
.oc-sdk-empty-action { margin-top: ${len(12)}; }

@keyframes oc-sdk-spin { to { transform: rotate(360deg); } }
.oc-sdk-spinner { display: inline-flex; align-items: center; gap: ${len(8)}; font-size: 0.8125rem; }
.oc-sdk-spinner-ring { width: ${len(16)}; height: ${len(16)}; border: 2px solid transparent; animation: oc-sdk-spin .8s linear infinite; }
.oc-sdk-spinner[data-size="sm"] .oc-sdk-spinner-ring { width: ${len(12)}; height: ${len(12)}; }

.oc-sdk-banner { display: flex; align-items: flex-start; gap: ${len(12)}; padding: ${len(8)} ${len(12)}; border: 1px solid transparent; }
.oc-sdk-banner-text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: ${len(2)}; }
.oc-sdk-banner-title { font-size: 0.8125rem; font-weight: 500; }
.oc-sdk-banner-body { font-size: 0.8125rem; }
.oc-sdk-banner-action { flex: 0 0 auto; }

.oc-sdk-separator { display: flex; align-items: center; gap: ${len(8)}; width: 100%; margin: ${len(8)} 0; font-size: 0.75rem; }
.oc-sdk-separator::before, .oc-sdk-separator::after { content: ""; flex: 1 1 auto; height: 1px; }
.oc-sdk-separator[data-labeled="false"]::after { display: none; }
.oc-sdk-popup > .oc-sdk-separator { margin: ${len(4)} 0; }

.oc-sdk-progress { display: flex; flex-direction: column; gap: ${len(4)}; min-width: 0; }
.oc-sdk-progress-label { display: flex; justify-content: space-between; font-size: 0.75rem; font-variant-numeric: tabular-nums; }
.oc-sdk-progress-track { height: ${len(6)}; overflow: hidden; }
.oc-sdk-progress-fill { height: 100%; transform-origin: left; transition: transform 200ms ease-out; }
.oc-sdk-progress-value { display: inline-flex; align-items: center; gap: ${len(2)}; }
.oc-sdk-progress[data-done="true"] .oc-sdk-progress-value { font-weight: 600; }

.oc-sdk-menu { position: relative; display: inline-flex; }

.oc-sdk-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.oc-sdk-text img { display: block; max-width: 100%; margin: ${len(8)} 0; }

/* Under a finger the controls reach the app's touch sizes: rows and options 44px like its sheets, every other
   control at least 36px. Inputs keep 16px text, below which iOS zooms the page on focus. */
@media (pointer: coarse) {
  .oc-sdk-btn, .oc-sdk-input { height: ${len(40)}; }
  .oc-sdk-btn[data-size="sm"], .oc-sdk-btn[data-size="xs"], .oc-sdk-trigger, .oc-sdk-tab, .oc-sdk-popup-search .oc-sdk-input { height: ${len(36)}; }
  .oc-sdk-input, .oc-sdk-popup-search .oc-sdk-input { font-size: max(16px, 0.875rem); }
  .oc-sdk-search-clear { width: ${len(36)}; height: ${len(36)}; right: 0; }
  .oc-sdk-row, .oc-sdk-option { min-height: ${len(44)}; }
  .oc-sdk-check { min-height: ${len(36)}; padding: ${len(8)} 0; }
}
`;
  var GUEST_UI_LOOK_CSS = `${THEME_VARS}
.oc-sdk { color: ${fg}; font-family: ${font}; }
.oc-sdk :focus-visible, .oc-sdk:focus-visible { outline: none; }
.oc-sdk :where(button, a[href], [role="button"], [role="tab"], [role="option"]):focus-visible, button.oc-sdk:focus-visible { ${focusFill} }
.oc-sdk-mono { font-family: ${mono}; }
.oc-sdk-muted { color: ${muted}; }
${tone("success")}${tone("warning")}${tone("error")}${tone("info")}
.oc-sdk[data-tone="primary"], .oc-sdk [data-tone="primary"] { --oc-sdk-tone: ${primary}; --oc-sdk-tone-text: ${primaryText}; }

.oc-sdk-btn { border-radius: ${controlRadius}; transition: background 150ms ease-out, color 150ms ease-out; }
.oc-sdk-btn[data-size="xs"] { border-radius: ${smallRadius}; }
.oc-sdk-btn[data-variant="default"] { color: ${primaryText}; background: ${mix(primary, 10, bg)}; border-color: ${mix(primary, 12)}; ${litButton} }
.oc-sdk-btn[data-variant="default"]:hover { background: ${mix(primary, 16, bg)}; }
.oc-sdk-btn[data-variant="default"]:active { background: ${mix(primary, 22, bg)}; box-shadow: none; }
.oc-sdk-btn[data-variant="secondary"] { background: ${secondary}; color: var(--oc-fg); }
.oc-sdk-btn[data-variant="secondary"]:hover { background-image: linear-gradient(${hover}, ${hover}); }
.oc-sdk-btn[data-variant="secondary"]:active { background-image: linear-gradient(${active}, ${active}); }
.oc-sdk-btn[data-variant="outline"] { background: var(--oc-sdk-raised-bg); color: ${elevatedFg}; ${raised} }
.oc-sdk-btn[data-variant="outline"]:hover { background-image: linear-gradient(${hover}, ${hover}); }
.oc-sdk-btn[data-variant="outline"]:active { background-image: linear-gradient(${active}, ${active}); box-shadow: none; }
.oc-sdk-btn[data-variant="ghost"] { background: transparent; }
.oc-sdk-btn[data-variant="ghost"]:hover { background: ${hover}; }
.oc-sdk-btn[data-variant="ghost"]:active { background: ${active}; }
.oc-sdk-btn[data-variant="destructive"] { --oc-sdk-tone: ${v("status-error", "red")}; color: ${errorText}; background: ${mix("var(--oc-sdk-tone)", 7, bg)}; border-color: ${mix("var(--oc-sdk-tone)", 12)}; ${litButton} }
.oc-sdk-btn[data-variant="destructive"]:hover { background: ${mix("var(--oc-sdk-tone)", 9, bg)}; }
.oc-sdk-btn[data-variant="destructive"]:active { background: ${mix("var(--oc-sdk-tone)", 11, bg)}; box-shadow: none; }

.oc-sdk-field-note { color: ${muted}; }
.oc-sdk-field[data-invalid="true"] .oc-sdk-field-note { color: ${errorText}; }
.oc-sdk-input { border-radius: ${controlRadius}; background: var(--oc-sdk-field-bg); color: ${elevatedFg}; ${field("var(--oc-sdk-edge)")} transition: background 150ms ease-out; }
.oc-sdk-input::placeholder { color: ${muted}; }
.oc-sdk-input:hover:not(:focus) { background-image: linear-gradient(${hover}, ${hover}); }
.oc-sdk-input:focus, .oc-sdk-input:focus-visible { ${field(mix(fg, 26), "1px")} }
.oc-sdk-field[data-invalid="true"] .oc-sdk-input, .oc-sdk-field[data-invalid="true"] .oc-sdk-input:focus { ${field(v("status-error", "red"), "1px")} }
.oc-sdk-input[data-mono="true"] { font-family: ${mono}; }

.oc-sdk-search-icon { color: ${muted}; }
.oc-sdk-search[data-active="true"] .oc-sdk-search-icon { color: ${primary}; }
.oc-sdk-search-clear { border-radius: ${smallRadius}; color: ${muted}; }
.oc-sdk-search-clear:hover { background: ${hover}; color: ${fg}; }

.oc-sdk-trigger { border-radius: ${controlRadius}; background: var(--oc-sdk-raised-bg); color: ${elevatedFg}; ${raised} transition: background 150ms ease-out; }
.oc-sdk-trigger:hover { background-image: linear-gradient(${hover}, ${hover}); }
.oc-sdk-trigger[aria-expanded="true"] { background-image: linear-gradient(${active}, ${active}); }
.oc-sdk-trigger-value[data-empty="true"] { color: ${muted}; }
.oc-sdk-trigger-chevron { color: ${muted}; }
/* The app's floating level: the glass edge (a hairline ring and a lit top line, dark outside and light inside in dark themes) over soft shadows. The outer ring is the border, over the page like the app's. */
.oc-sdk-popup { --surface-foreground: ${elevatedFg}; border-color: var(--oc-sdk-float-edge); border-radius: 12px; background: ${elevated}; background-clip: padding-box; color: ${elevatedFg}; box-shadow: var(--oc-sdk-float); }
.oc-sdk-option { border-radius: 8px; }
.oc-sdk-option[data-active="true"] { background: ${hover}; }
/* A selected option shows a check mark in the text colour, like the app's own pickers. Options without the mark come
   from bundles built before it existed and keep the selection fill as their only sign of the choice. */
.oc-sdk-option[aria-selected="true"]:not([data-mark]) { background: ${selection}; color: ${selectionFg}; }
.oc-sdk-option-check { color: ${fg}; }
.oc-sdk-option[data-destructive="true"] { color: ${errorText}; }
.oc-sdk-option[data-destructive="true"][data-active="true"] { background: ${mix(v("status-error", "red"), 10)}; }
.oc-sdk-option-hint { color: ${muted}; }
.oc-sdk-popup-empty { color: ${muted}; }

/* Checked stays neutral: the mark carries the state, and the primary colour stays with primary actions. */
.oc-sdk-check-box { border-color: ${border}; border-radius: 4px; color: ${fg}; transition: border-color 150ms ease-out; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-box { border-color: ${mix(fg, 60, border)}; }
.oc-sdk-check-thumb { border-radius: 9999px; background: ${border}; transition: background 150ms ease-out; }
.oc-sdk-check-thumb::after { border-radius: 9999px; background: ${bg}; transition: transform 150ms ease-out; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-thumb { background: ${primary}; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-thumb::after { transform: translateX(var(--oc-sdk-thumb-travel, 16px)); }
.oc-sdk-check:focus-visible { box-shadow: none; }
.oc-sdk-check:focus-visible .oc-sdk-check-box, .oc-sdk-check:focus-visible .oc-sdk-check-thumb { ${focusFill} }
.oc-sdk-check-desc { color: ${muted}; }

.oc-sdk-tabs { border-radius: 10px; }
.oc-sdk-tabs[data-track="true"] { background: ${mix(fg, 4)}; box-shadow: inset 0 1px 2px 0 rgb(0 0 0 / 0.16); }
.oc-sdk-tab { border-radius: 8px; color: ${muted}; transition: color 150ms ease-out, background 150ms ease-out; }
.oc-sdk-tab:hover { color: ${fg}; }
.oc-sdk-tab[aria-selected="true"] { color: ${selectionFg}; background: ${selection}; border-color: ${border}; }
.oc-sdk-tabs[data-track="true"] .oc-sdk-tab[aria-selected="true"] { color: ${elevatedFg}; background: var(--oc-sdk-raised-bg); ${raised} }
.oc-sdk-tab-count { color: ${muted}; }

/* The app's neutral badge: a step of the text colour, the same in every theme. */
.oc-sdk-badge { border-radius: 9999px; background: ${mix(fg, 6)}; color: ${muted}; }
.oc-sdk-badge[data-tone] { color: var(--oc-sdk-tone-text, var(--oc-sdk-tone)); background: ${mix("var(--oc-sdk-tone)", 15)}; }

.oc-sdk-row { border-radius: 6px; transition: background 120ms ease-out; }
.oc-sdk-row:hover, .oc-sdk-row[data-active="true"] { background: ${hover}; }
.oc-sdk-row[aria-selected="true"] { background: ${selection}; color: ${selectionFg}; }
.oc-sdk-row-lead { font-family: ${mono}; color: ${muted}; }
.oc-sdk-row-sub { color: ${muted}; }
.oc-sdk-row-meta { color: ${muted}; }
.oc-sdk-row[aria-selected="true"] .oc-sdk-row-lead, .oc-sdk-row[aria-selected="true"] .oc-sdk-row-sub, .oc-sdk-row[aria-selected="true"] .oc-sdk-row-meta { color: inherit; opacity: .75; }
.oc-sdk-list-empty { color: ${muted}; }

.oc-sdk-empty-body { color: ${muted}; }

.oc-sdk-spinner { color: ${muted}; }
.oc-sdk-spinner-ring { border-color: ${border}; border-top-color: ${primary}; border-radius: 9999px; }

/* Set apart by its tint alone, like the app's banners. */
.oc-sdk-banner { border-color: transparent; border-radius: 8px; background: ${mix("var(--oc-sdk-tone)", 10)}; }
.oc-sdk-banner-title { color: var(--oc-sdk-tone-text, var(--oc-sdk-tone)); }
.oc-sdk-banner-body { color: ${muted}; }

.oc-sdk-separator { color: ${muted}; }
.oc-sdk-separator::before, .oc-sdk-separator::after { background: ${mix(border, 40)}; }

.oc-sdk-progress-label { color: ${muted}; }
/* The app's progress: a groove a step of the text colour, green once done. Older bundles mark done only through aria-valuenow. */
.oc-sdk-progress-track { border-radius: 9999px; background: ${mix(fg, 6)}; }
.oc-sdk-progress-fill { border-radius: 9999px; background: var(--oc-sdk-tone, ${primary}); }
.oc-sdk-progress-track[aria-valuenow="100"] > .oc-sdk-progress-fill:not([data-tone]) { background: ${v("status-success", "currentColor")}; }
.oc-sdk-progress[data-done="true"] .oc-sdk-progress-value { color: ${v("success-text", "inherit")}; }

.oc-sdk-text a { color: ${primaryText}; text-decoration: underline; text-underline-offset: 2px; }
.oc-sdk-text img { border-radius: 8px; border: 1px solid ${mix(border, 60)}; }
`;
  var UI_CSS = `
${GUEST_SCROLLBAR_CSS}
${UI_SIZE_CSS}
${GUEST_UI_LOOK_CSS}`;

  // node_modules/@openchamber/sdk/dist/ui/dom.js
  var STYLE_ID = "oc-sdk-ui-style";
  var clearNode = (node) => {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  };
  var ensureStyle = (css) => {
    const existing = document.getElementById(STYLE_ID);
    if (existing instanceof HTMLStyleElement) {
      if (existing.textContent !== css) {
        existing.textContent = css;
      }
      return;
    }
    installGuestScrollbarActivity(document);
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  };
  var el = (tag, className) => {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    return node;
  };
  var button = (className) => {
    const node = el("button", className);
    node.type = "button";
    return node;
  };
  var setText = (node, text) => {
    const next = text ?? "";
    if (node.textContent !== next) {
      node.textContent = next;
    }
  };
  var setAttr = (node, name, value) => {
    if (value === void 0 || value === null || value === "") {
      node.removeAttribute(name);
    } else if (node.getAttribute(name) !== value) {
      node.setAttribute(name, value);
    }
  };
  var onOutsideClick = (node, handler) => {
    const listener = (event) => {
      if (event.target instanceof Node && node.contains(event.target)) {
        return;
      }
      handler();
    };
    document.addEventListener("pointerdown", listener, true);
    return () => {
      document.removeEventListener("pointerdown", listener, true);
    };
  };

  // node_modules/@openchamber/sdk/dist/ui/button.js
  var ring = () => {
    const spinner = document.createElement("span");
    spinner.className = "oc-sdk-spinner-ring";
    spinner.setAttribute("aria-hidden", "true");
    return spinner;
  };
  var mountButton = (root2, initial) => {
    ensureStyle(UI_CSS);
    let props = initial;
    const node = button("oc-sdk oc-sdk-btn");
    const spinner = ring();
    const label = document.createElement("span");
    node.append(label);
    root2.append(node);
    const paint = () => {
      node.dataset.variant = props.variant ?? "default";
      node.dataset.size = props.size ?? "default";
      node.disabled = Boolean(props.disabled) || Boolean(props.loading);
      node.dataset.loading = props.loading ? "true" : "false";
      node.setAttribute("aria-busy", props.loading ? "true" : "false");
      if (props.loading && spinner.parentNode !== node) {
        node.prepend(spinner);
      } else if (!props.loading && spinner.parentNode === node) {
        spinner.remove();
      }
      setText(label, props.label);
    };
    const onClick = () => {
      if (props.disabled || props.loading) {
        return;
      }
      props.onClick();
    };
    node.addEventListener("click", onClick);
    paint();
    return {
      update: (next) => {
        props = { ...props, ...next };
        paint();
      },
      dispose: () => {
        node.removeEventListener("click", onClick);
        node.remove();
      }
    };
  };

  // node_modules/@openchamber/sdk/dist/ui/field.js
  var mountTextField = (root2, initial) => {
    ensureStyle(UI_CSS);
    let props = initial;
    const field2 = el("label", "oc-sdk oc-sdk-field");
    const caption = el("span", "oc-sdk-field-label");
    const input = props.multiline ? el("textarea", "oc-sdk-input") : el("input", "oc-sdk-input");
    const note = el("span", "oc-sdk-field-note");
    field2.append(caption, input, note);
    root2.append(field2);
    const paint = () => {
      setText(caption, props.label);
      caption.hidden = !props.label;
      if (input instanceof HTMLInputElement) {
        input.type = props.password ? "password" : "text";
      } else {
        input.rows = props.rows ?? 3;
      }
      if (input.value !== props.value) {
        input.value = props.value;
      }
      input.disabled = Boolean(props.disabled);
      setAttr(input, "placeholder", props.placeholder);
      input.dataset.mono = props.mono ? "true" : "false";
      const invalid = Boolean(props.error);
      field2.dataset.invalid = invalid ? "true" : "false";
      input.setAttribute("aria-invalid", invalid ? "true" : "false");
      const text = props.error ?? props.helper ?? "";
      setText(note, text);
      note.hidden = text === "";
    };
    const onInput = () => {
      props.onChange(input.value);
    };
    input.addEventListener("input", onInput);
    paint();
    return {
      update: (next) => {
        props = { ...props, ...next };
        paint();
      },
      dispose: () => {
        input.removeEventListener("input", onInput);
        field2.remove();
      }
    };
  };

  // node_modules/@openchamber/sdk/dist/ui/icons.js
  var SVG_NS = "http://www.w3.org/2000/svg";
  var ICON_PATH = {
    search: "M18.031 16.617l4.283 4.282-1.415 1.415-4.282-4.283A8.96 8.96 0 0 1 11 20c-4.968 0-9-4.032-9-9s4.032-9 9-9 9 4.032 9 9a8.96 8.96 0 0 1-1.969 5.617zm-2.006-.742A6.977 6.977 0 0 0 18 11c0-3.868-3.133-7-7-7-3.868 0-7 3.132-7 7 0 3.867 3.132 7 7 7a6.977 6.977 0 0 0 4.875-1.975l.15-.15z",
    chevron: "M12 13.172l4.95-4.95 1.414 1.414L12 16 5.636 9.636 7.05 8.222z",
    check: "M10 15.172l9.192-9.193 1.415 1.414L10 18l-6.364-6.364 1.414-1.414z",
    close: "M12 10.586l4.95-4.95 1.414 1.414-4.95 4.95 4.95 4.95-1.414 1.414-4.95-4.95-4.95 4.95-1.414-1.414 4.95-4.95-4.95-4.95L7.05 5.636z"
  };
  var icon = (name, size, className) => {
    const node = document.createElementNS(SVG_NS, "svg");
    node.setAttribute("viewBox", "0 0 24 24");
    node.setAttribute("width", String(size));
    node.setAttribute("height", String(size));
    node.style.width = len(size);
    node.style.height = len(size);
    node.setAttribute("aria-hidden", "true");
    node.setAttribute("fill", "currentColor");
    if (className) {
      node.setAttribute("class", className);
    }
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", ICON_PATH[name]);
    node.append(path);
    return node;
  };

  // node_modules/@openchamber/sdk/dist/ui/navigation.js
  var navigationKey = (event, axis = "vertical") => {
    const [next, previous] = axis === "vertical" ? ["ArrowDown", "ArrowUp"] : ["ArrowRight", "ArrowLeft"];
    if (event.key === next || event.ctrlKey && event.key.toLowerCase() === "n")
      return "next";
    if (event.key === previous || event.ctrlKey && event.key.toLowerCase() === "p")
      return "previous";
    if (event.key === "Home")
      return "first";
    if (event.key === "End")
      return "last";
    return null;
  };
  var moveListSelection = (items, currentId, key) => {
    const enabled = items.filter((item) => !item.disabled);
    if (enabled.length === 0) {
      return null;
    }
    const first = enabled[0];
    const last = enabled[enabled.length - 1];
    if (key === "first" || !first || !last) {
      return first?.id ?? null;
    }
    if (key === "last") {
      return last.id;
    }
    const index = enabled.findIndex((item) => item.id === currentId);
    if (index === -1) {
      return key === "next" ? first.id : last.id;
    }
    const target = enabled[Math.min(enabled.length - 1, Math.max(0, index + (key === "next" ? 1 : -1)))];
    return target?.id ?? null;
  };

  // node_modules/@openchamber/sdk/dist/ui/option.js
  var optionId = (uid2, id) => `${uid2}-${id ?? ""}`;
  var createOption = (uid2, role, spec, on) => {
    const node = button("oc-sdk-option");
    node.id = optionId(uid2, spec.id);
    node.setAttribute("role", role);
    node.tabIndex = -1;
    node.disabled = Boolean(spec.disabled);
    if (role === "option") {
      node.setAttribute("aria-selected", spec.selected ? "true" : "false");
    }
    node.dataset.destructive = spec.destructive ? "true" : "false";
    const label = el("span", "oc-sdk-option-label");
    label.textContent = spec.label;
    node.append(label);
    if (spec.hint) {
      const hint = el("span", "oc-sdk-option-hint");
      hint.textContent = spec.hint;
      node.append(hint);
    }
    if (role === "option") {
      node.dataset.mark = "check";
      const check = el("span", "oc-sdk-option-check");
      check.append(icon("check", 14));
      node.append(check);
    }
    node.addEventListener("pointerenter", on.hover);
    node.addEventListener("click", on.pick);
    return node;
  };
  var highlightOption = (container, focusOwner, uid2, id) => {
    const target = optionId(uid2, id);
    for (const child of Array.from(container.children)) {
      if (child instanceof HTMLElement && child.classList.contains("oc-sdk-option")) {
        child.dataset.active = child.id === target ? "true" : "false";
      }
    }
    setAttr(focusOwner, "aria-activedescendant", id ? target : null);
    container.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  };

  // node_modules/@openchamber/sdk/dist/ui/popup.js
  var placePopup = (popup, trigger) => {
    const rect = trigger.getBoundingClientRect();
    popup.style.minWidth = `${Math.round(rect.width)}px`;
    popup.style.left = `${Math.round(rect.left)}px`;
    popup.style.top = `${Math.round(rect.bottom + 4)}px`;
    const height = popup.offsetHeight;
    const roomBelow = window.innerHeight - rect.bottom - 8;
    if (height > roomBelow && rect.top - 8 > roomBelow) {
      popup.style.top = `${Math.max(8, Math.round(rect.top - 4 - height))}px`;
    }
    const overflow = rect.left + popup.offsetWidth - window.innerWidth + 8;
    if (overflow > 0) {
      popup.style.left = `${Math.max(8, Math.round(rect.left - overflow))}px`;
    }
  };
  var openPopup = (host2, trigger, popup, close) => {
    host2.append(popup);
    placePopup(popup, trigger);
    const stopOutside = onOutsideClick(host2, close);
    const onResize = () => {
      close();
    };
    const onScroll = (event) => {
      if (event.target instanceof Node && popup.contains(event.target)) {
        return;
      }
      close();
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      stopOutside();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
      popup.remove();
    };
  };

  // node_modules/@openchamber/sdk/dist/ui/select.js
  var filterSelectOptions = (options, query) => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return [...options];
    }
    return options.filter((option) => option.label.toLowerCase().includes(needle) || option.id.toLowerCase().includes(needle));
  };
  var selectCount = 0;
  var mountSelect = (root2, initial) => {
    ensureStyle(UI_CSS);
    let props = initial;
    const uid2 = `oc-sdk-select-${selectCount += 1}`;
    const wrap = el("div", "oc-sdk oc-sdk-select");
    const caption = el("span", "oc-sdk-field-label");
    caption.id = `${uid2}-label`;
    const trigger = button("oc-sdk-trigger");
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-labelledby", caption.id);
    const value = el("span", "oc-sdk-trigger-value");
    trigger.append(value, icon("chevron", 14, "oc-sdk-trigger-chevron"));
    wrap.append(caption, trigger);
    root2.append(wrap);
    let query = "";
    let activeId = null;
    let closePopup = null;
    const popup = el("div", "oc-sdk oc-sdk-popup");
    const searchSlot = el("div", "oc-sdk-popup-search");
    const search = el("input", "oc-sdk-input");
    search.type = "text";
    search.autocomplete = "off";
    searchSlot.append(search);
    const listbox = el("div");
    listbox.setAttribute("role", "listbox");
    listbox.tabIndex = -1;
    popup.append(listbox);
    const visible = () => filterSelectOptions(props.options, props.searchable ? query : "");
    const focusOwner = () => props.searchable ? search : listbox;
    const setActive = (id) => {
      activeId = id;
      highlightOption(listbox, focusOwner(), uid2, id);
    };
    const paintOptions = () => {
      clearNode(listbox);
      const options = visible();
      if (options.length === 0) {
        const empty = el("div", "oc-sdk-popup-empty");
        empty.textContent = "No matches";
        listbox.append(empty);
      }
      for (const option of options) {
        listbox.append(createOption(uid2, "option", { ...option, selected: option.id === props.value }, {
          hover: () => setActive(option.id),
          pick: () => pick(option.id)
        }));
      }
      setActive(options.some((option) => option.id === activeId) ? activeId : options[0]?.id ?? null);
    };
    const close = () => {
      const dispose = closePopup;
      closePopup = null;
      dispose?.();
      query = "";
      search.value = "";
      trigger.setAttribute("aria-expanded", "false");
    };
    const open = () => {
      if (closePopup || props.disabled) {
        return;
      }
      activeId = props.value;
      search.placeholder = props.searchPlaceholder ?? "Search";
      if (props.searchable)
        popup.prepend(searchSlot);
      else
        searchSlot.remove();
      paintOptions();
      closePopup = openPopup(wrap, trigger, popup, close);
      trigger.setAttribute("aria-expanded", "true");
      focusOwner().focus();
    };
    const pick = (id) => {
      close();
      trigger.focus();
      if (id !== props.value)
        props.onChange(id);
    };
    const onTriggerClick = () => {
      if (closePopup)
        close();
      else
        open();
    };
    const onTriggerKey = (event) => {
      if (!closePopup && navigationKey(event)) {
        event.preventDefault();
        open();
      }
    };
    const onPopupKey = (event) => {
      const step = navigationKey(event);
      if (step) {
        event.preventDefault();
        setActive(moveListSelection(visible(), activeId, step));
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (activeId)
          pick(activeId);
      } else if (event.key === "Escape") {
        event.preventDefault();
        close();
        trigger.focus();
      } else if (props.searchable && event.target !== search && event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
        search.focus();
      }
    };
    const onSearchInput = () => {
      query = search.value;
      paintOptions();
    };
    const onFocusOut = (event) => {
      if (closePopup && !(event.relatedTarget instanceof Node && wrap.contains(event.relatedTarget)))
        close();
    };
    const paint = () => {
      setText(caption, props.label);
      caption.hidden = !props.label;
      const current = props.options.find((option) => option.id === props.value);
      setText(value, current?.label ?? props.placeholder ?? "Select");
      value.dataset.empty = current ? "false" : "true";
      trigger.disabled = Boolean(props.disabled);
      if (closePopup)
        paintOptions();
    };
    trigger.addEventListener("click", onTriggerClick);
    trigger.addEventListener("keydown", onTriggerKey);
    popup.addEventListener("keydown", onPopupKey);
    search.addEventListener("input", onSearchInput);
    wrap.addEventListener("focusout", onFocusOut);
    paint();
    return {
      update: (next) => {
        props = { ...props, ...next };
        paint();
      },
      dispose: () => {
        close();
        trigger.removeEventListener("click", onTriggerClick);
        trigger.removeEventListener("keydown", onTriggerKey);
        popup.removeEventListener("keydown", onPopupKey);
        search.removeEventListener("input", onSearchInput);
        wrap.removeEventListener("focusout", onFocusOut);
        wrap.remove();
      }
    };
  };

  // node_modules/@openchamber/sdk/dist/ui/checkbox.js
  var mountToggle = (root2, initial, role) => {
    ensureStyle(UI_CSS);
    let props = initial;
    const node = button("oc-sdk oc-sdk-check");
    node.setAttribute("role", role);
    const control = el("span", role === "switch" ? "oc-sdk-check-thumb" : "oc-sdk-check-box");
    if (role === "checkbox") {
      control.append(icon("check", 12));
    }
    const text = el("span", "oc-sdk-check-text");
    const label = el("span", "oc-sdk-check-label");
    const description = el("span", "oc-sdk-check-desc");
    text.append(label, description);
    node.append(control, text);
    root2.append(node);
    const paint = () => {
      node.setAttribute("aria-checked", props.checked ? "true" : "false");
      node.disabled = Boolean(props.disabled);
      setText(label, props.label);
      setText(description, props.description);
      description.hidden = !props.description;
    };
    const onClick = () => {
      if (!props.disabled) {
        props.onChange(!props.checked);
      }
    };
    node.addEventListener("click", onClick);
    paint();
    return {
      update: (next) => {
        props = { ...props, ...next };
        paint();
      },
      dispose: () => {
        node.removeEventListener("click", onClick);
        node.remove();
      }
    };
  };
  var mountCheckbox = (root2, initial) => mountToggle(root2, initial, "checkbox");
  var mountSwitch = (root2, initial) => mountToggle(root2, initial, "switch");

  // node_modules/@openchamber/sdk/dist/ui/tabs.js
  var mountTabs = (root2, initial) => {
    ensureStyle(UI_CSS);
    let props = initial;
    const track = el("div", "oc-sdk oc-sdk-tabs");
    track.setAttribute("role", "tablist");
    root2.append(track);
    const paint = () => {
      clearNode(track);
      track.dataset.track = props.trackBackground ? "true" : "false";
      for (const item of props.items) {
        const tab = button("oc-sdk-tab");
        tab.setAttribute("role", "tab");
        const active2 = item.id === props.activeId;
        tab.setAttribute("aria-selected", active2 ? "true" : "false");
        tab.tabIndex = active2 ? 0 : -1;
        tab.dataset.id = item.id;
        const label = el("span");
        label.textContent = item.label;
        tab.append(label);
        if (item.count !== void 0) {
          const count = el("span", "oc-sdk-tab-count");
          count.textContent = String(item.count);
          tab.append(count);
        }
        tab.addEventListener("click", () => {
          if (item.id !== props.activeId)
            props.onChange(item.id);
        });
        track.append(tab);
      }
    };
    const onKeyDown = (event) => {
      const step = navigationKey(event, "horizontal");
      if (!step) {
        return;
      }
      const next = moveListSelection(props.items, props.activeId, step);
      if (next && next !== props.activeId) {
        event.preventDefault();
        props.onChange(next);
        const tab = track.querySelector(`[data-id="${CSS.escape(next)}"]`);
        if (tab instanceof HTMLElement)
          tab.focus();
      }
    };
    track.addEventListener("keydown", onKeyDown);
    paint();
    return {
      update: (next) => {
        props = { ...props, ...next };
        paint();
      },
      dispose: () => {
        track.removeEventListener("keydown", onKeyDown);
        track.remove();
      }
    };
  };

  // node_modules/@openchamber/sdk/dist/ui/badge.js
  var applyTone = (node, tone2) => {
    setAttr(node, "data-tone", tone2 && tone2 !== "neutral" ? tone2 : null);
  };
  var mountBadge = (root2, initial) => {
    ensureStyle(UI_CSS);
    let props = initial;
    const node = el("span", "oc-sdk oc-sdk-badge");
    root2.append(node);
    const paint = () => {
      setText(node, props.label);
      applyTone(node, props.tone);
    };
    paint();
    return {
      update: (next) => {
        props = { ...props, ...next };
        paint();
      },
      dispose: () => {
        node.remove();
      }
    };
  };

  // node_modules/@openchamber/sdk/dist/ui/banner.js
  var mountBanner = (root2, initial) => {
    ensureStyle(UI_CSS);
    let props = initial;
    const node = el("div", "oc-sdk oc-sdk-banner");
    const text = el("div", "oc-sdk-banner-text");
    const title = el("div", "oc-sdk-banner-title");
    const body = el("div", "oc-sdk-banner-body");
    const slot = el("div", "oc-sdk-banner-action");
    text.append(title, body);
    node.append(text, slot);
    root2.append(node);
    let action = null;
    const paint = () => {
      node.dataset.tone = props.tone;
      node.setAttribute("role", props.tone === "error" || props.tone === "warning" ? "alert" : "status");
      setText(title, props.title);
      setText(body, props.body);
      body.hidden = !props.body;
      slot.hidden = !props.action;
      if (!props.action) {
        action?.dispose();
        action = null;
        return;
      }
      const next = { label: props.action.label, onClick: props.action.onClick };
      if (action) {
        action.update(next);
      } else {
        action = mountButton(slot, { ...next, variant: "outline", size: "xs" });
      }
    };
    paint();
    return {
      update: (next) => {
        props = { ...props, ...next };
        paint();
      },
      dispose: () => {
        action?.dispose();
        action = null;
        node.remove();
      }
    };
  };

  // node_modules/@openchamber/sdk/dist/ui/progress.js
  var clampProgress = (value) => Number.isFinite(value) ? Math.min(100, Math.max(0, Math.floor(value))) : 0;
  var mountProgress = (root2, initial) => {
    ensureStyle(UI_CSS);
    let props = initial;
    const node = el("div", "oc-sdk oc-sdk-progress");
    const caption = el("div", "oc-sdk-progress-label");
    const label = el("span");
    const percent = el("span", "oc-sdk-progress-value");
    const percentText = el("span");
    const doneMark = icon("check", 14);
    percent.append(doneMark, percentText);
    caption.append(label, percent);
    const track = el("div", "oc-sdk-progress-track");
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", "100");
    const fill = el("div", "oc-sdk-progress-fill");
    track.append(fill);
    node.append(caption, track);
    root2.append(node);
    const paint = () => {
      const value = clampProgress(props.value);
      applyTone(fill, props.tone);
      fill.style.transform = `scaleX(${value / 100})`;
      track.setAttribute("aria-valuenow", String(value));
      if (props.label)
        track.setAttribute("aria-label", props.label);
      else
        track.removeAttribute("aria-label");
      setText(label, props.label);
      setText(percentText, `${value}%`);
      const done = value === 100 && (!props.tone || props.tone === "neutral");
      setAttr(node, "data-done", done ? "true" : null);
      doneMark.style.display = done ? "" : "none";
      caption.hidden = !props.label;
    };
    paint();
    return {
      update: (next) => {
        props = { ...props, ...next };
        paint();
      },
      dispose: () => {
        node.remove();
      }
    };
  };

  // node_modules/@openchamber/sdk/dist/ui/text.js
  var MARKDOWN_TOKEN = /(!?)\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
  var isHttpUrl = (value) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  };
  var splitTextMedia = (text) => {
    const parts = [];
    let last = 0;
    for (const match of text.matchAll(MARKDOWN_TOKEN)) {
      const index = match.index ?? 0;
      if (index > last) {
        parts.push({ kind: "text", text: text.slice(last, index) });
      }
      const marker = match[1] ?? "";
      const label = (match[2] ?? "").trim();
      const href = match[3] ?? "";
      if (!isHttpUrl(href)) {
        parts.push({ kind: "text", text: match[0] });
      } else if (marker === "!") {
        parts.push({ kind: "image", src: href, alt: label });
      } else {
        parts.push({ kind: "link", href, label: label || href });
      }
      last = index + match[0].length;
    }
    if (last < text.length) {
      parts.push({ kind: "text", text: text.slice(last) });
    }
    return parts;
  };
  var mountText = (root2, initial) => {
    ensureStyle(UI_CSS);
    let props = initial;
    const node = el("div", "oc-sdk oc-sdk-text");
    root2.append(node);
    const onClick = (event) => {
      if (!(event.target instanceof HTMLAnchorElement) || !props.onOpenUrl) {
        return;
      }
      event.preventDefault();
      props.onOpenUrl(event.target.href);
    };
    const paint = () => {
      clearNode(node);
      for (const part of splitTextMedia(props.text)) {
        if (part.kind === "text") {
          node.append(document.createTextNode(part.text));
        } else if (part.kind === "link") {
          const link = el("a");
          link.href = part.href;
          link.rel = "noopener noreferrer";
          link.target = "_blank";
          link.textContent = part.label;
          node.append(link);
        } else {
          const img = el("img");
          img.src = part.src;
          img.alt = part.alt;
          img.loading = "lazy";
          img.referrerPolicy = "no-referrer";
          node.append(img);
        }
      }
    };
    node.addEventListener("click", onClick);
    paint();
    return {
      update: (next) => {
        props = { ...props, ...next };
        paint();
      },
      dispose: () => {
        node.removeEventListener("click", onClick);
        node.remove();
      }
    };
  };

  // panel/fill.ts
  function matchingBraceEnd(source, start) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
      const character = source[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
      } else if (character === "{") {
        depth += 1;
      } else if (character === "}") {
        depth -= 1;
        if (depth === 0) return index;
      }
    }
    return -1;
  }
  function extractJsonObject(text) {
    const source = String(text || "");
    let start = source.indexOf("{");
    while (start >= 0) {
      const end = matchingBraceEnd(source, start);
      if (end > start) {
        try {
          const parsed = JSON.parse(source.slice(start, end + 1));
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed;
          }
        } catch {
        }
      }
      start = source.indexOf("{", start + 1);
    }
    return null;
  }
  function fillValuesFromJson(parsed, missing) {
    const byKey = new Map(
      Object.entries(parsed).map(([key, value]) => [key.trim().toLowerCase(), value])
    );
    const values = {};
    for (const field2 of missing) {
      const raw = parsed[field2.key] ?? byKey.get(field2.key.toLowerCase());
      if (typeof raw !== "string" && !(typeof raw === "number" && Number.isFinite(raw))) continue;
      const trimmed = String(raw).trim();
      if (!trimmed || /^(?:string|<string>)$/i.test(trimmed)) continue;
      const value = trimmed.slice(0, field2.max);
      if (value) values[field2.key] = value;
    }
    return values;
  }

  // panel/main.ts
  var VERSION = "1.2.0";
  var CONFIG_VERSION = 3;
  var CONFIG_PATH = "~/.config/openchamber/fox-box/config.json";
  var LEGACY_STATUS_PATH = "~/.config/openchamber/fox-box/status.json";
  var CHARACTER_INDEX_KEY = "characters:index";
  var SPARK_INDEX_KEY = "sparks:index";
  var characterKey = (id) => `character:${id}`;
  var sparkKey = (id) => `spark:${id}`;
  var characterCache = /* @__PURE__ */ new Map();
  var sparkCache = /* @__PURE__ */ new Map();
  var COMPOSE_MAX = 15600;
  var PROMPT_MAX = 15600;
  var CLIPBOARD_MAX = 32e3;
  var BRIEF_MAX = 1800;
  var NOTE_MAX = 2e3;
  var CONVERSATION_MAX = 26e3;
  var DEFAULT_CONTRACT = [
    "Fox Box small-model contract:",
    "- Prefer reading the code over guessing what it contains.",
    "- Before claiming success, run the check that proves it. If you cannot run it, say what remains unverified."
  ].join("\n");
  var LEGACY_CONTRACT_V2 = [
    "Fox Box small-model contract:",
    "- Work in small, verifiable steps. Do not start a second step before the first has a visible result.",
    "- Read only what the current step needs. Prefer one tool call at a time, and never repeat a call that already answered.",
    "- Before claiming success, run the check that proves it. If you cannot run it, say what remains unverified.",
    "- Keep chat replies short. Put exploration in tools, not in prose. Ask one precise question only when blocked."
  ].join("\n");
  var KNOWN_TOOLS = [
    {
      id: "subagent",
      label: "Subagents",
      /* OpenCode V2 names the spawner "subagent"; V1 called it "task". Hide both so the
         toggle works across versions and does not silently match nothing. */
      names: ["subagent", "task"],
      description: "Removes the subagent spawner from this request."
    },
    {
      id: "webfetch",
      label: "Web fetch",
      names: ["webfetch"],
      description: "Removes the page fetcher."
    },
    {
      id: "websearch",
      label: "Web search",
      names: ["websearch"],
      description: "Removes the search tool."
    },
    {
      id: "todo",
      label: "Todo tools",
      names: ["todowrite", "todoread"],
      description: "Removes the task-list pair."
    }
  ];
  var QWEN_PRESETS = {
    "qwen-thinking": {
      temperature: 1,
      topP: 0.95,
      topK: 20,
      presencePenalty: 0,
      frequencyPenalty: 0,
      maxOutputTokens: 8192,
      capOutput: true,
      reasoningEffort: "xhigh"
    },
    "qwen-instruct": {
      temperature: 0.7,
      topP: 0.8,
      topK: 20,
      presencePenalty: 1.5,
      frequencyPenalty: 0,
      maxOutputTokens: 8192,
      capOutput: true,
      reasoningEffort: "none"
    },
    balanced: {
      temperature: 0.4,
      topP: 0.9,
      topK: 40,
      presencePenalty: 0,
      frequencyPenalty: 0,
      maxOutputTokens: 8192,
      capOutput: true,
      reasoningEffort: "medium"
    }
  };
  var host = connectHost();
  var root = document.querySelector("#root");
  if (!root) throw new Error("Missing #root");
  var ready = null;
  var booted = false;
  var booting = false;
  var config = defaultConfig();
  var characters = [];
  var sparks = [];
  var selectedCharacterId = null;
  var selectedSparks = /* @__PURE__ */ new Set();
  var pluginStatus = null;
  var statusKey = "";
  var currentSessionRecord = null;
  var sessionsStop = null;
  var sessionsToken = 0;
  var sessionsRetryTimer;
  var projectRetryTimer;
  var projectRetryDelay = 5e3;
  var projectId = null;
  var projectKey = "";
  var lastDirectory = "";
  var syncSeq = 0;
  var activeTab = "context";
  var activePower = "context-keeper";
  var actionItem = null;
  var pendingAction = null;
  var powerCards = /* @__PURE__ */ new Map();
  var powerResults = {};
  var powerUpdaters = {};
  var resultClearers = {};
  var handles = {};
  var tabsHandle = null;
  var bannerHandle = null;
  var bannerHost = null;
  var footerStatus = null;
  var footerPlugin = null;
  var footerMessage = "Rules loaded";
  var projectScan = null;
  var statusTimer;
  var statusBusy = false;
  var sessionNameEl = null;
  var sessionDot = null;
  var sessionActivityEl = null;
  var sessionModelChip = null;
  var sessionMeterText = null;
  var sessionStatsEl = null;
  var sessionGuardEl = null;
  var sessionPowersEl = null;
  var sessionProgress = null;
  var sliceState = {
    mode: "feature",
    goal: "",
    constraints: "",
    scan: true,
    small: true,
    brief: true,
    result: ""
  };
  var bugState = {
    symptom: "",
    where: "",
    changed: "",
    focus: "full",
    includeFile: true,
    result: ""
  };
  var redState = {
    code: "",
    path: "",
    range: "",
    label: "",
    focus: /* @__PURE__ */ new Set(["correctness", "edge", "tests"]),
    extra: "",
    result: ""
  };
  var gameState = {
    genre: "platformer",
    engine: "bevy",
    loop: "",
    feel: "",
    mechanic: "",
    workbench: "juice",
    result: ""
  };
  var charState = {
    result: ""
  };
  var proseState = {
    mode: "line",
    text: "",
    focus: "sensory",
    style: "preserve",
    characterId: "",
    result: "",
    source: ""
  };
  var ideaState = {
    title: "",
    note: "",
    result: ""
  };
  var handoffState = {
    messages: null,
    title: "",
    notes: "",
    result: "",
    truncated: false
  };
  function el2(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== void 0) node.textContent = text;
    return node;
  }
  function icon2(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "fb-icon");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#fb-${name}`);
    svg.append(use);
    return svg;
  }
  function uid() {
    try {
      return crypto.randomUUID();
    } catch {
      return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    }
  }
  function normalizeDir(value) {
    return (value ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  }
  function statusFileKey(directory) {
    const key = normalizeDir(directory) || "global";
    let hash = 2166136261;
    for (let index = 0; index < key.length; index += 1) {
      hash ^= key.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `status-${(hash >>> 0).toString(36)}.json`;
  }
  function projectStatusPath() {
    return `~/.config/openchamber/fox-box/${statusFileKey(ready?.directory)}`;
  }
  function fmt(value) {
    return Math.round(value).toLocaleString();
  }
  function fmtCompact(value) {
    if (!Number.isFinite(value) || value <= 0) return "0";
    if (value >= 1e6) return `${(value / 1e6).toFixed(1)}m`;
    if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
    return String(Math.round(value));
  }
  function amount(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }
  function percentOf(part, whole) {
    if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return 0;
    return Math.min(100, Math.max(0, part / whole * 100));
  }
  function fmtPercent(value) {
    if (!Number.isFinite(value) || value <= 0) return "0%";
    if (value < 1) return "<1%";
    return `${Math.round(value)}%`;
  }
  function fmtAge(at) {
    const time = Number(at);
    if (!Number.isFinite(time) || time <= 0) return "never";
    const age = Math.max(0, Date.now() - time);
    if (age < 45e3) return "just now";
    const minutes = Math.max(1, Math.floor(age / 6e4));
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.max(1, Math.floor(minutes / 60));
    if (hours < 36) return `${hours}h ago`;
    return `${Math.max(1, Math.floor(hours / 24))}d ago`;
  }
  function shortSessionId(id) {
    const clean = String(id || "");
    return clean.length <= 12 ? clean : `\u2026${clean.slice(-6)}`;
  }
  function statChip(label, value, sub) {
    const chip = el2("span", "fb-stat");
    chip.append(el2("span", "fb-stat-label", label), el2("span", "fb-stat-value", value));
    if (sub) chip.append(el2("span", "fb-stat-sub", sub));
    return chip;
  }
  function shortModel(value) {
    const text = (typeof value === "string" ? value : String(value ?? "")).trim();
    if (!text) return "model unknown";
    const tail = text.includes("/") ? text.slice(text.lastIndexOf("/") + 1) : text;
    return tail.length > 30 ? `${tail.slice(0, 28)}\u2026` : tail;
  }
  function isQwenModel(value) {
    const text = (value ?? "").toLowerCase();
    return /qwen|unsloth|flash[-_ ]?next|iq4_xs|iq3_xxs|ud-q[2-8]/.test(text);
  }
  function capText(text, max) {
    if (text.length <= max) return text;
    const head = Math.floor(max * 0.62);
    const tail = Math.floor(max * 0.24);
    return `${text.slice(0, head)}

\u2026 [${fmt(text.length - head - tail)} characters trimmed] \u2026

${text.slice(-tail)}`;
  }
  function slugify(value) {
    const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 52);
    return slug || "plan";
  }
  function fileStamp() {
    return `${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  }
  function debounce(fn, ms) {
    let timer;
    return (...args) => {
      if (timer !== void 0) window.clearTimeout(timer);
      timer = window.setTimeout(() => fn(...args), ms);
    };
  }
  function errorCode(error) {
    return error instanceof HostRequestError ? error.code : null;
  }
  function describeError(error) {
    const code = errorCode(error);
    switch (code) {
      case "NOT_GRANTED":
        return "That permission is not approved. Open Settings \u2192 Extensions \u2192 Fox Box and approve its capabilities.";
      case "NO_SESSION":
        return "Open a chat first, then try again.";
      case "SESSION_BUSY":
        return "The chat is busy. The text can be placed in the composer instead.";
      case "NO_MODEL":
        return "No Small Model is available. Set one in Settings \u2192 Sessions \u2192 Small Model.";
      case "MODEL_FAILED":
        return "The Small Model call failed. Try a shorter input, or hand the work to the chat agent.";
      case "NO_DIRECTORY":
        return "Open a project folder first.";
      case "NOT_FOUND":
        return "That file could not be found.";
      case "BAD_PATH":
        return "That path is outside the folder this extension may read or write.";
      case "FILE_TOO_LARGE":
        return "That file is larger than the extension can read.";
      case "HOST_TIMEOUT":
        return "OpenChamber did not answer in time. Try again.";
      case "DISABLED":
        return "Fox Box is paused in Settings \u2192 Extensions.";
      default:
        if (typeof error === "string" && error.trim()) return error;
        return error instanceof Error ? error.message : "Something went wrong.";
    }
  }
  function toast(kind, message) {
    void host.toast({ kind, message: capText(message, 220) }).catch(() => {
    });
  }
  function showBanner(tone2, title, body) {
    if (!bannerHost) return;
    try {
      bannerHandle?.dispose();
      bannerHost.hidden = false;
      bannerHandle = mountBanner(bannerHost, {
        tone: tone2,
        title,
        body,
        action: { label: "Dismiss", onClick: () => clearBanner() }
      });
    } catch {
      bannerHandle = null;
      bannerHost.hidden = true;
    }
  }
  function clearBanner() {
    try {
      bannerHandle?.dispose();
    } catch {
    }
    bannerHandle = null;
    if (bannerHost) bannerHost.hidden = true;
  }
  function notifyError(error, context) {
    const code = errorCode(error);
    showBanner("error", `${context} failed`, `${describeError(error)}${code ? ` (${code})` : ""}`);
    toast("error", describeError(error));
  }
  function setFooter(text) {
    footerMessage = text;
    if (footerStatus) footerStatus.textContent = text;
  }
  function clearPowerResult(id) {
    try {
      resultClearers[id]?.();
    } catch {
    }
    powerResults[id] = false;
    powerCards.get(id)?.refresh();
  }
  function defaultConfig() {
    return {
      version: CONFIG_VERSION,
      powers: {
        context: {
          enabled: true,
          protectSkills: true,
          keepRecent: 8,
          protectedReads: 6,
          collapseDuplicates: true,
          trimToolOutput: false,
          maxToolOutput: 128e3,
          maxOldToolOutput: 6e3,
          protectPaths: "",
          pathSupersession: true,
          staleReads: true,
          mergeReadRanges: true,
          editReceipts: true,
          receiptMinChars: 1200,
          smartCompaction: true,
          skeletonCodeReads: false,
          budgetTokens: 0,
          charsPerToken: 4,
          relevanceScoring: true,
          briefs: {}
        },
        model: {
          enabled: true,
          preset: "qwen-thinking",
          applyToQwenOnly: true,
          ...QWEN_PRESETS["qwen-thinking"],
          contractEnabled: true,
          contract: DEFAULT_CONTRACT,
          hideTools: []
        }
      }
    };
  }
  function clampInt(value, min, max, fallback) {
    const number = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
  }
  function clampNumber(value, min, max, fallback) {
    const number = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }
  function mergeConfig(input) {
    const base = defaultConfig();
    const inputVersion = clampInt(input?.version, 1, CONFIG_VERSION, 1);
    const context = input?.powers?.context ?? {};
    const model = input?.powers?.model ?? {};
    const briefs = {};
    if (context.briefs && typeof context.briefs === "object" && !Array.isArray(context.briefs)) {
      for (const [key, value] of Object.entries(context.briefs)) {
        if (typeof key === "string" && typeof value === "string" && value.trim()) {
          briefs[key.slice(0, 260)] = value.slice(0, BRIEF_MAX);
        }
        if (Object.keys(briefs).length >= 60) break;
      }
    }
    const preset = ["qwen-thinking", "qwen-instruct", "balanced", "custom"].includes(model.preset) ? model.preset : base.powers.model.preset;
    const presetValues = QWEN_PRESETS[preset] ?? QWEN_PRESETS["qwen-thinking"];
    const hiddenTools = [];
    if (Array.isArray(model.hideTools)) {
      for (const name of model.hideTools.slice(0, 24)) {
        if (typeof name !== "string" || !name.trim()) continue;
        const clean = name.trim().slice(0, 64);
        if (clean === "todo") hiddenTools.push("todowrite", "todoread");
        else if (clean === "task" || clean === "subagent") hiddenTools.push("subagent", "task");
        else hiddenTools.push(clean);
      }
    }
    const legacyCap = context.maxToolOutput === null || context.maxToolOutput === void 0 ? Number.NaN : Number(context.maxToolOutput);
    const legacyKeepRecent = context.keepRecent === null || context.keepRecent === void 0 ? Number.NaN : Number(context.keepRecent);
    const freshCapIsLegacyDefault = inputVersion < CONFIG_VERSION && (!Number.isFinite(legacyCap) || legacyCap === 48e3 || inputVersion < 2 && legacyCap > 0 && legacyCap < 48e3);
    const keepRecentIsLegacyDefault = inputVersion < CONFIG_VERSION && (!Number.isFinite(legacyKeepRecent) || legacyKeepRecent === 10);
    const contractIsLegacyDefault = inputVersion < CONFIG_VERSION && typeof model.contract === "string" && model.contract.trim() === LEGACY_CONTRACT_V2;
    const trimIsLegacyDefault = inputVersion < CONFIG_VERSION;
    return {
      version: CONFIG_VERSION,
      powers: {
        context: {
          enabled: context.enabled !== false,
          protectSkills: context.protectSkills !== false,
          keepRecent: keepRecentIsLegacyDefault ? base.powers.context.keepRecent : clampInt(context.keepRecent ?? base.powers.context.keepRecent, 2, 40, base.powers.context.keepRecent),
          protectedReads: clampInt(context.protectedReads ?? 6, 0, 12, base.powers.context.protectedReads),
          collapseDuplicates: context.collapseDuplicates !== false,
          trimToolOutput: trimIsLegacyDefault ? false : context.trimToolOutput === true,
          maxToolOutput: freshCapIsLegacyDefault ? base.powers.context.maxToolOutput : clampInt(context.maxToolOutput ?? base.powers.context.maxToolOutput, 2e3, 256e3, base.powers.context.maxToolOutput),
          maxOldToolOutput: clampInt(
            context.maxOldToolOutput ?? base.powers.context.maxOldToolOutput,
            1e3,
            64e3,
            base.powers.context.maxOldToolOutput
          ),
          protectPaths: typeof context.protectPaths === "string" ? context.protectPaths.slice(0, 4e3) : "",
          pathSupersession: context.pathSupersession !== false,
          staleReads: context.staleReads !== false,
          mergeReadRanges: context.mergeReadRanges !== false,
          editReceipts: context.editReceipts !== false,
          receiptMinChars: clampInt(
            context.receiptMinChars ?? base.powers.context.receiptMinChars,
            200,
            2e4,
            base.powers.context.receiptMinChars
          ),
          smartCompaction: context.smartCompaction !== false,
          skeletonCodeReads: trimIsLegacyDefault ? false : context.skeletonCodeReads === true,
          budgetTokens: clampInt(
            context.budgetTokens ?? base.powers.context.budgetTokens,
            0,
            2e6,
            base.powers.context.budgetTokens
          ),
          charsPerToken: clampNumber(
            context.charsPerToken ?? base.powers.context.charsPerToken,
            1,
            20,
            base.powers.context.charsPerToken
          ),
          relevanceScoring: context.relevanceScoring !== false,
          briefs
        },
        model: {
          enabled: model.enabled !== false,
          preset,
          applyToQwenOnly: model.applyToQwenOnly !== false,
          temperature: clampNumber(
            model.temperature ?? presetValues.temperature,
            0,
            2,
            presetValues.temperature
          ),
          topP: clampNumber(model.topP ?? presetValues.topP, 0, 1, presetValues.topP),
          topK: clampInt(model.topK ?? presetValues.topK, 0, 200, presetValues.topK),
          presencePenalty: clampNumber(
            model.presencePenalty ?? presetValues.presencePenalty,
            -2,
            2,
            presetValues.presencePenalty
          ),
          frequencyPenalty: clampNumber(
            model.frequencyPenalty ?? presetValues.frequencyPenalty,
            -2,
            2,
            presetValues.frequencyPenalty
          ),
          maxOutputTokens: clampInt(
            model.maxOutputTokens ?? presetValues.maxOutputTokens,
            256,
            64e3,
            presetValues.maxOutputTokens
          ),
          capOutput: model.capOutput !== false,
          reasoningEffort: typeof model.reasoningEffort === "string" ? model.reasoningEffort.slice(0, 16) : presetValues.reasoningEffort,
          contractEnabled: model.contractEnabled !== false,
          contract: contractIsLegacyDefault || typeof model.contract !== "string" || !model.contract.trim() ? DEFAULT_CONTRACT : model.contract.slice(0, 3500),
          hideTools: Array.from(new Set(hiddenTools)).slice(0, 24)
        }
      }
    };
  }
  var configTimer;
  var savingConfig = false;
  var saveAgain = false;
  var configLoaded = false;
  var configNewer = false;
  var configSaveWarned = false;
  var configPending = false;
  var configSavePromise = Promise.resolve();
  function queueConfigSave() {
    setFooter("Saving rules\u2026");
    configPending = true;
    if (configTimer !== void 0) window.clearTimeout(configTimer);
    configTimer = window.setTimeout(() => {
      configTimer = void 0;
      void saveConfigNow();
    }, 320);
  }
  function saveConfigNow() {
    if (!configLoaded || configNewer) {
      setFooter("Rules not saved");
      if (!configSaveWarned) {
        configSaveWarned = true;
        showBanner(
          "error",
          configNewer ? "Rules need a newer Fox Box" : "Rules could not be saved",
          configNewer ? "This config file was written by a newer Fox Box version. Update the extension before saving; changes stay in memory for now." : "Fox Box could not load its config file, so it will not overwrite it. Fix or remove ~/.config/openchamber/fox-box/config.json, or approve Fox Box's file access in Settings \u2192 Extensions, then reopen the panel."
        );
      }
      return configSavePromise;
    }
    if (savingConfig) {
      saveAgain = true;
      return configSavePromise;
    }
    savingConfig = true;
    configSavePromise = (async () => {
      try {
        do {
          saveAgain = false;
          syncMeasuredRatio();
          const snapshot = JSON.stringify(config, null, 2);
          try {
            await host.writeFile(CONFIG_PATH, snapshot);
            setFooter("Rules saved");
            if (!saveAgain) configPending = false;
          } catch (error) {
            setFooter("Rules not saved");
            notifyError(error, "Saving rules");
            if (saveAgain) {
              saveAgain = false;
              queueConfigSave();
            }
            return;
          }
        } while (saveAgain);
      } finally {
        savingConfig = false;
      }
    })();
    return configSavePromise;
  }
  async function loadConfig() {
    try {
      const { content } = await host.readFile(CONFIG_PATH);
      const raw = JSON.parse(content.replace(/^\uFEFF/, ""));
      config = mergeConfig(raw);
      configLoaded = true;
      configSaveWarned = false;
      const rawVersion = Number(raw?.version);
      configNewer = Number.isFinite(rawVersion) && rawVersion > CONFIG_VERSION;
      if (!Number.isFinite(rawVersion) || rawVersion < CONFIG_VERSION) {
        try {
          await host.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
        } catch {
        }
      }
      setFooter(configNewer ? "Rules read-only" : "Rules loaded");
    } catch (error) {
      if (errorCode(error) === "NOT_FOUND") {
        config = defaultConfig();
        configNewer = false;
        try {
          await host.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
          configLoaded = true;
          configSaveWarned = false;
          setFooter("Rules saved");
        } catch (writeError) {
          configLoaded = false;
          setFooter("Local rules only");
          if (errorCode(writeError) !== "NOT_GRANTED") notifyError(writeError, "Saving rules");
        }
        return;
      }
      configLoaded = false;
      setFooter("Local rules only");
      if (errorCode(error) !== "NOT_GRANTED") notifyError(error, "Loading rules");
    }
  }
  function currentBrief() {
    return config.powers.context.briefs[projectKey] ?? "";
  }
  function setCurrentBrief(value) {
    const next = value.slice(0, BRIEF_MAX);
    if (next.trim()) config.powers.context.briefs[projectKey] = next;
    else delete config.powers.context.briefs[projectKey];
    queueConfigSave();
  }
  function sessionId() {
    return ready?.session?.id ?? "";
  }
  function sessionModel() {
    return ready?.session?.model ?? "";
  }
  function hasSession() {
    return Boolean(ready?.session?.id);
  }
  function modelApplies() {
    const model = config.powers.model;
    if (!model.enabled) return false;
    if (!model.applyToQwenOnly) return true;
    return isQwenModel(sessionModel());
  }
  var FALLBACK_TOKENS_PER_CHAR = 0.25;
  function tokenEstimate() {
    const last = pluginStatus?.last;
    const tokens = amount(currentSessionRecord?.context?.tokens);
    const chars = amount(last?.measure?.textChars) || amount(last?.keptChars);
    if (!config.powers.context.enabled || !last || last.sessionId !== sessionId() || tokens <= 0 || chars <= 0) {
      return { perChar: FALLBACK_TOKENS_PER_CHAR, measured: false };
    }
    const perChar = tokens / chars;
    if (!Number.isFinite(perChar) || perChar < 0.05 || perChar > 2) {
      return { perChar: FALLBACK_TOKENS_PER_CHAR, measured: false };
    }
    return { perChar, measured: true };
  }
  function tokensForChars(chars, estimate = tokenEstimate()) {
    return Math.round(Math.max(0, chars) * estimate.perChar);
  }
  function syncMeasuredRatio() {
    const estimate = tokenEstimate();
    if (!estimate.measured) return;
    config.powers.context.charsPerToken = clampNumber(1 / estimate.perChar, 1, 20, 4);
  }
  function latestRequestNumber(entryKey, lastKey) {
    const entry = currentPluginSession();
    const direct = entry ? entry[entryKey] : void 0;
    if (typeof direct === "number") return amount(direct);
    const last = pluginStatus?.last;
    if (last && last.sessionId === sessionId()) {
      const fallback = last[lastKey];
      if (typeof fallback === "number") return amount(fallback);
    }
    return 0;
  }
  function tokenBasisText(estimate = tokenEstimate()) {
    return estimate.measured ? `${estimate.perChar.toFixed(2)} tokens per character, measured from the latest request` : "4 characters per token, the fallback";
  }
  function pluginIsLive() {
    if (!pluginStatus || pluginStatus.stopped) return false;
    const at = pluginStatus.updatedAt ?? pluginStatus.loadedAt ?? 0;
    return at > 0 && Date.now() - at < 12e4;
  }
  function pluginLabel() {
    if (!pluginStatus) return { text: "Plugin waiting", tone: "warning" };
    if (pluginStatus.stopped) return { text: "Plugin stopped", tone: "warning" };
    const at = pluginStatus.updatedAt ?? pluginStatus.loadedAt ?? 0;
    const age = Date.now() - at;
    if (age < 3e4) return { text: "Plugin active", tone: "success" };
    if (age < 12e4) return { text: "Plugin connected", tone: "success" };
    return { text: "Plugin stale", tone: "warning" };
  }
  function currentPluginSession() {
    const id = sessionId();
    const sessions = pluginStatus?.sessions;
    if (!id || !sessions) return null;
    return sessions[id] ?? null;
  }
  function guardSummary() {
    if (!pluginStatus) return "The OpenCode plugin has not reported yet. It starts with OpenCode.";
    if (pluginStatus.stopped) return "The OpenCode plugin stopped. Restart OpenCode or enable Fox Box again.";
    if (!pluginIsLive()) {
      return "The OpenCode plugin is not reporting. Restart OpenCode or enable Fox Box again.";
    }
    const entry = currentPluginSession();
    if (entry) {
      const runs = amount(entry.runs);
      const lastSaved = amount(entry.lastSaved);
      const lastCollapsed = latestRequestNumber("lastCollapsed", "collapsed");
      return `Guarded ${runs} request${runs === 1 ? "" : "s"} in this session \xB7 latest request pruned ${fmtCompact(
        lastSaved
      )} chars \xB7 ${lastCollapsed} repeat${lastCollapsed === 1 ? "" : "s"} collapsed.`;
    }
    return "Plugin ready \xB7 no request from this session yet.";
  }
  function activePowerNames() {
    const names = [];
    if (!hasSession() || !pluginIsLive()) return names;
    if (config.powers.context.enabled) names.push("Context guard");
    if (modelApplies()) names.push("Qwen fit");
    return names;
  }
  function buildSessionStrip() {
    const strip = el2("section", "fb-session");
    const top = el2("div", "fb-session-top");
    sessionDot = el2("span", "fb-dot");
    sessionDot.dataset.tone = "idle";
    sessionNameEl = el2("div", "fb-session-name fb-empty", "No session open");
    sessionActivityEl = el2("span", "fb-live");
    sessionActivityEl.append(sessionDot, el2("span", "", "idle"));
    sessionModelChip = el2("span", "fb-chip", "model unknown");
    top.append(sessionNameEl, sessionActivityEl, sessionModelChip);
    const meterLine = el2("div", "fb-meter-line");
    meterLine.append(el2("span", "", "Context window"));
    sessionMeterText = el2("span", "", "Open a chat to see its context.");
    meterLine.append(sessionMeterText);
    const meterHost = el2("div", "fb-meter-host");
    sessionProgress = mountProgress(meterHost, { value: 0, tone: "neutral", label: "" });
    sessionStatsEl = el2("div", "fb-stats");
    sessionStatsEl.hidden = true;
    sessionPowersEl = el2("div", "fb-powers-line");
    const guardLine = el2("div", "fb-note");
    sessionGuardEl = el2("span", "", "Waiting for the plugin.");
    guardLine.append(sessionGuardEl);
    strip.append(top, meterLine, meterHost, sessionStatsEl, sessionPowersEl, guardLine);
    return strip;
  }
  function updateSessionUI() {
    const session = ready?.session;
    const record = currentSessionRecord;
    const model = sessionModel();
    const estimate = tokenEstimate();
    if (sessionNameEl) {
      sessionNameEl.textContent = session?.title || session?.id || "No session open";
      sessionNameEl.classList.toggle("fb-empty", !session);
    }
    if (sessionModelChip) {
      sessionModelChip.textContent = session ? shortModel(model) : "no model";
      sessionModelChip.dataset.tone = modelApplies() ? "primary" : "";
    }
    if (sessionActivityEl && sessionDot) {
      const activity = record?.activity ?? (session ? "idle" : "unknown");
      const activityText = {
        running: "working",
        idle: "idle",
        retrying: "retrying",
        "waiting-permission": "waiting",
        "waiting-question": "waiting",
        unknown: session ? "idle" : "no chat"
      };
      const textNode = sessionActivityEl.querySelector("span:last-child");
      if (textNode) textNode.textContent = activityText[activity] ?? activity;
      sessionDot.dataset.tone = activity === "running" || activity === "retrying" ? "warning" : activity === "waiting-permission" || activity === "waiting-question" ? "error" : "idle";
    }
    const context = record?.context;
    if (context && context.tokens > 0) {
      const limit = context.limit && context.limit > 0 ? context.limit : 0;
      const percent = limit > 0 ? Math.min(100, context.tokens / limit * 100) : 0;
      if (sessionMeterText) {
        sessionMeterText.textContent = limit > 0 ? `${fmtCompact(context.tokens)} / ${fmtCompact(limit)} tokens` : `${fmtCompact(context.tokens)} tokens in context`;
      }
      sessionProgress?.update({
        value: percent,
        tone: percent >= 90 ? "error" : percent >= 70 ? "warning" : "primary",
        label: ""
      });
    } else {
      if (sessionMeterText) {
        sessionMeterText.textContent = session ? "Context appears after the first turn." : "Open a chat to see its context.";
      }
      sessionProgress?.update({ value: 0, tone: "neutral", label: "" });
    }
    if (sessionStatsEl) {
      const entry = currentPluginSession();
      const runs = amount(entry?.runs);
      const totalPruned = amount(entry?.prunedChars);
      const lastSaved = amount(entry?.lastSaved);
      const lastOriginal = amount(entry?.lastOriginal);
      const lastKept = amount(entry?.lastKept) || Math.max(0, lastOriginal - lastSaved);
      const lastTotal = lastOriginal || lastSaved + lastKept;
      const lastRate = lastTotal > 0 ? percentOf(lastSaved, lastTotal) : 0;
      const lastCollapsed = latestRequestNumber("lastCollapsed", "collapsed");
      const lastCollapsedChars = latestRequestNumber("lastCollapsedChars", "collapsedChars");
      sessionStatsEl.replaceChildren();
      sessionStatsEl.hidden = !entry || runs === 0;
      if (entry && runs > 0) {
        sessionStatsEl.append(
          statChip(
            "Pruned now",
            lastSaved > 0 ? `${fmtCompact(lastSaved)} chars` : "none",
            lastSaved > 0 ? `\u2248${fmtCompact(tokensForChars(lastSaved, estimate))} tok` : "latest request"
          ),
          statChip(
            "Saved now",
            lastTotal > 0 ? fmtPercent(lastRate) : "\u2014",
            "of the latest request"
          ),
          statChip(
            "Repeats now",
            String(lastCollapsed),
            lastCollapsed > 0 ? `${fmtCompact(lastCollapsedChars)} chars` : "none"
          ),
          statChip(
            "Cumulative",
            `${fmtCompact(totalPruned)} chars`,
            `\u2248${fmtCompact(tokensForChars(totalPruned, estimate))} tok \xB7 ${runs} req`
          )
        );
      }
    }
    if (sessionPowersEl) {
      sessionPowersEl.replaceChildren();
      const names = activePowerNames();
      const label = el2("span");
      label.append(el2("strong", "", names.length ? "Live" : "Idle"));
      sessionPowersEl.append(label);
      if (names.length) {
        for (const name of names) sessionPowersEl.append(el2("span", "fb-chip", name));
      } else {
        sessionPowersEl.append(el2("span", "fb-chip", "no automatic powers"));
      }
      const plugin = pluginLabel();
      const pluginChip = el2("span", "fb-chip", plugin.text);
      pluginChip.dataset.tone = plugin.tone;
      sessionPowersEl.append(pluginChip);
    }
    if (sessionGuardEl) sessionGuardEl.textContent = guardSummary();
    if (sessionProgress && !context) {
      sessionProgress.update({ value: 0, tone: "neutral", label: "" });
    }
  }
  function buildBannerHost() {
    const node = el2("div");
    node.hidden = true;
    bannerHost = node;
    return node;
  }
  function buildFooter() {
    const footer = el2("footer", "fb-footer");
    footerStatus = el2("span", "", footerMessage);
    footerPlugin = el2("span", "fb-inline");
    const plugin = pluginLabel();
    footerPlugin.append(el2("span", "fb-chip", plugin.text));
    const sep = el2("span", "fb-sep");
    const path = el2("code", "", "~/.config/openchamber/fox-box/config.json");
    footer.append(footerStatus, sep, footerPlugin, sep, path);
    return footer;
  }
  function group(parent, title) {
    const node = el2("div", "fb-group");
    node.append(el2("div", "fb-group-title", title));
    parent.append(node);
    return node;
  }
  function addSwitch(parent, label, description, get, set, save = true) {
    const hostNode = el2("div");
    parent.append(hostNode);
    let handle = null;
    handle = mountSwitch(hostNode, {
      label,
      description,
      checked: get(),
      onChange: (value) => {
        handle?.update({ checked: value });
        set(value);
        if (save) void saveConfigNow();
        refreshAll();
      }
    });
    return handle;
  }
  function addSelect(parent, label, options, get, set, save = true) {
    const hostNode = el2("div");
    parent.append(hostNode);
    let handle = null;
    const current = get();
    const usableOptions = options.some((option) => option.id === current) ? options : [...options, { id: current, label: current || "Custom" }];
    handle = mountSelect(hostNode, {
      label,
      value: current,
      options: usableOptions,
      onChange: (value) => {
        handle?.update({ value });
        set(value);
        if (save) void saveConfigNow();
        refreshAll();
      }
    });
    return handle;
  }
  function addCheckbox(parent, label, description, get, set, save = false) {
    const hostNode = el2("div");
    parent.append(hostNode);
    let handle = null;
    handle = mountCheckbox(hostNode, {
      label,
      description,
      checked: get(),
      onChange: (value) => {
        handle?.update({ checked: value });
        set(value);
        if (save) void saveConfigNow();
        refreshAll();
      }
    });
    return handle;
  }
  function addText(parent, label, value, onChange, options = {}) {
    const hostNode = el2("div");
    parent.append(hostNode);
    const handle = mountTextField(hostNode, {
      label,
      value,
      multiline: options.multiline,
      rows: options.rows,
      helper: options.helper,
      placeholder: options.placeholder,
      mono: options.mono,
      onChange
    });
    if (options.onCommit) {
      const input = hostNode.querySelector("input, textarea");
      input?.addEventListener("change", options.onCommit);
      input?.addEventListener("blur", options.onCommit);
    }
    return handle;
  }
  function addButton(parent, label, variant, onClick, size = "sm") {
    const hostNode = el2("span");
    parent.append(hostNode);
    return mountButton(hostNode, { label, variant, size, onClick });
  }
  function addResult(parent) {
    const node = el2("div", "fb-result");
    node.hidden = true;
    const inner = el2("div");
    node.append(inner);
    parent.append(node);
    const textHandle = mountText(inner, {
      text: "",
      onOpenUrl: (url) => {
        void host.openUrl(url).catch(() => {
        });
      }
    });
    return {
      node,
      set: (text) => {
        node.hidden = !text.trim();
        textHandle.update({ text });
        node.scrollTop = 0;
      }
    };
  }
  function addActions(parent) {
    const row = el2("div", "fb-actions");
    parent.append(row);
    return row;
  }
  function addNote(parent, text) {
    const node = el2("div", "fb-note");
    node.textContent = text;
    parent.append(node);
    return node;
  }
  async function withBusy(button2, work) {
    try {
      button2.update({ loading: true, disabled: true });
    } catch {
    }
    try {
      await work();
    } catch (error) {
      notifyError(error, "Fox Box");
    } finally {
      try {
        button2.update({ loading: false, disabled: false });
      } catch {
      }
    }
  }
  async function composeText(text, mode = "append") {
    if (!text.trim()) {
      toast("info", "Nothing to compose yet.");
      return;
    }
    try {
      await host.compose({ text: capText(text, COMPOSE_MAX), mode });
      toast("info", "Placed in the composer.");
    } catch (error) {
      notifyError(error, "Composing");
    }
  }
  async function sendToSession(text, label) {
    if (!text.trim()) {
      toast("info", "Nothing to send yet.");
      return;
    }
    try {
      const result = await host.prompt({ text: capText(text, PROMPT_MAX), send: true });
      if (result.sent !== "sent") {
        toast("info", result.sent === "no-model" ? "Choose a model before sending." : "Message was not sent.");
        return;
      }
      toast("success", label);
    } catch (error) {
      if (errorCode(error) === "SESSION_BUSY") {
        try {
          await host.compose({ text: capText(text, COMPOSE_MAX), mode: "append" });
          toast("info", "Chat busy \u2014 placed in the composer.");
          return;
        } catch {
        }
      }
      notifyError(error, "Sending to chat");
    }
  }
  async function startFreshSession(title, text) {
    if (!text.trim()) {
      toast("info", "Nothing to start a chat with yet.");
      return;
    }
    try {
      const result = await host.startSession({
        providerId: "fox-box",
        id: `foxbox-${uid()}`,
        title: title.slice(0, 200),
        text: capText(text, PROMPT_MAX),
        navigation: "open"
      });
      if (!result?.sessionId) {
        showBanner("error", "Could not start a chat", result?.failure ?? "OpenChamber did not create the session.");
        return;
      }
      if (result.sent === "no-model") {
        toast("info", "Session created; choose a model to send.");
      } else if (result.sent === "failed") {
        showBanner("warning", "Session created, first message failed", "Open the new chat and send the text again.");
      } else if (result.sent !== "sent") {
        toast("info", "Session created.");
      } else {
        toast("success", "Fresh chat started.");
      }
    } catch (error) {
      notifyError(error, "Starting a chat");
    }
  }
  async function attachText(title, text, data) {
    if (!text.trim()) {
      toast("info", "Nothing to attach yet.");
      return;
    }
    try {
      await host.attach({
        providerId: "fox-box",
        id: `foxbox-${uid()}`,
        title: title.slice(0, 200),
        url: "",
        text: capText(text, COMPOSE_MAX),
        data
      });
      toast("success", "Attached to the composer.");
    } catch (error) {
      notifyError(error, "Attaching");
    }
  }
  async function copyText(text) {
    if (!text.trim()) {
      toast("info", "Nothing to copy yet.");
      return;
    }
    try {
      await host.writeClipboard(capText(text, CLIPBOARD_MAX));
      toast("success", "Copied.");
    } catch (error) {
      notifyError(error, "Copying");
    }
  }
  async function generateText(button2, system, prompt, maxOutputTokens = 1600) {
    let result = null;
    await withBusy(button2, async () => {
      try {
        const answer = await host.generate({
          system: capText(system, 8e3),
          prompt: capText(prompt, 6e4),
          maxOutputTokens
        });
        result = answer.text.trim();
      } catch (error) {
        notifyError(error, "Generation");
      }
    });
    return result;
  }
  async function fillMissingFields(button2, options, apply) {
    const missing = options.fields.filter((field2) => !field2.value.trim());
    if (!missing.length) {
      toast("info", `Nothing to fill in the ${options.noun}.`);
      return;
    }
    const written = options.fields.filter((field2) => field2.value.trim()).map((field2) => `${field2.label} (${field2.key}):
${field2.value}`);
    const shape = {};
    for (const field2 of missing) shape[field2.key] = "string";
    const notes = missing.map((field2) => `- ${field2.key}: ${field2.label}; at most ${field2.max} characters${field2.hint ? `; ${field2.hint}` : ""}`).join("\n");
    const prompt = [
      `Fill the empty fields of this ${options.noun}.`,
      written.length ? `Fields already written (keep consistent with them; do not return these keys):
${written.join("\n\n")}` : `The ${options.noun} is empty. Invent a coherent one.`,
      options.context?.trim() ? `Context:
${options.context.trim().slice(0, 12e3)}` : "",
      `Return a JSON object with exactly these keys:
${JSON.stringify(shape, null, 2)}`,
      `Field limits and intent:
${notes}`,
      "Use string values only. Do not return empty strings. No markdown fences, no commentary."
    ].filter(Boolean).join("\n\n");
    const result = await generateText(
      button2,
      `${options.system}
Return JSON only.`,
      prompt,
      options.maxOutputTokens ?? 1200
    );
    if (!result) return;
    const parsed = extractJsonObject(result);
    if (!parsed) {
      showBanner(
        "warning",
        "Fill blanks could not read the answer",
        "The Small Model did not return usable JSON. Try again, or fill the empty fields by hand."
      );
      return;
    }
    const values = fillValuesFromJson(parsed, missing);
    if (!Object.keys(values).length) {
      showBanner(
        "warning",
        "Fill blanks came back empty",
        "The Small Model returned no usable fields. Try again, or fill the empty fields by hand."
      );
      return;
    }
    let applied;
    try {
      applied = apply(values);
    } catch (error) {
      notifyError(error, "Filling blank fields");
      return;
    }
    if (applied === false) return;
    const parsedCount = Object.keys(values).length;
    const appliedCount = typeof applied === "number" ? Math.min(parsedCount, Math.max(0, Math.floor(applied))) : parsedCount;
    if (appliedCount <= 0) return;
    const left = Math.max(0, missing.length - appliedCount);
    toast(
      "success",
      `Filled ${appliedCount} field${appliedCount === 1 ? "" : "s"}${left > 0 ? `; ${left} left blank` : ""}.`
    );
  }
  async function readOptional(path) {
    let target = normalizeGuestPath(path);
    if (path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(path)) {
      const relative = relativeToProject(path);
      if (!relative) return null;
      target = normalizeGuestPath(relative);
    }
    if (!target || target.split("/").includes("..")) return null;
    try {
      const { content } = await host.readFile(target);
      return content;
    } catch {
      return null;
    }
  }
  function normalizeGuestPath(path) {
    return String(path || "").replace(/\\/g, "/").replace(/^\.\//, "");
  }
  function relativeToProject(absolute) {
    const dir = ready?.directory;
    if (!dir) return null;
    const normalDir = dir.replace(/\\/g, "/").replace(/\/+$/, "");
    const normalPath = absolute.replace(/\\/g, "/");
    if (normalPath.toLowerCase() === normalDir.toLowerCase()) return "";
    if (!normalPath.toLowerCase().startsWith(`${normalDir.toLowerCase()}/`)) return null;
    return normalPath.slice(normalDir.length + 1);
  }
  async function detectProject() {
    const dir = ready?.directory;
    const key = normalizeDir(dir);
    if (projectScan && projectScan.key === key) return projectScan;
    const parts = [];
    let label = "Unknown stack";
    let isGame = false;
    const pkgRaw = await readOptional("package.json");
    if (pkgRaw) {
      try {
        const pkg = JSON.parse(pkgRaw);
        const deps = { ...pkg.dependencies ?? {}, ...pkg.devDependencies ?? {} };
        const names = Object.keys(deps);
        const known = names.filter(
          (name) => ["react", "vue", "svelte", "solid-js", "next", "vite", "electron", "three", "phaser", "pixi.js", "bevy", "typescript", "express", "fastify", "tauri"].some(
            (needle) => name === needle || name.startsWith(`${needle}/`)
          )
        );
        label = known.length ? `JavaScript \xB7 ${known.slice(0, 4).join(", ")}` : "JavaScript / Node";
        isGame = known.some((name) => ["three", "phaser", "pixi.js"].includes(name));
        const scripts = pkg.scripts && typeof pkg.scripts === "object" ? Object.keys(pkg.scripts).slice(0, 6) : [];
        parts.push(`package.json: name=${pkg.name ?? "?"}; scripts=${scripts.join(", ") || "none"}; deps=${names.slice(0, 20).join(", ")}`);
      } catch {
        parts.push("package.json exists but is not valid JSON.");
      }
    }
    const cargoRaw = await readOptional("Cargo.toml");
    if (cargoRaw) {
      const crate = /^\s*name\s*=\s*"([^"]+)"/m.exec(cargoRaw)?.[1] ?? "unknown";
      const deps = /\[dependencies\]([\s\S]*?)(?:\n\[|$)/.exec(cargoRaw)?.[1] ?? "";
      const names = Array.from(deps.matchAll(/^\s*([a-zA-Z0-9_-]+)\s*=/gm)).map((match) => match[1]).filter((name) => Boolean(name));
      const game = names.some((name) => ["bevy", "macroquad", "ggez", "fyrox", "amethyst"].includes(name));
      isGame = isGame || game;
      label = game ? `Rust \xB7 ${names.find((name) => ["bevy", "macroquad", "ggez", "fyrox"].includes(name))}` : "Rust";
      parts.push(`Cargo.toml: crate=${crate}; deps=${names.slice(0, 18).join(", ")}`);
    }
    const pyRaw = await readOptional("pyproject.toml");
    if (pyRaw) {
      label = "Python";
      parts.push(`pyproject.toml: ${pyRaw.slice(0, 600).replace(/\s+/g, " ")}`);
    }
    const goRaw = await readOptional("go.mod");
    if (goRaw) {
      label = "Go";
      parts.push(`go.mod: ${goRaw.slice(0, 500).replace(/\s+/g, " ")}`);
    }
    const readme = await readOptional("README.md");
    if (readme) parts.push(`README: ${readme.slice(0, 700).replace(/\s+/g, " ")}`);
    try {
      const listing = await host.listDir(".");
      const names = listing.entries.map((entry) => entry.name.toLowerCase());
      if (names.includes("project.godot")) {
        label = "Godot";
        isGame = true;
        parts.push("project.godot present");
      }
      if (names.some((name) => name.endsWith(".uproject"))) {
        label = "Unreal";
        isGame = true;
        parts.push("Unreal project file present");
      }
      if (names.includes("assets") && names.includes("projectsettings")) {
        label = "Unity";
        isGame = true;
        parts.push("Unity project folders present");
      }
      if (names.includes("mods") || names.includes("src") || names.includes("assets")) {
        parts.push(`top-level: ${names.slice(0, 16).join(", ")}`);
      }
    } catch {
    }
    projectScan = {
      key,
      label,
      isGame,
      summary: parts.join("\n").slice(0, 3600)
    };
    return projectScan;
  }
  function buildContextKeeper(parent) {
    const live = el2("div", "fb-note");
    parent.append(live);
    const refreshLive = () => {
      const entry = currentPluginSession();
      if (!config.powers.context.enabled) {
        live.textContent = "Context Keeper is off. No pruning, brief, or skill protection is applied.";
        return;
      }
      if (!pluginStatus) {
        live.textContent = "Plugin waiting. It starts with OpenCode; this panel becomes live on the first request.";
        return;
      }
      if (pluginStatus.stopped) {
        live.textContent = "Plugin stopped. Restart OpenCode or enable Fox Box again.";
        return;
      }
      if (!pluginIsLive()) {
        live.textContent = "Plugin is not reporting. Restart OpenCode or enable Fox Box again.";
        return;
      }
      if (!hasSession()) {
        live.textContent = "Plugin connected. Open a chat; its first turn is guarded.";
        return;
      }
      if (!entry) {
        live.textContent = "Plugin connected. No request from this session yet; the first turn will be guarded.";
        return;
      }
      const runs = amount(entry.runs);
      const lastSaved = amount(entry.lastSaved);
      const lastCollapsed = latestRequestNumber("lastCollapsed", "collapsed");
      live.textContent = `This session: ${runs} request${runs === 1 ? "" : "s"} guarded \xB7 latest request pruned ${fmtCompact(
        lastSaved
      )} chars \xB7 ${lastCollapsed} repeat${lastCollapsed === 1 ? "" : "s"} collapsed.`;
    };
    refreshLive();
    powerUpdaters["context-keeper"] = refreshLive;
    addSwitch(
      parent,
      "Context Keeper active",
      "Applies this project\u2019s rules to outgoing requests only. Nothing is rewritten on disk.",
      () => config.powers.context.enabled,
      (value) => {
        config.powers.context.enabled = value;
      }
    );
    const protection = group(parent, "Protection");
    addSwitch(
      protection,
      "Shield skill files",
      "The newest copy of SKILL.md, any file in a skills/ or skill/ folder, a skill JSON manifest, a skill-tool result, or a pinned path stays whole. Older copies can be pruned after a re-read.",
      () => config.powers.context.protectSkills,
      (value) => {
        config.powers.context.protectSkills = value;
      }
    );
    const protectionGrid = el2("div", "fb-grid2");
    protection.append(protectionGrid);
    addSelect(
      protectionGrid,
      "Keep recent messages",
      [2, 4, 6, 8, 10, 12, 16, 20, 24, 32, 40].map((value) => ({
        id: String(value),
        label: String(value),
        hint: value === 8 ? "default" : void 0
      })),
      () => String(config.powers.context.keepRecent),
      (value) => {
        config.powers.context.keepRecent = Number(value) || 8;
      }
    );
    addSelect(
      protectionGrid,
      "Latest reads kept",
      [
        { id: "0", label: "Off" },
        { id: "2", label: "2 files" },
        { id: "4", label: "4 files" },
        { id: "6", label: "6 files", hint: "default" },
        { id: "8", label: "8 files" },
        { id: "10", label: "10 files" },
        { id: "12", label: "12 files", hint: "max" }
      ],
      () => String(config.powers.context.protectedReads),
      (value) => {
        config.powers.context.protectedReads = Number(value) || 0;
      }
    );
    addNote(
      protection,
      "The newest read of these files keeps the fresh result cap even after it ages. While shielding is on, skills and pinned paths are outside this limit and stay whole until read again."
    );
    addText(
      protection,
      "Pinned paths",
      config.powers.context.protectPaths,
      (value) => {
        config.powers.context.protectPaths = value.slice(0, 4e3);
        queueConfigSave();
      },
      {
        multiline: true,
        rows: 3,
        helper: "One path or glob per line, e.g. src/core/** or README.md. The newest read of a matched file is kept whole.",
        placeholder: "src/core/**\ndocs/*.md"
      }
    );
    const pruning = group(parent, "Pruning");
    addSwitch(
      pruning,
      "Trim tool output",
      "Caps fresh results and shortens old ones in the outgoing request. Off by default because size caps can break context. The newest skill or pinned read stays whole; older duplicates may be collapsed.",
      () => config.powers.context.trimToolOutput,
      (value) => {
        config.powers.context.trimToolOutput = value;
      }
    );
    addSwitch(
      pruning,
      "Collapse repeated calls",
      "When the same read, search, web, or shell call appears again, keep the newest result and replace older copies with a one-line pointer. Works even when trimming is off.",
      () => config.powers.context.collapseDuplicates,
      (value) => {
        config.powers.context.collapseDuplicates = value;
      }
    );
    const pruningGrid = el2("div", "fb-grid2");
    pruning.append(pruningGrid);
    addSelect(
      pruningGrid,
      "Fresh result cap",
      [
        { id: "8000", label: "8k chars" },
        { id: "12000", label: "12k chars" },
        { id: "16000", label: "16k chars" },
        { id: "24000", label: "24k chars" },
        { id: "32000", label: "32k chars" },
        { id: "48000", label: "48k chars" },
        { id: "64000", label: "64k chars" },
        { id: "96000", label: "96k chars" },
        { id: "128000", label: "128k chars", hint: "default" },
        { id: "192000", label: "192k chars" },
        { id: "256000", label: "256k chars", hint: "almost never trim" }
      ],
      () => String(config.powers.context.maxToolOutput),
      (value) => {
        config.powers.context.maxToolOutput = Number(value) || 128e3;
      }
    );
    addSelect(
      pruningGrid,
      "Old result budget",
      [
        { id: "3000", label: "3k chars" },
        { id: "4000", label: "4k chars" },
        { id: "6000", label: "6k chars" },
        { id: "8000", label: "8k chars" },
        { id: "12000", label: "12k chars" },
        { id: "16000", label: "16k chars" },
        { id: "24000", label: "24k chars" },
        { id: "32000", label: "32k chars" },
        { id: "64000", label: "64k chars" }
      ],
      () => String(config.powers.context.maxOldToolOutput),
      (value) => {
        config.powers.context.maxOldToolOutput = Number(value) || 6e3;
      }
    );
    const advanced = group(parent, "Advanced pruning");
    addSwitch(
      advanced,
      "Supersede older reads",
      "When a file is read again, the newest read wins. Older reads whose line range is fully covered by newer reads become a short pointer; partial overlaps are merged instead.",
      () => config.powers.context.pathSupersession,
      (value) => {
        config.powers.context.pathSupersession = value;
      }
    );
    addSwitch(
      advanced,
      "Mark stale reads",
      "A read from before a later successful edit is marked stale. A skill or pinned file always keeps one copy, even when it was not re-read after the edit.",
      () => config.powers.context.staleReads,
      (value) => {
        config.powers.context.staleReads = value;
      }
    );
    addSwitch(
      advanced,
      "Merge overlapping ranges",
      "When two reads of the same file share lines, the older copy drops the repeated lines and keeps the rest. Used only when the newer read is recent enough to survive the size caps.",
      () => config.powers.context.mergeReadRanges,
      (value) => {
        config.powers.context.mergeReadRanges = value;
      }
    );
    addSwitch(
      advanced,
      "Edit receipts",
      "Older large write/edit/patch arguments become path, +N/-M, hash, and hunk count. The latest edit for each file stays intact, and the file on disk remains the source of truth.",
      () => config.powers.context.editReceipts,
      (value) => {
        config.powers.context.editReceipts = value;
      }
    );
    addSwitch(
      advanced,
      "Type-aware compactors",
      "Old test logs, stack traces, diffs, grep/glob lists, JSON/CSV, and web pages are reduced to their useful shape before the size caps run.",
      () => config.powers.context.smartCompaction,
      (value) => {
        config.powers.context.smartCompaction = value;
      }
    );
    addSwitch(
      advanced,
      "Code read skeletons",
      "Old source reads keep imports, signatures, and top-level declarations while eliding function bodies. Only applied to large reads of known code files. Off by default because collapsing bodies can break context.",
      () => config.powers.context.skeletonCodeReads,
      (value) => {
        config.powers.context.skeletonCodeReads = value;
      }
    );
    const advancedGrid = el2("div", "fb-grid2");
    advanced.append(advancedGrid);
    addSelect(
      advancedGrid,
      "Request budget",
      [
        { id: "0", label: "Off", hint: "size caps only" },
        { id: "8000", label: "8k tokens" },
        { id: "16000", label: "16k tokens" },
        { id: "24000", label: "24k tokens" },
        { id: "32000", label: "32k tokens" },
        { id: "48000", label: "48k tokens" },
        { id: "64000", label: "64k tokens" },
        { id: "96000", label: "96k tokens" },
        { id: "128000", label: "128k tokens" }
      ],
      () => String(config.powers.context.budgetTokens),
      (value) => {
        config.powers.context.budgetTokens = Number(value) || 0;
      }
    );
    addSwitch(
      advancedGrid,
      "Protect relevant context",
      "When a budget is set, keep files and symbols named in the latest user message and recent turns longer than unrelated old output.",
      () => config.powers.context.relevanceScoring,
      (value) => {
        config.powers.context.relevanceScoring = value;
      }
    );
    addNote(
      advanced,
      "Skill protection always covers SKILL.md, every file inside a skills/ or skill/ folder, and skill JSON manifests. Older copies may be pruned after a re-read, but at least one copy of a protected skill file stays whole. The budget is estimated with the measured tokens-per-character ratio when the panel can see it, otherwise four characters per token."
    );
    group(parent, "Focus brief");
    const brief = addText(
      parent,
      "Project focus",
      currentBrief(),
      (value) => setCurrentBrief(value),
      {
        multiline: true,
        rows: 4,
        helper: `Added as a system note on every request in this project. ${BRIEF_MAX} characters max.`,
        placeholder: "The thing this project is really about, and the rules that must not drift."
      }
    );
    handles["context-brief"] = brief;
    addNote(
      parent,
      "Pruning only changes what the model sees in the outgoing request. Your messages on disk are untouched."
    );
    const actions = addActions(parent);
    const compact = addButton(actions, "Compact context", "secondary", () => {
      void withBusy(compact, async () => {
        if (!hasSession()) {
          toast("info", "Open a chat first.");
          return;
        }
        if (!pluginIsLive()) {
          showBanner(
            "warning",
            "The Fox Box plugin is not reporting",
            "Restart OpenCode or enable Fox Box in Settings \u2192 Extensions. Without it, /foxbox-compact is not a command."
          );
          return;
        }
        try {
          const result = await host.prompt({ text: "/foxbox-compact", send: true });
          if (result.sent !== "sent") {
            toast("info", result.sent === "no-model" ? "Choose a model before compacting." : "Compaction was not requested.");
            return;
          }
          toast("success", "Compaction requested.");
        } catch (error) {
          if (errorCode(error) === "SESSION_BUSY") {
            toast("info", "The chat is busy; compact after this turn.");
            return;
          }
          notifyError(error, "Compacting");
        }
      });
    });
    addButton(actions, "Copy rules", "outline", () => {
      const lines = [
        `Context guard: ${config.powers.context.enabled ? "on" : "off"}`,
        `Skill shield: ${config.powers.context.protectSkills ? "on" : "off"}`,
        `Keep recent messages: ${config.powers.context.keepRecent}`,
        `Latest reads kept: ${config.powers.context.protectedReads || "off"}`,
        `Collapse repeats: ${config.powers.context.collapseDuplicates ? "on" : "off"}`,
        `Trim tool output: ${config.powers.context.trimToolOutput ? "on" : "off"}`,
        `Fresh tool cap: ${fmt(config.powers.context.maxToolOutput)} chars`,
        `Old tool budget: ${fmt(config.powers.context.maxOldToolOutput)} chars`,
        `Supersede older reads: ${config.powers.context.pathSupersession ? "on" : "off"}`,
        `Merge read overlaps: ${config.powers.context.mergeReadRanges ? "on" : "off"}`,
        `Stale reads: ${config.powers.context.staleReads ? "on" : "off"}`,
        `Edit receipts: ${config.powers.context.editReceipts ? "on" : "off"}`,
        `Type-aware compactors: ${config.powers.context.smartCompaction ? "on" : "off"}`,
        `Code read skeletons: ${config.powers.context.skeletonCodeReads ? "on" : "off"}`,
        `Request budget: ${config.powers.context.budgetTokens > 0 ? `${fmt(config.powers.context.budgetTokens)} tokens` : "off"}`,
        `Relevance protection: ${config.powers.context.relevanceScoring ? "on" : "off"}`,
        `Pinned paths: ${config.powers.context.protectPaths.trim() || "none"}`,
        `Focus brief: ${currentBrief().trim() || "empty"}`
      ];
      void copyText(lines.join("\n"));
    });
    const reload = addButton(actions, "Reload rules", "outline", () => {
      void withBusy(reload, async () => {
        await loadConfig();
        if (!configLoaded) {
          showBanner(
            "error",
            "Rules could not be loaded",
            "Fox Box is still using its in-memory rules. Fix or remove ~/.config/openchamber/fox-box/config.json, or approve its file access, then try again."
          );
          return;
        }
        activeTab = "context";
        buildShell();
        refreshAll();
        if (configNewer) {
          showBanner(
            "warning",
            "Rules need a newer Fox Box",
            "This config file was written by a newer Fox Box version. Update the extension before saving; changes stay in memory for now."
          );
          configSaveWarned = true;
          return;
        }
        toast("success", "Rules reloaded.");
      });
    });
  }
  function handoffConversationText() {
    const messages = handoffState.messages ?? [];
    const lines = [];
    let total = 0;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!message) continue;
      const line = `[${message.role}] ${(message.text ?? "").trim()}`;
      if (line.length <= 7) continue;
      if (line.length > CONVERSATION_MAX) {
        lines.unshift(capText(line, CONVERSATION_MAX));
        break;
      }
      if (total + line.length + 2 > CONVERSATION_MAX) break;
      lines.unshift(line);
      total += line.length + 2;
    }
    return lines.join("\n\n");
  }
  function buildHandoff(parent) {
    const capture = el2("div", "fb-capture");
    parent.append(capture);
    const refreshCapture = () => {
      const count = handoffState.messages?.length ?? 0;
      capture.replaceChildren();
      if (count > 0) {
        capture.append(el2("b", "", `${count} messages`), document.createTextNode(` captured from \u201C${handoffState.title || "this session"}\u201D.`));
        if (handoffState.truncated) {
          capture.append(document.createTextNode(" Older messages were dropped to fit the attach limit."));
        }
      } else {
        capture.append(document.createTextNode("Open this from a chat\u2019s \u22EF menu \u2192 "), el2("b", "", "Fox Box: build handoff"), document.createTextNode(" to capture the conversation."));
      }
    };
    refreshCapture();
    powerUpdaters["handoff"] = refreshCapture;
    const notes = addText(
      parent,
      "Notes to carry",
      handoffState.notes,
      (value) => {
        handoffState.notes = value.slice(0, 6e3);
        handoffState.result = "";
        clearPowerResult("handoff");
      },
      {
        multiline: true,
        rows: 3,
        helper: "Optional. This is added to the captured conversation when you distill.",
        placeholder: "What matters, what changed, what not to repeat\u2026"
      }
    );
    handles["handoff-notes"] = notes;
    const actions = addActions(parent);
    const distill = addButton(actions, "Distill passport", "default", () => {
      void withBusy(distill, async () => {
        const conversation = handoffConversationText();
        const notesText = handoffState.notes.trim();
        if (!conversation && !notesText) {
          toast("info", "Capture a conversation or write a note first.");
          return;
        }
        const system = [
          "You write compact context handoffs for a coding session.",
          "Return markdown with exactly these sections and no preamble:",
          "# Handoff",
          "## Goal",
          "## Current state",
          "## Decisions",
          "## Files and commands",
          "## Open threads",
          "## Next three moves",
          "## Do not",
          "Be concrete and terse. Keep only facts that change the next action. Mark guesses as guesses. Never invent file paths, commands, or results."
        ].join("\n");
        const prompt = [
          "Build a handoff passport from the material below. It must let a fresh session continue without the old chat history.",
          conversation ? `Conversation:
<conversation>
${conversation}
</conversation>` : "",
          notesText ? `Extra notes:
<notes>
${capText(notesText, 4e3)}
</notes>` : ""
        ].filter(Boolean).join("\n\n");
        const result = await generateText(distill, system, prompt, 2200);
        if (result) {
          handoffState.result = result;
          powerResults["handoff"] = true;
          setResult(result);
          refreshAll();
        }
      });
    });
    const { node: resultHost, set: setResult } = addResult(parent);
    setResult(handoffState.result);
    resultClearers["handoff"] = () => setResult("");
    const resultActions = addActions(parent);
    addButton(resultActions, "Start fresh chat", "secondary", () => {
      if (!handoffState.result) {
        toast("info", "Distill a passport first.");
        return;
      }
      void startFreshSession(
        `Handoff: ${handoffState.title || "continue"}`,
        `${handoffState.result}

Continue this work from the passport. Start by restating the goal and the first next move, then proceed.`
      );
    });
    addButton(resultActions, "Compose", "outline", () => void composeText(handoffState.result));
    addButton(resultActions, "Copy", "outline", () => void copyText(handoffState.result));
    addButton(resultActions, "Save to project", "outline", () => {
      if (!handoffState.result) {
        toast("info", "Distill a passport first.");
        return;
      }
      void (async () => {
        const path = `.foxbox/handoffs/${fileStamp()}-${slugify(handoffState.title || "handoff")}.md`;
        try {
          await host.writeFile(path, handoffState.result);
          toast("success", `Saved ${path}`);
        } catch (error) {
          notifyError(error, "Saving the handoff");
        }
      })();
    });
    const details = el2("details", "fb-details");
    details.append(
      el2("summary", "", "Why this is not memory"),
      el2(
        "div",
        "fb-note",
        "A passport is a one-time artifact you choose to carry. It is not stored in a background memory and nothing is recalled automatically."
      )
    );
    parent.append(details);
  }
  function buildSliceForge(parent) {
    const stackLine = el2("div", "fb-note", "Project scan: will run when you forge.");
    parent.append(stackLine);
    const topGrid = el2("div", "fb-grid2");
    parent.append(topGrid);
    addSelect(
      topGrid,
      "Slice type",
      [
        { id: "feature", label: "Feature", hint: "inside an existing project" },
        { id: "app", label: "App", hint: "new product" },
        { id: "game", label: "Game", hint: "playable loop" },
        { id: "tool", label: "Tool", hint: "utility or extension" }
      ],
      () => sliceState.mode,
      (value) => {
        sliceState.mode = value;
        sliceState.result = "";
        clearPowerResult("slice");
      },
      false
    );
    addSwitch(
      topGrid,
      "Small-model steps",
      "Three to five tiny, independently verifiable steps.",
      () => sliceState.small,
      (value) => {
        sliceState.small = value;
        sliceState.result = "";
        clearPowerResult("slice");
      },
      false
    );
    const goal = addText(
      parent,
      "What are we building?",
      sliceState.goal,
      (value) => {
        sliceState.goal = value.slice(0, 6e3);
        sliceState.result = "";
        clearPowerResult("slice");
      },
      {
        multiline: true,
        rows: 4,
        placeholder: "A vertical slice of\u2026 The one thing it must do is\u2026"
      }
    );
    handles["slice-goal"] = goal;
    const constraints = addText(
      parent,
      "Constraints",
      sliceState.constraints,
      (value) => {
        sliceState.constraints = value.slice(0, 3e3);
        sliceState.result = "";
        clearPowerResult("slice");
      },
      {
        multiline: true,
        rows: 2,
        helper: "Stack, time, scope, things not to touch, definition of done.",
        placeholder: "Keep the current save format. No new dependencies. One evening."
      }
    );
    handles["slice-constraints"] = constraints;
    addSwitch(
      parent,
      "Use project scan",
      "Include detected stack, scripts, and top-level shape in the prompt.",
      () => sliceState.scan,
      (value) => {
        sliceState.scan = value;
        sliceState.result = "";
        clearPowerResult("slice");
      },
      false
    );
    addSwitch(
      parent,
      "Low reasoning prompt",
      "Prepends the model chat template's own low-reasoning line to the system message. generate() has no reasoning_effort field, so this is how Fox Box asks for it; models without that template may ignore it.",
      () => sliceState.brief,
      (value) => {
        sliceState.brief = value;
        sliceState.result = "";
        clearPowerResult("slice");
      },
      false
    );
    const sections = [
      "# Slice",
      "## Outcome",
      "## Non-goals",
      "## Steps",
      "## Acceptance checks",
      "## Risks",
      "## First prompt"
    ];
    const briefReasoning = "Reasoning effort is set to low. Keep your thinking brief and focused, moving directly to the conclusion without unnecessary elaboration.";
    const system = [
      /* This is the model chat template's own low-reasoning system line, not a generic
         concision hint. generate() exposes no reasoning_effort field, so it is the only
         way to request low effort; a model without that template may ignore it. */
      sliceState.brief ? briefReasoning : "",
      "You are a senior product engineer and game designer.",
      "Turn a goal into one vertical slice that a small coding model can execute.",
      "Return markdown only, with these sections:",
      ...sections,
      "Each step must name concrete files or areas, one deliverable, and a verification. Keep steps small. Do not pad. If something is unknown, put it under Risks instead of inventing it."
    ].filter(Boolean).join("\n");
    const promptFor = (stack) => [
      `Slice type: ${sliceState.mode}`,
      `Goal: ${sliceState.goal}`,
      sliceState.constraints.trim() ? `Constraints: ${sliceState.constraints}` : "",
      stack ? `Project scan:
${stack}` : "",
      sliceState.small ? "Use 3 to 5 steps. Each step should fit in one short work session. The first step must be the smallest end-to-end proof." : "Use as many steps as the work needs, but keep each independently verifiable."
    ].filter(Boolean).join("\n\n");
    const gatherScan = async () => {
      if (!sliceState.scan) return "";
      try {
        const info = await detectProject();
        stackLine.textContent = `Project scan: ${info.label}${info.isGame ? " \xB7 game project" : ""}.`;
        return info.summary;
      } catch {
        stackLine.textContent = "Project scan: unavailable; forging without it.";
        return "";
      }
    };
    const actions = addActions(parent);
    let filling = false;
    const fill = addButton(actions, "Fill blanks", "outline", () => {
      if (filling) return;
      filling = true;
      void (async () => {
        if (!sliceState.goal.trim() && !sliceState.constraints.trim() && !sliceState.scan) {
          toast("info", "Add a goal or constraint first, or turn on project scan.");
          return;
        }
        if (sliceState.goal.trim() && sliceState.constraints.trim()) {
          toast("info", "Nothing to fill in the slice brief.");
          return;
        }
        const stack = await gatherScan();
        const context = [
          `Slice type: ${sliceState.mode}`,
          sliceState.small ? "Keep the slice to 3 to 5 small steps." : "Use as many steps as the work needs.",
          stack ? `Project scan:
${stack}` : ""
        ].filter(Boolean).join("\n\n");
        await fillMissingFields(
          fill,
          {
            noun: "slice brief",
            system: [
              "You fill a short slice brief for a coding assistant.",
              "Write one concrete, testable goal and practical constraints: stack, scope, time, things not to touch, definition of done.",
              "Do not plan the whole project. Do not invent file paths or commands; keep names generic when unknown."
            ].join("\n"),
            context,
            maxOutputTokens: 1e3,
            fields: [
              {
                key: "goal",
                label: "Goal",
                value: sliceState.goal,
                max: 900,
                hint: "one vertical slice with a visible result"
              },
              {
                key: "constraints",
                label: "Constraints",
                value: sliceState.constraints,
                max: 700,
                hint: "stack, time, scope, things not to touch, definition of done"
              }
            ]
          },
          (values) => {
            let applied = 0;
            if (values.goal !== void 0 && !sliceState.goal.trim()) {
              sliceState.goal = values.goal;
              handles["slice-goal"]?.update({ value: values.goal });
              applied += 1;
            }
            if (values.constraints !== void 0 && !sliceState.constraints.trim()) {
              sliceState.constraints = values.constraints;
              handles["slice-constraints"]?.update({ value: values.constraints });
              applied += 1;
            }
            if (applied === 0) {
              toast("info", "The empty fields were filled while the answer was running; nothing was overwritten.");
              return false;
            }
            sliceState.result = "";
            clearPowerResult("slice");
            refreshAll();
            return applied;
          }
        );
      })().finally(() => {
        filling = false;
      });
    });
    const forge = addButton(actions, "Forge slice", "default", () => {
      void withBusy(forge, async () => {
        if (!sliceState.goal.trim()) {
          toast("info", "Describe the slice first.");
          return;
        }
        const stack = await gatherScan();
        try {
          const answer = await host.generate({
            system: capText(system, 8e3),
            prompt: capText(promptFor(stack), 6e4),
            maxOutputTokens: 2400
          });
          const result = answer.text.trim();
          if (!result) {
            showBanner(
              "warning",
              "The Small Model returned no slice",
              "It may have spent its whole output budget on reasoning. Try Forge in chat, or shorten the goal and constraints."
            );
            return;
          }
          sliceState.result = result;
          powerResults["slice"] = true;
          setResult(result);
          refreshAll();
        } catch (error) {
          const code = errorCode(error);
          showBanner(
            "error",
            "Slice Forge could not finish",
            `${describeError(error)} Use Forge in chat to hand this same brief to the chat agent${code ? ` (${code})` : ""}.`
          );
          toast("error", "Forge failed \u2014 try Forge in chat.");
        }
      });
    });
    const forgeChat = addButton(actions, "Forge in chat", "secondary", () => {
      void withBusy(forgeChat, async () => {
        if (!sliceState.goal.trim()) {
          toast("info", "Describe the slice first.");
          return;
        }
        const stack = await gatherScan();
        const text = [
          "Plan one vertical slice for this project. Do not edit files, do not start implementing, and do not run commands that change anything. Read only what you need to name real files.",
          "Brief:",
          promptFor(stack),
          "Return markdown only, with exactly these sections:",
          ...sections,
          "Each step must name concrete files or areas, one deliverable, and a verification. Keep steps small. If something is unknown, put it under Risks instead of inventing it. Stop after the plan."
        ].join("\n\n");
        if (hasSession()) {
          await sendToSession(text, "Slice brief sent to the chat.");
        } else {
          await startFreshSession(`Slice: ${slugify(sliceState.goal).replace(/-/g, " ")}`, text);
        }
      });
    });
    addNote(
      parent,
      "Forge slice uses the Small Model and waits for one complete answer. Forge in chat hands the same brief to the chat agent, which streams, can read the repo, and is not bound by the panel's one-shot generation call. Fill blanks is a separate Small Model call: it only writes empty goal or constraint fields and is never run by Forge in chat or Send to agent."
    );
    const { node: resultHost, set: setResult } = addResult(parent);
    setResult(sliceState.result);
    resultClearers["slice"] = () => setResult("");
    const resultActions = addActions(parent);
    addButton(resultActions, "Send to agent", "secondary", () => {
      if (!sliceState.result) {
        toast("info", "Forge a slice first.");
        return;
      }
      void sendToSession(
        `Execute this slice. Start with step 1 only. Inspect the files named before editing, then report the verification result.

${sliceState.result}`,
        "Slice sent to the agent."
      );
    });
    addButton(resultActions, "Compose", "outline", () => void composeText(sliceState.result));
    addButton(resultActions, "Copy", "outline", () => void copyText(sliceState.result));
    addButton(resultActions, "New chat", "outline", () => {
      if (!sliceState.result) {
        toast("info", "Forge a slice first.");
        return;
      }
      void startFreshSession(`Slice: ${slugify(sliceState.goal).replace(/-/g, " ")}`, sliceState.result);
    });
    addButton(resultActions, "Save plan", "outline", () => {
      if (!sliceState.result) {
        toast("info", "Forge a slice first.");
        return;
      }
      void (async () => {
        const path = `.foxbox/plans/${fileStamp()}-${slugify(sliceState.goal || sliceState.mode)}.md`;
        try {
          await host.writeFile(path, sliceState.result);
          toast("success", `Saved ${path}`);
        } catch (error) {
          notifyError(error, "Saving the plan");
        }
      })();
    });
    powerUpdaters["slice"] = () => {
      if (projectScan) {
        stackLine.textContent = `Project scan: ${projectScan.label}${projectScan.isGame ? " \xB7 game project" : ""}.`;
      }
    };
  }
  function buildBugHunter(parent) {
    const capture = el2("div", "fb-capture");
    parent.append(capture);
    const refreshCapture = () => {
      capture.replaceChildren();
      if (bugState.symptom.trim()) {
        capture.append(el2("b", "", "Symptom captured."), document.createTextNode(" Review it below, add where it happens, then hunt."));
      } else {
        capture.append(document.createTextNode("Select an error in chat \u2192 "), el2("b", "", "Fox Box: hunt this bug"), document.createTextNode(", or paste the symptom below."));
      }
    };
    refreshCapture();
    powerUpdaters["bug"] = refreshCapture;
    const symptom = addText(
      parent,
      "Symptom, error, or stack trace",
      bugState.symptom,
      (value) => {
        bugState.symptom = value.slice(0, 8e3);
        bugState.result = "";
        clearPowerResult("bug");
      },
      {
        multiline: true,
        rows: 5,
        placeholder: "What happens, what should happen, the exact error\u2026"
      }
    );
    handles["bug-symptom"] = symptom;
    const grid = el2("div", "fb-grid2");
    parent.append(grid);
    addText(
      grid,
      "Where it happens",
      bugState.where,
      (value) => {
        bugState.where = value.slice(0, 500);
        bugState.result = "";
        clearPowerResult("bug");
      },
      { placeholder: "src/parser.ts:118, save/load, multiplayer\u2026" }
    );
    addText(
      grid,
      "What changed",
      bugState.changed,
      (value) => {
        bugState.changed = value.slice(0, 1200);
        bugState.result = "";
        clearPowerResult("bug");
      },
      { placeholder: "Last feature, dependency bump, content change\u2026" }
    );
    addSelect(
      parent,
      "Hunt focus",
      [
        { id: "full", label: "Full hunt", hint: "repro, cause, fix, guard" },
        { id: "repro", label: "Reproduce first" },
        { id: "cause", label: "Root cause" },
        { id: "fix", label: "Fix plan" },
        { id: "guard", label: "Regression guard" }
      ],
      () => bugState.focus,
      (value) => {
        bugState.focus = value;
        bugState.result = "";
        clearPowerResult("bug");
      },
      false
    );
    addSwitch(
      parent,
      "Read the referenced file",
      "If \u201Cwhere\u201D names a file, include a capped excerpt in the prompt.",
      () => bugState.includeFile,
      (value) => {
        bugState.includeFile = value;
        bugState.result = "";
        clearPowerResult("bug");
      },
      false
    );
    const actions = addActions(parent);
    const hunt = addButton(actions, "Hunt this bug", "default", () => {
      void withBusy(hunt, async () => {
        if (!bugState.symptom.trim()) {
          toast("info", "Add the symptom or error first.");
          return;
        }
        let fileText = "";
        if (bugState.includeFile && bugState.where.trim()) {
          const match = /([A-Za-z0-9_./\\-]+\.[A-Za-z0-9]+)(?::\d+)?/.exec(bugState.where);
          if (match?.[1]) {
            const path = match[1].replace(/^[.][/\\]/, "").replace(/\\/g, "/");
            const content = await readOptional(path);
            if (content) fileText = `
File excerpt (${path}):
${capText(content, 12e3)}`;
          }
        }
        const system = [
          "You are a debugging lead. Be concrete and honest about uncertainty.",
          "Return markdown with these sections:",
          "# Hunt",
          "## Read of the symptom",
          "## Ranked causes",
          "## Minimal repro",
          "## Instrumentation",
          "## Fix options",
          "## Verification",
          "## Regression guard",
          "Rank at most three causes with confidence. Do not invent logs or claim a fix was tested. Give one next command or check."
        ].join("\n");
        const prompt = [
          `Focus: ${bugState.focus}`,
          `Symptom:
${bugState.symptom}`,
          bugState.where.trim() ? `Where: ${bugState.where}` : "",
          bugState.changed.trim() ? `Recent change: ${bugState.changed}` : "",
          fileText
        ].filter(Boolean).join("\n\n");
        const result = await generateText(hunt, system, prompt, 2200);
        if (result) {
          bugState.result = result;
          powerResults["bug"] = true;
          setResult(result);
          refreshAll();
        }
      });
    });
    const { node: resultHost, set: setResult } = addResult(parent);
    setResult(bugState.result);
    resultClearers["bug"] = () => setResult("");
    const resultActions = addActions(parent);
    addButton(resultActions, "Send to agent", "secondary", () => {
      if (!bugState.result) {
        toast("info", "Hunt the bug first.");
        return;
      }
      void sendToSession(
        `Work this bug from the hunt below. Reproduce it before changing code. After the fix, run the verification and add the regression guard.

${bugState.result}`,
        "Hunt sent to the agent."
      );
    });
    addButton(resultActions, "Compose", "outline", () => void composeText(bugState.result));
    addButton(resultActions, "Copy", "outline", () => void copyText(bugState.result));
  }
  async function loadRedPenFile(path, range) {
    const content = await readOptional(path);
    if (content === null) {
      throw new Error(`Could not read ${path}.`);
    }
    if (range) {
      const lines = content.split(/\r?\n/);
      const start = Math.max(1, Math.min(lines.length, range.start));
      const end = Math.max(start, Math.min(lines.length, range.end));
      const slice = lines.slice(start - 1, end).map((line, index) => `${String(start + index).padStart(4, " ")} | ${line}`).join("\n");
      redState.code = capText(slice, 2e4);
      redState.range = `${start}\u2013${end}`;
      redState.label = `${path} \xB7 lines ${start}\u2013${end}`;
    } else {
      redState.code = capText(content, 2e4);
      redState.range = "";
      redState.label = path;
    }
    redState.path = path;
    redState.result = "";
    clearPowerResult("red-pen");
    handles["red-code"]?.update({ value: redState.code });
    handles["red-capture"]?.update({ value: redState.label });
    refreshAll();
  }
  function buildRedPen(parent) {
    const capture = el2("div", "fb-capture");
    parent.append(capture);
    const refreshCapture = () => {
      capture.replaceChildren();
      if (redState.label) {
        capture.append(el2("b", "", redState.label), document.createTextNode(redState.range ? ` \xB7 ${redState.code.length.toLocaleString()} chars` : ""));
      } else if (redState.code.trim()) {
        capture.append(el2("b", "", "Pasted code ready."), document.createTextNode(" Choose a focus and review."));
      } else {
        capture.append(document.createTextNode("Select code, a file, or diff lines \u2192 "), el2("b", "", "Fox Box: red-pen"), document.createTextNode(", or paste code below."));
      }
    };
    refreshCapture();
    powerUpdaters["red-pen"] = refreshCapture;
    const note = addText(
      parent,
      "Captured source",
      redState.label,
      (value) => {
        redState.label = value.slice(0, 300);
      },
      { helper: "A path label for the review. The code below is what gets scanned.", placeholder: "src/foo.ts \xB7 lines 20\u201360" }
    );
    handles["red-capture"] = note;
    const code = addText(
      parent,
      "Code or diff",
      redState.code,
      (value) => {
        redState.code = value.slice(0, 2e4);
        redState.result = "";
        clearPowerResult("red-pen");
      },
      {
        multiline: true,
        rows: 7,
        mono: true,
        placeholder: "Paste the code, diff, or selection here\u2026"
      }
    );
    handles["red-code"] = code;
    group(parent, "Look for");
    const focusGrid = el2("div", "fb-switchgrid");
    parent.append(focusGrid);
    const focusItems = [
      ["correctness", "Correctness"],
      ["edge", "Edge cases"],
      ["security", "Security"],
      ["performance", "Performance"],
      ["tests", "Missing tests"],
      ["readability", "Readability"]
    ];
    for (const [id, label] of focusItems) {
      addCheckbox(
        focusGrid,
        label,
        void 0,
        () => redState.focus.has(id),
        (checked) => {
          if (checked) redState.focus.add(id);
          else redState.focus.delete(id);
          redState.result = "";
          clearPowerResult("red-pen");
        }
      );
    }
    const extra = addText(
      parent,
      "Extra instruction",
      redState.extra,
      (value) => {
        redState.extra = value.slice(0, 1200);
        redState.result = "";
        clearPowerResult("red-pen");
      },
      { placeholder: "Assume this runs on the hot path. Ignore formatting." }
    );
    handles["red-extra"] = extra;
    const actions = addActions(parent);
    const agentReview = addButton(actions, "Review with agent", "default", () => {
      if (!redState.code.trim()) {
        toast("info", "Add code or capture a selection first.");
        return;
      }
      const focus = Array.from(redState.focus).join(", ") || "correctness";
      const source = redState.label.trim() ? `Source: ${redState.label}
` : "";
      void sendToSession(
        `Red-pen this code. Focus on: ${focus}.${redState.extra.trim() ? ` Extra instruction: ${redState.extra.trim()}` : ""}
${source}
Review the code below. Report findings ordered by severity with line references, why it matters, and a concrete fix. Do not rewrite the whole file unless asked.

\`\`\`
${capText(redState.code, 12e3)}
\`\`\``,
        "Review sent to the agent."
      );
    });
    const quick = addButton(actions, "Quick scan", "secondary", () => {
      if (!redState.code.trim()) {
        toast("info", "Add code or capture a selection first.");
        return;
      }
      void withBusy(quick, async () => {
        const focus = Array.from(redState.focus).join(", ") || "correctness";
        const system = [
          "You are a meticulous code reviewer.",
          "Return markdown with findings only, ordered by severity. Each finding: location, what is wrong, why it matters, and a concrete fix.",
          "If there is no real defect in a category, say nothing about it. Do not praise. Do not rewrite the whole file."
        ].join("\n");
        const prompt = [
          `Focus: ${focus}`,
          redState.label ? `Source: ${redState.label}` : "",
          redState.extra.trim() ? `Extra instruction: ${redState.extra}` : "",
          `Code:
\`\`\`
${redState.code}
\`\`\``
        ].filter(Boolean).join("\n\n");
        const result = await generateText(quick, system, prompt, 1600);
        if (result) {
          redState.result = result;
          powerResults["red-pen"] = true;
          setResult(result);
          refreshAll();
        }
      });
    });
    const { node: resultHost, set: setResult } = addResult(parent);
    setResult(redState.result);
    resultClearers["red-pen"] = () => setResult("");
    const resultActions = addActions(parent);
    addButton(resultActions, "Send findings", "secondary", () => {
      if (!redState.result) {
        toast("info", "Run a quick scan first.");
        return;
      }
      void sendToSession(
        `Fix the issues in this review. Work highest severity first, and add or update tests for each behavioral fix.

${redState.result}`,
        "Findings sent to the agent."
      );
    });
    addButton(resultActions, "Compose", "outline", () => void composeText(redState.result));
    addButton(resultActions, "Copy", "outline", () => void copyText(redState.result));
  }
  function buildGameFeel(parent) {
    const stackLine = el2("div", "fb-note", "No game stack detected yet.");
    parent.append(stackLine);
    let scanKey = "";
    let scanSeq = 0;
    const refreshStack = () => {
      const key = normalizeDir(ready?.directory);
      if (key === scanKey) return;
      const seq = ++scanSeq;
      void detectProject().then((info) => {
        if (seq !== scanSeq) return;
        scanKey = key;
        stackLine.textContent = info.isGame ? `Game project detected: ${info.label}.` : `Project: ${info.label}. This works for design-only passes too.`;
      }).catch(() => {
        if (seq !== scanSeq) return;
        scanKey = key;
        stackLine.textContent = "Project scan unavailable; the lab still works from your notes.";
      });
    };
    refreshStack();
    powerUpdaters["game"] = refreshStack;
    const top = el2("div", "fb-grid2");
    parent.append(top);
    addSelect(
      top,
      "Genre",
      [
        { id: "platformer", label: "Platformer" },
        { id: "shooter", label: "Shooter" },
        { id: "rpg", label: "RPG" },
        { id: "roguelike", label: "Roguelike" },
        { id: "puzzle", label: "Puzzle" },
        { id: "sim", label: "Sim / management" },
        { id: "other", label: "Other" }
      ],
      () => gameState.genre,
      (value) => {
        gameState.genre = value;
        gameState.result = "";
        clearPowerResult("game");
      },
      false
    );
    addSelect(
      top,
      "Engine",
      [
        { id: "bevy", label: "Bevy" },
        { id: "macroquad", label: "Macroquad" },
        { id: "godot", label: "Godot" },
        { id: "unity", label: "Unity" },
        { id: "unreal", label: "Unreal" },
        { id: "web", label: "Web / canvas" },
        { id: "other", label: "Other" }
      ],
      () => gameState.engine,
      (value) => {
        gameState.engine = value;
        gameState.result = "";
        clearPowerResult("game");
      },
      false
    );
    addSelect(
      parent,
      "Workbench",
      [
        { id: "juice", label: "Juice pass", hint: "feedback on every event" },
        { id: "tuning", label: "Tuning matrix", hint: "numbers to feel" },
        { id: "playtest", label: "Playtest kit", hint: "questions and experiments" }
      ],
      () => gameState.workbench,
      (value) => {
        gameState.workbench = value;
        gameState.result = "";
        clearPowerResult("game");
      },
      false
    );
    const loop = addText(
      parent,
      "Core loop",
      gameState.loop,
      (value) => {
        gameState.loop = value.slice(0, 1500);
        gameState.result = "";
        clearPowerResult("game");
      },
      { multiline: true, rows: 2, placeholder: "Run, jump, collect, return, spend\u2026" }
    );
    handles["game-loop"] = loop;
    const feel = addText(
      parent,
      "Target feel",
      gameState.feel,
      (value) => {
        gameState.feel = value.slice(0, 1200);
        gameState.result = "";
        clearPowerResult("game");
      },
      { multiline: true, rows: 2, placeholder: "Crunchy, weighty, floaty, tense, toy-like\u2026" }
    );
    handles["game-feel"] = feel;
    const mechanic = addText(
      parent,
      "Mechanic under the knife",
      gameState.mechanic,
      (value) => {
        gameState.mechanic = value.slice(0, 1600);
        gameState.result = "";
        clearPowerResult("game");
      },
      { multiline: true, rows: 2, placeholder: "The jump, the hit, the pickup, the boss phase\u2026" }
    );
    handles["game-mechanic"] = mechanic;
    const actions = addActions(parent);
    const fill = addButton(actions, "Fill blanks", "outline", () => {
      void fillMissingFields(
        fill,
        {
          noun: "game-feel brief",
          system: [
            "You fill a game-feel design brief.",
            "Name concrete motion, sound, camera, and timing choices. Avoid generic 'add juice' advice. Keep each field useful to a small implementation pass."
          ].join("\n"),
          context: [
            `Genre: ${gameState.genre}`,
            `Engine: ${gameState.engine}`,
            `Workbench: ${gameState.workbench}`
          ].join("\n"),
          maxOutputTokens: 900,
          fields: [
            {
              key: "loop",
              label: "Core loop",
              value: gameState.loop,
              max: 700,
              hint: "the repeatable player action and reward"
            },
            {
              key: "feel",
              label: "Target feel",
              value: gameState.feel,
              max: 500,
              hint: "crunchy, weighty, floaty, tense, toy-like"
            },
            {
              key: "mechanic",
              label: "Mechanic under the knife",
              value: gameState.mechanic,
              max: 700,
              hint: "the jump, hit, pickup, boss phase, or other event to tune"
            }
          ]
        },
        (values) => {
          let applied = 0;
          if (values.loop !== void 0 && !gameState.loop.trim()) {
            gameState.loop = values.loop.slice(0, 1500);
            handles["game-loop"]?.update({ value: gameState.loop });
            applied += 1;
          }
          if (values.feel !== void 0 && !gameState.feel.trim()) {
            gameState.feel = values.feel.slice(0, 1200);
            handles["game-feel"]?.update({ value: gameState.feel });
            applied += 1;
          }
          if (values.mechanic !== void 0 && !gameState.mechanic.trim()) {
            gameState.mechanic = values.mechanic.slice(0, 1600);
            handles["game-mechanic"]?.update({ value: gameState.mechanic });
            applied += 1;
          }
          if (applied === 0) {
            toast("info", "The empty fields were filled while the answer was running; nothing was overwritten.");
            return false;
          }
          gameState.result = "";
          clearPowerResult("game");
          return applied;
        }
      );
    });
    const design = addButton(actions, "Design the pass", "default", () => {
      void withBusy(design, async () => {
        const system = [
          "You are a gameplay feel designer who ships.",
          "Return a concrete, testable markdown document. Use numbers and timings. Name the channel and the event. Never say 'add juice' without saying what changes on screen, in the ear, or in the hand.",
          "Keep the whole answer under 700 words."
        ].join("\n");
        const workbench = gameState.workbench;
        const sections = workbench === "juice" ? [
          "# Juice pass",
          "## Feel target",
          "## Feedback table",
          "| Event | Motion | Particles | Sound | Camera | Timing |",
          "## Implementation notes",
          "## Playtest checks"
        ] : workbench === "tuning" ? [
          "# Tuning matrix",
          "## Feel target",
          "## Variables",
          "| Variable | Start | Range | What to watch |",
          "## Couplings",
          "## Experiment order"
        ] : [
          "# Playtest kit",
          "## What this build is testing",
          "## Questions to ask",
          "## What to watch in the body",
          "## Five experiments",
          "## Kill criteria"
        ];
        const prompt = [
          `Workbench: ${workbench}`,
          `Genre: ${gameState.genre}`,
          `Engine: ${gameState.engine}`,
          `Core loop: ${gameState.loop || "(not given)"}`,
          `Target feel: ${gameState.feel || "(not given)"}`,
          `Mechanic: ${gameState.mechanic || "(not given)"}`,
          `Use these sections:
${sections.join("\n")}`
        ].join("\n");
        const result = await generateText(design, system, prompt, 2200);
        if (result) {
          gameState.result = result;
          powerResults["game"] = true;
          setResult(result);
          refreshAll();
        }
      });
    });
    addNote(parent, "Fill blanks asks the Small Model for only the empty design fields. It is separate from the Send to agent action below.");
    const { node: resultHost, set: setResult } = addResult(parent);
    setResult(gameState.result);
    resultClearers["game"] = () => setResult("");
    const resultActions = addActions(parent);
    addButton(resultActions, "Send to agent", "secondary", () => {
      if (!gameState.result) {
        toast("info", "Design a pass first.");
        return;
      }
      void sendToSession(
        `Implement one slice of this game-feel pass. Start with the highest-impact row only, make the change, then tell me what to feel for.

${gameState.result}`,
        "Game feel pass sent to the agent."
      );
    });
    addButton(resultActions, "Compose", "outline", () => void composeText(gameState.result));
    addButton(resultActions, "Copy", "outline", () => void copyText(gameState.result));
  }
  function blankCharacter() {
    return {
      id: uid(),
      name: "",
      role: "",
      pronouns: "",
      era: "",
      look: "",
      want: "",
      need: "",
      wound: "",
      contradiction: "",
      secret: "",
      arc: "",
      rhythm: "",
      vocabulary: "",
      tics: "",
      taboo: "",
      relationships: "",
      updatedAt: Date.now()
    };
  }
  function selectedCharacter() {
    return characters.find((character) => character.id === selectedCharacterId) ?? null;
  }
  function ensureCharacter() {
    const existing = selectedCharacter();
    if (existing) return existing;
    const created = characters[0] ?? blankCharacter();
    if (!characters.length) {
      characters.push(created);
      markCharactersChanged();
    }
    selectedCharacterId = created.id;
    return created;
  }
  var charactersSaving = false;
  var charactersSavePending = false;
  var charactersTouched = false;
  var charactersVersion = 0;
  var charactersLoaded = false;
  var charactersSaveWarned = false;
  var charactersSaveChain = Promise.resolve();
  var retainedCharacterIds = /* @__PURE__ */ new Set();
  function characterIndexIds(snapshot) {
    const ids = snapshot.map((character) => character.id);
    for (const id of retainedCharacterIds) {
      if (!ids.includes(id) && ids.length < 40) ids.push(id);
    }
    return ids.slice(0, 40);
  }
  async function runCharactersSave() {
    do {
      charactersSavePending = false;
      const version = charactersVersion;
      const snapshot = characters.slice(0, 40).map((character) => ({ ...character }));
      let ok = false;
      const nextCache = /* @__PURE__ */ new Map();
      const writes = [];
      for (const character of snapshot) {
        const serialized = JSON.stringify(character);
        nextCache.set(character.id, serialized);
        retainedCharacterIds.delete(character.id);
        if (characterCache.get(character.id) !== serialized) {
          writes.push(host.storage.set(characterKey(character.id), JSON.parse(serialized)));
        }
      }
      try {
        await Promise.all(writes);
        await host.storage.set(CHARACTER_INDEX_KEY, characterIndexIds(snapshot));
        characterCache.clear();
        for (const [id, serialized] of nextCache) characterCache.set(id, serialized);
        ok = true;
      } catch {
        toast("error", "Could not save characters.");
      }
      if (!ok) return;
      if (charactersVersion === version && !charactersSavePending) {
        charactersTouched = false;
        return;
      }
    } while (charactersLoaded);
  }
  function saveCharactersNow() {
    if (!charactersLoaded) {
      if (!charactersSaveWarned) {
        charactersSaveWarned = true;
        toast("error", "Saved characters could not be read, so Fox Box will not overwrite them. Reopen the panel.");
      }
      return charactersSaveChain;
    }
    if (charactersSaving) {
      charactersSavePending = true;
      return charactersSaveChain;
    }
    charactersSaving = true;
    charactersSaveChain = runCharactersSave().finally(() => {
      charactersSaving = false;
    });
    return charactersSaveChain;
  }
  var persistCharacters = debounce(saveCharactersNow, 450);
  function markCharactersChanged() {
    charactersTouched = true;
    charactersVersion += 1;
    persistCharacters();
  }
  function characterCard(character) {
    const name = character.name.trim() || "Unnamed";
    const lines = [`# ${name}`];
    if (character.role.trim()) lines.push(`**Role** ${character.role.trim()}`);
    if (character.pronouns.trim()) lines.push(`**Pronouns** ${character.pronouns.trim()}`);
    if (character.era.trim()) lines.push(`**Era** ${character.era.trim()}`);
    if (character.look.trim()) lines.push(`**Look** ${character.look.trim()}`);
    if (character.want.trim()) lines.push(`**Wants** ${character.want.trim()}`);
    if (character.need.trim()) lines.push(`**Needs** ${character.need.trim()}`);
    if (character.wound.trim()) lines.push(`**Wound** ${character.wound.trim()}`);
    if (character.contradiction.trim()) lines.push(`**Contradiction** ${character.contradiction.trim()}`);
    if (character.secret.trim()) lines.push(`**Secret** ${character.secret.trim()}`);
    const voice = [
      character.rhythm.trim() && `rhythm: ${character.rhythm.trim()}`,
      character.vocabulary.trim() && `vocabulary: ${character.vocabulary.trim()}`,
      character.tics.trim() && `tics: ${character.tics.trim()}`,
      character.taboo.trim() && `avoids: ${character.taboo.trim()}`
    ].filter(Boolean);
    if (voice.length) lines.push(`**Voice** ${voice.join("; ")}`);
    if (character.relationships.trim()) lines.push(`**Relationships** ${character.relationships.trim()}`);
    if (character.arc.trim()) lines.push(`**Arc** ${character.arc.trim()}`);
    return lines.join("\n");
  }
  function buildCharacterForge(parent) {
    ensureCharacter();
    const top = el2("div", "fb-actions");
    parent.append(top);
    const selectHost = el2("div", "fb-actions-grow");
    top.append(selectHost);
    let selectHandle = null;
    let nameRenderTimer;
    let resetDelete = () => {
    };
    let clearResult = () => {
    };
    const fieldHandles = /* @__PURE__ */ new Map();
    const syncFields = () => {
      const character = ensureCharacter();
      for (const [key, handle] of fieldHandles) {
        handle.update({ value: String(character[key] ?? "") });
      }
      refreshAll();
    };
    const renderSelect = () => {
      const options = characters.map((character) => ({
        id: character.id,
        label: character.name.trim() || "Unnamed character"
      }));
      if (selectHandle) {
        selectHandle.dispose();
      }
      selectHandle = mountSelect(selectHost, {
        value: selectedCharacterId,
        options,
        placeholder: "No characters yet",
        onChange: (id) => {
          selectedCharacterId = id;
          selectHandle?.update({ value: id });
          charState.result = "";
          clearResult();
          resetDelete();
          syncFields();
        }
      });
    };
    renderSelect();
    addButton(top, "New", "outline", () => {
      const created = blankCharacter();
      characters.unshift(created);
      characters = characters.slice(0, 40);
      selectedCharacterId = created.id;
      charState.result = "";
      clearResult();
      resetDelete();
      markCharactersChanged();
      renderSelect();
      syncFields();
      refreshAll();
    });
    const menuHost = el2("span");
    top.append(menuHost);
    let deleteButton = null;
    let deleteArmed = false;
    let deleteTimer;
    resetDelete = () => {
      deleteArmed = false;
      if (deleteTimer !== void 0) {
        window.clearTimeout(deleteTimer);
        deleteTimer = void 0;
      }
      deleteButton?.update({ label: "Delete", variant: "ghost" });
    };
    deleteButton = mountButton(menuHost, {
      label: "Delete",
      variant: "ghost",
      size: "sm",
      onClick: () => {
        const character = selectedCharacter();
        if (!character) return;
        if (!deleteArmed) {
          deleteArmed = true;
          deleteButton?.update({ label: "Confirm delete", variant: "destructive" });
          deleteTimer = window.setTimeout(resetDelete, 3e3);
          return;
        }
        const removedId = character.id;
        const index = characters.findIndex((item) => item.id === removedId);
        if (index >= 0) characters.splice(index, 1);
        selectedCharacterId = characters[0]?.id ?? null;
        ensureCharacter();
        charState.result = "";
        clearResult();
        characterCache.delete(removedId);
        retainedCharacterIds.delete(removedId);
        markCharactersChanged();
        void host.storage.delete(characterKey(removedId)).catch(() => {
        });
        resetDelete();
        renderSelect();
        syncFields();
        refreshAll();
        toast("info", "Character removed.");
      }
    });
    const fields = [
      { key: "name", label: "Name" },
      { key: "role", label: "Role" },
      { key: "pronouns", label: "Pronouns" },
      { key: "era", label: "Age / era" },
      { key: "look", label: "Look", multiline: true, rows: 2, helper: "Two or three concrete details, not a catalogue." },
      { key: "want", label: "Want", multiline: true, rows: 2, helper: "What they chase on the page." },
      { key: "need", label: "Need", multiline: true, rows: 2, helper: "What would actually make them whole." },
      { key: "wound", label: "Wound", multiline: true, rows: 2 },
      { key: "contradiction", label: "Contradiction", multiline: true, rows: 2, helper: "The thing that makes them feel alive." },
      { key: "secret", label: "Secret", multiline: true, rows: 2 },
      { key: "arc", label: "Arc", multiline: true, rows: 2 },
      { key: "rhythm", label: "Speech rhythm", helper: "Long clauses? Fragments? Interrupts?" },
      { key: "vocabulary", label: "Vocabulary", helper: "Concrete nouns, jargon, register." },
      { key: "tics", label: "Verbal tics", helper: "Repeated moves, not catchphrase soup." },
      { key: "taboo", label: "Words they avoid" },
      { key: "relationships", label: "Relationships", multiline: true, rows: 2 }
    ];
    const identity = group(parent, "Identity");
    const identityGrid = el2("div", "fb-grid2");
    identity.append(identityGrid);
    const engine = group(parent, "Engine");
    const engineGrid = el2("div", "fb-grid2");
    engine.append(engineGrid);
    const voice = group(parent, "Voice and ties");
    const voiceGrid = el2("div", "fb-grid2");
    voice.append(voiceGrid);
    const destinationFor = (key) => {
      if (["name", "role", "pronouns", "era", "look"].includes(key)) return identityGrid;
      if (["want", "need", "wound", "contradiction", "secret", "arc"].includes(key)) return engineGrid;
      return voiceGrid;
    };
    for (const field2 of fields) {
      const parentNode = destinationFor(field2.key);
      const handle = addText(
        parentNode,
        field2.label,
        String(selectedCharacter()?.[field2.key] ?? ""),
        (value) => {
          const character = selectedCharacter();
          if (!character) return;
          character[field2.key] = value.slice(0, field2.key === "look" || field2.key === "relationships" ? 1200 : 600);
          character.updatedAt = Date.now();
          charState.result = "";
          clearResult();
          markCharactersChanged();
          if (field2.key === "name") {
            if (nameRenderTimer !== void 0) window.clearTimeout(nameRenderTimer);
            nameRenderTimer = window.setTimeout(() => {
              nameRenderTimer = void 0;
              renderSelect();
              refreshAll();
            }, 500);
          }
        },
        { multiline: field2.multiline, rows: field2.rows, helper: field2.helper }
      );
      fieldHandles.set(field2.key, handle);
    }
    const { node: resultHost, set: setResult } = addResult(parent);
    setResult(charState.result);
    clearResult = () => {
      setResult("");
      powerResults["character"] = false;
    };
    resultClearers["character"] = clearResult;
    const actions = addActions(parent);
    const fill = addButton(actions, "Fill blanks", "outline", () => {
      const character = ensureCharacter();
      void fillMissingFields(
        fill,
        {
          noun: "character sheet",
          system: [
            "You fill character sheets for fiction.",
            "Write specific, playable details: concrete behavior, costs, contradictions, and voice. Keep name, role, pronouns, and era short; put texture in look, want, need, wound, contradiction, and voice. Avoid generic traits, stock phrases, and long backstory."
          ].join("\n"),
          fields: fields.map((field2) => ({
            key: field2.key,
            label: field2.label,
            value: String(character[field2.key] ?? ""),
            max: field2.key === "look" || field2.key === "relationships" ? 1200 : 600,
            hint: field2.helper
          })),
          maxOutputTokens: 2400
        },
        (values) => {
          if (selectedCharacterId !== character.id) {
            toast("info", "Character changed; the fill was discarded.");
            return false;
          }
          let applied = 0;
          for (const [key, value] of Object.entries(values)) {
            if (!fields.some((field2) => field2.key === key)) continue;
            if (String(character[key] ?? "").trim()) continue;
            character[key] = value;
            fieldHandles.get(key)?.update({ value });
            applied += 1;
          }
          if (applied === 0) {
            toast("info", "The empty fields were filled while the answer was running; nothing was overwritten.");
            return false;
          }
          character.updatedAt = Date.now();
          charState.result = "";
          clearResult();
          markCharactersChanged();
          if (values.name) renderSelect();
          refreshAll();
          return applied;
        }
      );
    });
    const preview = addButton(actions, "Preview card", "secondary", () => {
      const card = characterCard(ensureCharacter());
      charState.result = card;
      powerResults["character"] = true;
      setResult(card);
      refreshAll();
    });
    const deepen = addButton(actions, "Deepen", "secondary", () => {
      void withBusy(deepen, async () => {
        const character = ensureCharacter();
        const system = [
          "You are a character dramaturg. You do not gush.",
          "Given a character card, return 5 sharp suggestions as markdown bullets: 2 contradictions or costs, 2 concrete scene pressures, 1 voice quirk. Each bullet must be specific to this character and playable on the page. No preamble. No rewriting the whole card."
        ].join("\n");
        const prompt = characterCard(character);
        const result = await generateText(deepen, system, prompt, 900);
        if (result) {
          charState.result = result;
          powerResults["character"] = true;
          setResult(result);
          refreshAll();
        }
      });
    });
    addButton(actions, "Copy", "outline", () => void copyText(characterCard(ensureCharacter())));
    addButton(actions, "Attach", "outline", () => {
      const character = ensureCharacter();
      void attachText(
        `Character: ${character.name || "Unnamed"}`,
        characterCard(character),
        { power: "character", characterId: character.id }
      );
    });
    addButton(actions, "Start scene", "outline", () => {
      const character = ensureCharacter();
      const card = characterCard(character);
      void startFreshSession(
        `Scene: ${character.name || "Unnamed"}`,
        `${card}

Start a scene with this character. Put them under pressure that targets their contradiction. Open with them pursuing their want and failing in a small, specific way. Stay close to their voice. End on a turn, not a summary.`
      );
    });
    addNote(parent, "Fill blanks asks the Small Model for only the empty fields. It does not start a chat or overwrite text you have already typed.");
    syncFields();
  }
  function buildProse(parent) {
    let updateMode = () => {
    };
    const top = el2("div", "fb-grid2");
    parent.append(top);
    addSelect(
      top,
      "Workbench",
      [
        { id: "line", label: "Line polish" },
        { id: "scene", label: "Scene doctor" },
        { id: "voice", label: "Voice match" }
      ],
      () => proseState.mode,
      (value) => {
        proseState.mode = value;
        proseState.result = "";
        clearPowerResult("prose");
        updateMode();
      },
      false
    );
    addSelect(
      top,
      "Focus",
      [
        { id: "sensory", label: "Sensory precision" },
        { id: "rhythm", label: "Rhythm" },
        { id: "dialogue", label: "Dialogue" },
        { id: "tension", label: "Tension" },
        { id: "clarity", label: "Clarity" },
        { id: "cut", label: "Cut 10%" }
      ],
      () => proseState.focus,
      (value) => {
        proseState.focus = value;
        proseState.result = "";
        clearPowerResult("prose");
      },
      false
    );
    const style = addSelect(
      parent,
      "Treatment",
      [
        { id: "preserve", label: "Preserve voice" },
        { id: "tighten", label: "Tighten" },
        { id: "heighten", label: "Heighten" },
        { id: "plain", label: "Plain and direct" }
      ],
      () => proseState.style,
      (value) => {
        proseState.style = value;
        proseState.result = "";
        clearPowerResult("prose");
      },
      false
    );
    const characterWrap = el2("div");
    parent.append(characterWrap);
    let characterSignature = "__unset__";
    let characterHandle = null;
    const renderCharacters = () => {
      const nextSignature = characters.map((character) => `${character.id}:${character.name}`).join("|");
      if (nextSignature === characterSignature) return;
      characterSignature = nextSignature;
      characterHandle?.dispose();
      characterHandle = null;
      characterWrap.replaceChildren();
      if (!characters.length) {
        characterWrap.append(el2("div", "fb-note", "No saved characters. Build one in Character Forge first."));
        return;
      }
      if (!proseState.characterId || !characters.some((item) => item.id === proseState.characterId)) {
        proseState.characterId = characters[0]?.id ?? "";
      }
      characterHandle = mountSelect(characterWrap, {
        label: "Voice from character",
        value: proseState.characterId,
        options: characters.map((character) => ({ id: character.id, label: character.name.trim() || "Unnamed" })),
        onChange: (id) => {
          proseState.characterId = id;
          characterHandle?.update({ value: id });
          proseState.result = "";
          clearPowerResult("prose");
        }
      });
    };
    const source = el2("div", "fb-capture");
    parent.append(source);
    const refreshSource = () => {
      source.replaceChildren();
      if (proseState.source) {
        source.append(el2("b", "", proseState.source), document.createTextNode(" loaded."));
      } else {
        source.append(document.createTextNode("Select prose in chat \u2192 "), el2("b", "", "Fox Box: polish prose"), document.createTextNode(", or paste below."));
      }
    };
    refreshSource();
    powerUpdaters["prose"] = refreshSource;
    const text = addText(
      parent,
      "Prose or scene",
      proseState.text,
      (value) => {
        proseState.text = value.slice(0, 16e3);
        proseState.source = "";
        proseState.result = "";
        clearPowerResult("prose");
      },
      { multiline: true, rows: 7, placeholder: "Paste the paragraph, scene, or scene summary\u2026" }
    );
    handles["prose-text"] = text;
    updateMode = () => {
      const voiceMode = proseState.mode === "voice";
      characterWrap.hidden = !voiceMode;
      if (voiceMode) renderCharacters();
    };
    updateMode();
    powerUpdaters["prose-characters"] = () => {
      if (proseState.mode === "voice") renderCharacters();
    };
    const actions = addActions(parent);
    const polish = addButton(actions, "Polish", "default", () => {
      void withBusy(polish, async () => {
        if (!proseState.text.trim()) {
          toast("info", "Paste or select some prose first.");
          return;
        }
        const character = characters.find((item) => item.id === proseState.characterId) ?? selectedCharacter();
        const system = proseState.mode === "scene" ? [
          "You are a story editor. You diagnose scenes, you do not rewrite them.",
          "Return markdown: ## Want, ## Conflict, ## Turn, ## Exit, ## Three escalations, ## Continuity risks. Be concrete and short. No praise."
        ].join("\n") : [
          "You are a line editor with a ruthless ear.",
          "Return only the revised text, then a blank line, then exactly three bullets: what changed and why.",
          "Preserve meaning, point of view, and the author's voice. Do not add new events. Do not pad. If the passage is under 40 words, do not lengthen it."
        ].join("\n");
        const prompt = [
          `Mode: ${proseState.mode}`,
          `Focus: ${proseState.focus}`,
          `Treatment: ${proseState.style}`,
          character && proseState.mode === "voice" ? `Voice card:
${characterCard(character)}` : "",
          `Text:
${proseState.text}`
        ].filter(Boolean).join("\n\n");
        const result = await generateText(polish, system, prompt, 1800);
        if (result) {
          proseState.result = result;
          powerResults["prose"] = true;
          setResult(result);
          refreshAll();
        }
      });
    });
    const { node: resultHost, set: setResult } = addResult(parent);
    setResult(proseState.result);
    resultClearers["prose"] = () => setResult("");
    const resultActions = addActions(parent);
    addButton(resultActions, "Send to agent", "secondary", () => {
      if (!proseState.result) {
        toast("info", "Polish or diagnose first.");
        return;
      }
      void sendToSession(
        `Use this edit as a starting point. Preserve the author's voice and do not add events. Explain any change that alters meaning.

${proseState.result}`,
        "Prose pass sent to the agent."
      );
    });
    addButton(resultActions, "Compose", "outline", () => void composeText(proseState.result));
    addButton(resultActions, "Copy", "outline", () => void copyText(proseState.result));
    addButton(resultActions, "Save", "outline", () => {
      if (!proseState.result) {
        toast("info", "Polish or diagnose first.");
        return;
      }
      void (async () => {
        const path = `.foxbox/prose/${fileStamp()}-${slugify(proseState.mode)}.md`;
        try {
          await host.writeFile(path, proseState.result);
          toast("success", `Saved ${path}`);
        } catch (error) {
          notifyError(error, "Saving the prose pass");
        }
      })();
    });
    addNote(parent, "The revision is a draft surface, not an overwrite. Copy it back only where it earns its place.");
  }
  function sparkScore(spark) {
    if (!spark.scores) return null;
    const { novelty, usefulness, fit, effort } = spark.scores;
    return Math.round(((novelty + usefulness + fit) / 3 - effort * 0.25) * 10) / 10;
  }
  var sparksSaving = false;
  var sparksSavePending = false;
  var sparksTouched = false;
  var sparksVersion = 0;
  var sparksLoaded = false;
  var sparksSaveWarned = false;
  var sparksSaveChain = Promise.resolve();
  var retainedSparkIds = /* @__PURE__ */ new Set();
  function sparkIndexIds(snapshot) {
    const ids = snapshot.map((spark) => spark.id);
    for (const id of retainedSparkIds) {
      if (!ids.includes(id) && ids.length < 60) ids.push(id);
    }
    return ids.slice(0, 60);
  }
  async function runSparksSave() {
    do {
      sparksSavePending = false;
      const version = sparksVersion;
      const snapshot = sparks.slice(0, 60).map((spark) => ({ ...spark }));
      let ok = false;
      const nextCache = /* @__PURE__ */ new Map();
      const writes = [];
      for (const spark of snapshot) {
        const serialized = JSON.stringify(spark);
        nextCache.set(spark.id, serialized);
        retainedSparkIds.delete(spark.id);
        if (sparkCache.get(spark.id) !== serialized) {
          writes.push(host.storage.set(sparkKey(spark.id), JSON.parse(serialized)));
        }
      }
      try {
        await Promise.all(writes);
        await host.storage.set(SPARK_INDEX_KEY, sparkIndexIds(snapshot));
        sparkCache.clear();
        for (const [id, serialized] of nextCache) sparkCache.set(id, serialized);
        ok = true;
      } catch {
        toast("error", "Could not save ideas.");
      }
      if (!ok) return;
      if (sparksVersion === version && !sparksSavePending) {
        sparksTouched = false;
        return;
      }
    } while (sparksLoaded);
  }
  function saveSparksNow() {
    if (!sparksLoaded) {
      if (!sparksSaveWarned) {
        sparksSaveWarned = true;
        toast("error", "Saved ideas could not be read, so Fox Box will not overwrite them. Reopen the panel.");
      }
      return sparksSaveChain;
    }
    if (sparksSaving) {
      sparksSavePending = true;
      return sparksSaveChain;
    }
    sparksSaving = true;
    sparksSaveChain = runSparksSave().finally(() => {
      sparksSaving = false;
    });
    return sparksSaveChain;
  }
  var persistSparks = debounce(saveSparksNow, 450);
  function markSparksChanged() {
    sparksTouched = true;
    sparksVersion += 1;
    persistSparks();
  }
  function buildIdeaDistiller(parent) {
    let addButtonHandle = null;
    group(parent, "Add a spark");
    const addGrid = el2("div", "fb-grid2");
    parent.append(addGrid);
    const title = addText(
      addGrid,
      "Title",
      ideaState.title,
      (value) => {
        ideaState.title = value.slice(0, 160);
        addButtonHandle?.update({ disabled: !ideaState.title.trim() });
      },
      { placeholder: "One line that makes you curious" }
    );
    handles["idea-title"] = title;
    const note = addText(
      parent,
      "Note",
      ideaState.note,
      (value) => {
        ideaState.note = value.slice(0, NOTE_MAX);
      },
      { multiline: true, rows: 2, placeholder: "What is it, why now, what would make it fun\u2026" }
    );
    handles["idea-note"] = note;
    const addRow = addActions(parent);
    addButtonHandle = addButton(addRow, "Add spark", "secondary", () => {
      if (!ideaState.title.trim()) return;
      if (sparks.length >= 60) {
        toast("info", "The rack holds 60 sparks. Promote or remove one first.");
        return;
      }
      sparks.unshift({
        id: uid(),
        title: ideaState.title.trim(),
        note: ideaState.note.trim(),
        createdAt: Date.now()
      });
      ideaState.title = "";
      ideaState.note = "";
      handles["idea-title"]?.update({ value: "" });
      handles["idea-note"]?.update({ value: "" });
      addButtonHandle?.update({ disabled: true });
      markSparksChanged();
      renderSparks();
      refreshAll();
    });
    let filling = false;
    const fill = addButton(addRow, "Fill blanks", "outline", () => {
      if (filling) return;
      filling = true;
      void (async () => {
        if (ideaState.title.trim() && ideaState.note.trim()) {
          toast("info", "Nothing to fill in the idea spark.");
          return;
        }
        let context = "";
        try {
          const info = await detectProject();
          context = `Project: ${info.label}
${info.summary}`;
        } catch {
        }
        await fillMissingFields(
          fill,
          {
            noun: "idea spark",
            system: [
              "You write terse, concrete game or software ideas.",
              "Avoid generic advice, buzzwords, and long explanations. A title should make the reader curious; a note should say what it is, why it might work, and what would make it fun."
            ].join("\n"),
            context,
            maxOutputTokens: 500,
            fields: [
              {
                key: "title",
                label: "Title",
                value: ideaState.title,
                max: 120,
                hint: "one line that makes the reader curious"
              },
              {
                key: "note",
                label: "Note",
                value: ideaState.note,
                max: 700,
                hint: "what it is, why now, what would make it fun"
              }
            ]
          },
          (values) => {
            let applied = 0;
            if (values.title !== void 0 && !ideaState.title.trim()) {
              ideaState.title = values.title.slice(0, 160);
              handles["idea-title"]?.update({ value: ideaState.title });
              applied += 1;
            }
            if (values.note !== void 0 && !ideaState.note.trim()) {
              ideaState.note = values.note.slice(0, NOTE_MAX);
              handles["idea-note"]?.update({ value: ideaState.note });
              applied += 1;
            }
            if (applied === 0) {
              toast("info", "The empty fields were filled while the answer was running; nothing was overwritten.");
              return false;
            }
            addButtonHandle?.update({ disabled: !ideaState.title.trim() });
            return applied;
          }
        );
      })().finally(() => {
        filling = false;
      });
    });
    addButtonHandle.update({ disabled: true });
    addNote(parent, "Fill blanks asks the Small Model for the missing title or note only; it does not save or send the spark.");
    group(parent, "The rack");
    const list = el2("div", "fb-scroll");
    parent.append(list);
    let resetRemove = () => {
    };
    const renderSparks = () => {
      resetRemove();
      list.replaceChildren();
      if (!sparks.length) {
        list.append(el2("div", "fb-empty", "No sparks yet. Every good project starts as a bad note."));
        return;
      }
      for (const spark of sparks) {
        const selected = selectedSparks.has(spark.id);
        const row = el2("label", "fb-spark");
        row.dataset.selected = String(selected);
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = selected;
        box.setAttribute("aria-label", `Select ${spark.title}`);
        box.addEventListener("change", () => {
          if (box.checked) {
            if (selectedSparks.size >= 2) {
              box.checked = false;
              toast("info", "Pick at most two sparks to blend.");
              return;
            }
            selectedSparks.add(spark.id);
          } else {
            selectedSparks.delete(spark.id);
          }
          renderSparks();
          updateIdeaButtons();
        });
        const body = el2("div");
        body.append(el2("div", "fb-spark-title", spark.title));
        if (spark.note) body.append(el2("div", "fb-spark-note", spark.note));
        if (spark.scores) {
          const scores = el2("div", "fb-spark-scores");
          for (const [label, value] of [
            ["N", spark.scores.novelty],
            ["U", spark.scores.usefulness],
            ["F", spark.scores.fit],
            ["E", spark.scores.effort]
          ]) {
            scores.append(el2("span", "fb-chip", `${label}${value}`));
          }
          body.append(scores);
        }
        const score = sparkScore(spark);
        const badge = el2("span", "fb-chip", score === null ? "unscored" : String(score));
        badge.dataset.tone = score !== null && score >= 3.5 ? "success" : "";
        row.append(box, body, badge);
        list.append(row);
      }
    };
    const actions = addActions(parent);
    const assess = addButton(actions, "Assess selected", "secondary", () => {
      if (!selectedSparks.size) {
        toast("info", "Select one or two sparks.");
        return;
      }
      void withBusy(assess, async () => {
        const chosen = sparks.filter((spark) => selectedSparks.has(spark.id));
        const system = [
          "You score early ideas. Be honest and comparative, not kind.",
          "Return one line per idea in exactly this format, with integers 1 to 5:",
          "<idea-id>|novelty=<n>|usefulness=<n>|fit=<n>|effort=<n>",
          "Effort is 1 for a weekend and 5 for a year. No other text."
        ].join("\n");
        const prompt = chosen.map((spark) => `id=${spark.id}
title=${spark.title}
note=${spark.note}`).join("\n\n");
        const result = await generateText(assess, system, prompt, 500);
        if (!result) return;
        let changed = 0;
        for (const spark of chosen) {
          const line = result.split(/\r?\n/).find((item) => item.includes(spark.id));
          if (!line) continue;
          const n = /novelty\s*=\s*(\d)/i.exec(line);
          const u = /usefulness\s*=\s*(\d)/i.exec(line);
          const f = /fit\s*=\s*(\d)/i.exec(line);
          const e = /effort\s*=\s*(\d)/i.exec(line);
          if (!n || !u || !f || !e) continue;
          spark.scores = {
            novelty: clampInt(n[1], 1, 5, 3),
            usefulness: clampInt(u[1], 1, 5, 3),
            fit: clampInt(f[1], 1, 5, 3),
            effort: clampInt(e[1], 1, 5, 3)
          };
          changed += 1;
        }
        if (!changed) {
          showBanner("warning", "The score line was not readable", "The small model did not return the requested format. Try again or score it by hand.");
          return;
        }
        markSparksChanged();
        renderSparks();
        refreshAll();
        toast("success", `Scored ${changed} spark${changed === 1 ? "" : "s"}.`);
      });
    });
    const blend = addButton(actions, "Blend two", "secondary", () => {
      if (selectedSparks.size !== 2) {
        toast("info", "Select exactly two sparks to blend.");
        return;
      }
      void withBusy(blend, async () => {
        const chosen = sparks.filter((spark) => selectedSparks.has(spark.id));
        if (chosen.length !== 2) return;
        const system = [
          "You are a concept blender. Produce three genuinely different concepts that combine the two seeds.",
          "Return markdown:",
          "# Blends",
          "## 1. <name>",
          "**Pitch:** one sentence.",
          "**First buildable step:** one concrete step.",
          "**Risk:** one sentence.",
          "Repeat for 2 and 3. No preamble. Keep it under 350 words."
        ].join("\n");
        const prompt = chosen.map((spark) => `Title: ${spark.title}
Note: ${spark.note}`).join("\n\n---\n\n");
        const result = await generateText(blend, system, prompt, 1300);
        if (result) {
          ideaState.result = result;
          powerResults["idea"] = true;
          setResult(result);
          refreshAll();
        }
      });
    });
    let remove = null;
    let removeArmed = false;
    let removeTimer;
    resetRemove = () => {
      removeArmed = false;
      if (removeTimer !== void 0) {
        window.clearTimeout(removeTimer);
        removeTimer = void 0;
      }
      remove?.update({ label: "Delete selected", variant: "ghost" });
    };
    remove = addButton(actions, "Delete selected", "ghost", () => {
      if (!selectedSparks.size) {
        toast("info", "Select a spark first.");
        return;
      }
      if (!removeArmed) {
        removeArmed = true;
        remove?.update({ label: "Confirm delete", variant: "destructive" });
        removeTimer = window.setTimeout(resetRemove, 3e3);
        return;
      }
      const removedIds = Array.from(selectedSparks);
      sparks = sparks.filter((spark) => !selectedSparks.has(spark.id));
      selectedSparks.clear();
      selectedSparks = /* @__PURE__ */ new Set();
      markSparksChanged();
      for (const id of removedIds) {
        sparkCache.delete(id);
        retainedSparkIds.delete(id);
        void host.storage.delete(sparkKey(id)).catch(() => {
        });
      }
      resetRemove();
      renderSparks();
      refreshAll();
      toast("info", "Removed.");
    });
    const updateIdeaButtons = () => {
      assess.update({ disabled: selectedSparks.size === 0 });
      blend.update({ disabled: selectedSparks.size !== 2 });
      remove?.update({ disabled: selectedSparks.size === 0 });
    };
    const { node: resultHost, set: setResult } = addResult(parent);
    setResult(ideaState.result);
    resultClearers["idea"] = () => setResult("");
    const resultActions = addActions(parent);
    addButton(resultActions, "Send to Slice Forge", "secondary", () => {
      if (!ideaState.result) {
        toast("info", "Blend two sparks first.");
        return;
      }
      sliceState.goal = ideaState.result;
      sliceState.result = "";
      clearPowerResult("slice");
      handles["slice-goal"]?.update({ value: sliceState.goal });
      focusPower("slice");
      toast("info", "Loaded into Slice Forge.");
    });
    addButton(resultActions, "Send to agent", "outline", () => {
      if (!ideaState.result) {
        toast("info", "Blend two sparks first.");
        return;
      }
      void sendToSession(
        `Turn this blend into a small, testable first move for the current project. Pick one concept, state why, then outline the thin slice.

${ideaState.result}`,
        "Blend sent to the agent."
      );
    });
    addButton(resultActions, "Copy", "outline", () => void copyText(ideaState.result));
    renderSparks();
    updateIdeaButtons();
    powerUpdaters["idea"] = () => updateIdeaButtons();
  }
  function applyPreset(name) {
    const preset = QWEN_PRESETS[name];
    if (!preset) return;
    config.powers.model.preset = name;
    Object.assign(config.powers.model, preset);
    syncModelFields();
    void saveConfigNow();
    refreshAll();
  }
  function syncToolChecks() {
    for (const item of modelToolChecks) {
      item.handle.update({
        checked: item.names.some((name) => config.powers.model.hideTools.includes(name))
      });
    }
  }
  function syncModelFields() {
    for (const [key, handle] of Object.entries(modelFieldHandles)) {
      const value = config.powers.model[key];
      handle.update({ value: String(value) });
    }
    modelPresetHandle?.update({ value: config.powers.model.preset });
    modelReasoningHandle?.update({ value: config.powers.model.reasoningEffort });
    modelCapOutputHandle?.update({ checked: config.powers.model.capOutput });
    syncToolChecks();
    modelExtraToolsHandle?.update({ value: extraToolNames() });
  }
  var modelFieldHandles = {};
  var modelPresetHandle = null;
  var modelReasoningHandle = null;
  var modelCapOutputHandle = null;
  var modelToolLine = null;
  var modelModelLine = null;
  var modelExtraToolsHandle = null;
  var modelToolChecks = [];
  function extraToolNames() {
    return config.powers.model.hideTools.filter((name) => !KNOWN_TOOLS.some((known) => known.names.includes(name))).join(", ");
  }
  function setToolHidden(name, hidden) {
    const set = new Set(config.powers.model.hideTools);
    if (hidden) set.add(name);
    else set.delete(name);
    config.powers.model.hideTools = Array.from(set).slice(0, 24);
  }
  function setExtraToolNames(value) {
    const known = config.powers.model.hideTools.filter(
      (name) => KNOWN_TOOLS.some((item) => item.names.includes(name))
    );
    const extra = value.split(",").map((name) => name.trim()).filter(Boolean).slice(0, 16);
    config.powers.model.hideTools = Array.from(/* @__PURE__ */ new Set([...known, ...extra])).slice(0, 24);
  }
  function buildModelFit(parent) {
    for (const key of Object.keys(modelFieldHandles)) delete modelFieldHandles[key];
    modelToolChecks.length = 0;
    modelPresetHandle = null;
    modelReasoningHandle = null;
    modelCapOutputHandle = null;
    modelExtraToolsHandle = null;
    modelToolLine = null;
    modelModelLine = null;
    modelModelLine = el2("div", "fb-capture");
    parent.append(modelModelLine);
    const refreshModelLine = () => {
      if (!modelModelLine) return;
      modelModelLine.replaceChildren();
      if (!config.powers.model.enabled) {
        modelModelLine.append(document.createTextNode("Model Fit is off. Sampling and tool-surface rules are not applied."));
        return;
      }
      const model = sessionModel();
      if (!model) {
        modelModelLine.append(document.createTextNode("No chat open. Rules are armed for the next request."));
        return;
      }
      const applies = modelApplies();
      modelModelLine.append(
        el2("b", "", shortModel(model)),
        document.createTextNode(
          applies ? " \xB7 tuned by Fox Box." : config.powers.model.applyToQwenOnly ? " \xB7 not a Qwen-family name, so sampling and the contract are idle; tool hiding still applies." : " \xB7 profile applies to every model."
        )
      );
    };
    refreshModelLine();
    powerUpdaters["model"] = refreshModelLine;
    addSwitch(
      parent,
      "Model Fit active",
      "Applies sampling, reasoning, and contract rules to matching requests. Tool hiding follows this switch for every model.",
      () => config.powers.model.enabled,
      (value) => {
        config.powers.model.enabled = value;
      }
    );
    const presetHost = el2("div");
    parent.append(presetHost);
    modelPresetHandle = mountSelect(presetHost, {
      label: "Profile",
      value: config.powers.model.preset,
      options: [
        { id: "qwen-thinking", label: "Qwen3.8 thinking", hint: "recommended" },
        { id: "qwen-instruct", label: "Qwen3.8 instruct", hint: "faster" },
        { id: "balanced", label: "Balanced", hint: "other models" },
        { id: "custom", label: "Custom" }
      ],
      onChange: (value) => {
        if (value === "custom") {
          config.powers.model.preset = "custom";
          modelPresetHandle?.update({ value: "custom" });
          void saveConfigNow();
          refreshAll();
          return;
        }
        applyPreset(value);
      }
    });
    const switches = el2("div");
    parent.append(switches);
    addSwitch(
      switches,
      "Apply only to Qwen-family models",
      "Matches Qwen, Unsloth, Flash-Next and common Qwen quant names. Turn off to apply to every model.",
      () => config.powers.model.applyToQwenOnly,
      (value) => {
        config.powers.model.applyToQwenOnly = value;
      }
    );
    addSwitch(
      switches,
      "Inject small-model contract",
      "A short system note that keeps the agent tool-first, stepwise and honest about verification.",
      () => config.powers.model.contractEnabled,
      (value) => {
        config.powers.model.contractEnabled = value;
      }
    );
    modelCapOutputHandle = addSwitch(
      switches,
      "Cap output tokens",
      "Stops a chatty turn from spending its whole budget on prose.",
      () => config.powers.model.capOutput,
      (value) => {
        config.powers.model.capOutput = value;
      }
    );
    group(parent, "Sampling");
    const grid = el2("div", "fb-grid2");
    parent.append(grid);
    for (const [key, label, help] of [
      ["temperature", "Temperature", "Thinking 1.0 \xB7 instruct 0.7"],
      ["topP", "Top P", "Thinking 0.95 \xB7 instruct 0.80"],
      ["topK", "Top K", "Qwen recommends 20"],
      ["presencePenalty", "Presence penalty", "Instruct 1.5; thinking 0"],
      ["frequencyPenalty", "Frequency penalty", "Usually 0; raise to reduce repeats"],
      ["maxOutputTokens", "Max output tokens", "Used when the cap is on"]
    ]) {
      let handle = null;
      handle = addText(
        grid,
        label,
        String(config.powers.model[key]),
        (value) => {
          if (!value.trim()) return;
          const number = Number(value);
          if (!Number.isFinite(number)) return;
          const limits = {
            temperature: [0, 2, false],
            topP: [0, 1, false],
            topK: [0, 200, true],
            presencePenalty: [-2, 2, false],
            frequencyPenalty: [-2, 2, false],
            maxOutputTokens: [256, 64e3, true]
          };
          const [min, max, integer] = limits[key] ?? [number, number, false];
          const next = integer ? Math.round(number) : number;
          config.powers.model[key] = Math.min(max, Math.max(min, next));
          config.powers.model.preset = "custom";
          modelPresetHandle?.update({ value: "custom" });
          queueConfigSave();
          refreshAll();
        },
        {
          mono: true,
          helper: help,
          onCommit: () => handle?.update({ value: String(config.powers.model[key]) })
        }
      );
      modelFieldHandles[key] = handle;
    }
    const reasoningHost = el2("div");
    parent.append(reasoningHost);
    modelReasoningHandle = mountSelect(reasoningHost, {
      label: "Reasoning effort",
      value: config.powers.model.reasoningEffort,
      options: [
        { id: "xhigh", label: "Extra high", hint: "Qwen default" },
        { id: "high", label: "High" },
        { id: "medium", label: "Medium" },
        { id: "low", label: "Low" },
        { id: "none", label: "None", hint: "instruct" },
        { id: "auto", label: "Provider default" }
      ],
      onChange: (value) => {
        config.powers.model.reasoningEffort = value;
        modelReasoningHandle?.update({ value });
        void saveConfigNow();
        refreshAll();
      }
    });
    const contract = addText(
      parent,
      "Small-model contract",
      config.powers.model.contract,
      (value) => {
        config.powers.model.contract = value.slice(0, 3500);
        queueConfigSave();
      },
      { multiline: true, rows: 5, helper: "Injected into the system prompt only when this profile applies." }
    );
    modelFieldHandles["contract"] = contract;
    group(parent, "Tool surface");
    addNote(
      parent,
      "Hide tools from the request only. They stay installed; this just keeps a small model from choosing between near-duplicates. Hiding applies to every model while Model Fit is active, not only Qwen-family ones."
    );
    const toolGrid = el2("div", "fb-switchgrid");
    parent.append(toolGrid);
    for (const tool of KNOWN_TOOLS) {
      const handle = addCheckbox(
        toolGrid,
        tool.label,
        tool.description,
        () => tool.names.some((name) => config.powers.model.hideTools.includes(name)),
        (checked) => {
          for (const name of tool.names) setToolHidden(name, checked);
          syncToolChecks();
        },
        true
      );
      modelToolChecks.push({ names: tool.names, handle });
    }
    modelExtraToolsHandle = addText(
      parent,
      "Also hide",
      extraToolNames(),
      (value) => {
        setExtraToolNames(value);
        syncToolChecks();
        queueConfigSave();
        refreshAll();
      },
      { helper: "Comma-separated exact tool names. Missing names are ignored.", placeholder: "tool_a, tool_b" }
    );
    modelToolLine = el2("div", "fb-note");
    parent.append(modelToolLine);
    const refreshToolLine = () => {
      if (!modelToolLine) return;
      const last = pluginStatus?.last;
      const configured = config.powers.model.hideTools.length;
      if (!config.powers.model.enabled) {
        modelToolLine.textContent = "Model Fit is off; no tools are hidden.";
        return;
      }
      if (!last) {
        modelToolLine.textContent = `${configured} name${configured === 1 ? "" : "s"} configured to hide. No request seen yet.`;
        return;
      }
      const sameSession = last.sessionId && last.sessionId === sessionId();
      const hidden = last.hidden?.length ?? 0;
      const applied = last.applied !== false ? "" : " \xB7 sampling profile not applied";
      const missing = configured > 0 && hidden === 0 ? " \xB7 none of the configured names were in that request" : "";
      modelToolLine.textContent = sameSession ? `Last request in this session: ${last.tools ?? "?"} tools visible${hidden ? `, ${hidden} hidden` : ""}${applied}${missing}.` : `Last request was in another session: ${last.tools ?? "?"} tools visible${hidden ? `, ${hidden} hidden` : ""}${applied}${missing}.`;
    };
    refreshToolLine();
    powerUpdaters["model-tools"] = refreshToolLine;
    const actions = addActions(parent);
    addButton(actions, "Copy contract", "outline", () => void copyText(config.powers.model.contract));
    addButton(actions, "Reset thinking", "outline", () => applyPreset("qwen-thinking"));
    const details = el2("details", "fb-details");
    details.append(
      el2("summary", "", "Qwen3.8-Flash-Next reference"),
      el2(
        "div",
        "fb-note",
        "Thinking: temp 1.0, top_p 0.95, top_k 20, no presence penalty, extra-high reasoning. Instruct: temp 0.7, top_p 0.80, top_k 20, presence penalty 1.5. Native context 262k. These are starting points, not laws."
      )
    );
    parent.append(details);
  }
  function metricCell(parent, label) {
    const box = el2("div", "fb-metric");
    const value = el2("div", "fb-metric-value", "\u2014");
    const sub = el2("div", "fb-metric-sub", "");
    box.append(el2("div", "fb-metric-label", label), value, sub);
    parent.append(box);
    return { value, sub };
  }
  function breakdownRow(label, chars, total, isTotal = false) {
    const row = el2("div", "fb-brow");
    if (isTotal) row.dataset.total = "true";
    const share = percentOf(chars, total);
    const track = el2("span", "fb-brow-track");
    const fill = el2("span", "fb-brow-fill");
    fill.style.width = `${chars > 0 ? Math.max(2, share) : 0}%`;
    track.append(fill);
    row.append(
      el2("span", "fb-brow-label", label),
      track,
      el2("span", "fb-brow-value", fmt(chars)),
      el2("span", "fb-brow-share", fmtPercent(share))
    );
    return row;
  }
  function metricsReport() {
    if (!pluginStatus) return "";
    const entry = currentPluginSession();
    const totals = pluginStatus.totals;
    const hasSession2 = Boolean(entry && amount(entry.runs) > 0);
    const hasTotals = Boolean(totals && amount(totals.context) > 0);
    if (!hasSession2 && !hasTotals) return "";
    const title = ready?.session?.title;
    const lines = ["Fox Box pruning ledger"];
    lines.push(`Chat: ${sessionId() || "unknown"}${title ? ` \u2014 ${title}` : ""}`);
    if (entry && hasSession2) {
      const estimate = tokenEstimate();
      const runs = amount(entry.runs);
      const totalSaved = amount(entry.prunedChars);
      const totalOriginal = amount(entry.originalChars);
      const lastSaved = amount(entry.lastSaved);
      const lastOriginal = amount(entry.lastOriginal);
      const lastKept = amount(entry.lastKept) || Math.max(0, lastOriginal - lastSaved);
      const lastTotal = lastOriginal || lastSaved + lastKept;
      const lastRate = lastTotal > 0 ? percentOf(lastSaved, lastTotal) : 0;
      const lastCollapsed = latestRequestNumber("lastCollapsed", "collapsed");
      const lastCollapsedChars = latestRequestNumber("lastCollapsedChars", "collapsedChars");
      const lastOld = latestRequestNumber("lastOld", "oldChars");
      const lastFresh = latestRequestNumber("lastFresh", "freshChars");
      const lastOther = latestRequestNumber("lastOther", "otherChars");
      const lastSuperseded = latestRequestNumber("lastSupersededChars", "supersededChars");
      const lastStale = latestRequestNumber("lastStaleChars", "staleChars");
      const lastCompacted = latestRequestNumber("lastCompactedChars", "compactedChars");
      const lastReceipts = latestRequestNumber("lastReceiptChars", "receiptChars");
      const lastBudget = latestRequestNumber("lastBudgetChars", "budgetChars");
      const lastTrimmedResults = latestRequestNumber("lastTrimmedResults", "trimmedResults");
      const lastToolResults = latestRequestNumber("lastToolResults", "toolResults");
      const last = pluginStatus?.last;
      const measure = entry && entry.lastMeasure || (last && last.sessionId === sessionId() ? last.measure : void 0);
      lines.push(
        `Requests guarded: ${fmt(runs)}`,
        `Latest request: ${fmt(lastSaved)} of ${fmt(lastTotal)} chars pruned (\u2248${fmt(tokensForChars(lastSaved, estimate))} tokens; ${tokenBasisText(estimate)})`,
        `Latest savings rate: ${lastTotal > 0 ? fmtPercent(lastRate) : "unknown"} of that request`,
        `Latest breakdown: aged ${fmt(lastOld)}, fresh ${fmt(lastFresh)}, repeats ${fmt(lastCollapsedChars)} (${fmt(lastCollapsed)} calls), superseded ${fmt(lastSuperseded)}, stale ${fmt(lastStale)}, compactors ${fmt(lastCompacted)}, receipts ${fmt(lastReceipts)}, budget ${fmt(lastBudget)}, other ${fmt(lastOther)} chars`,
        `Tool results: ${fmt(lastTrimmedResults)} of ${fmt(lastToolResults)} shortened by size in the latest request`,
        `Across all guarded requests: ${fmt(totalSaved)} chars pruned (\u2248${fmt(tokensForChars(totalSaved, estimate))} tokens)`,
        `Average per guarded request: ${totalOriginal > 0 ? fmtPercent(percentOf(totalSaved, totalOriginal)) : "unknown"} of the text`,
        `Note: the same context is re-sent every turn, so the across-requests total is cumulative input saved, not unique characters.`
      );
      if (measure) {
        lines.push(
          `Whole request: ${fmt(amount(measure.chars))} chars \u2248 ${fmt(amount(measure.estimatedTokens))} tokens; system ${fmt(amount(measure.system))}, tool definitions ${fmt(amount(measure.toolDefinitions))}, text ${fmt(amount(measure.text))}, reasoning ${fmt(amount(measure.reasoning))}, media ${fmt(amount(measure.media))}, tool results ${fmt(amount(measure.toolResults))}, tool inputs ${fmt(amount(measure.toolInputs))}`
        );
      }
      if (last && last.sessionId === sessionId()) {
        const budgetOver = amount(last.budgetOver);
        const pruneErrors = amount(last.pruneErrors);
        if (budgetOver > 0) {
          lines.push(`Budget: still over by ${fmt(budgetOver)} chars after eviction (only protected or non-removable content remained).`);
        }
        if (pruneErrors > 0) {
          lines.push(`Pruning stages that failed on the latest request: ${fmt(pruneErrors)}.`);
        }
      }
    } else {
      lines.push("Requests guarded: none in this chat yet");
    }
    if (totals) {
      lines.push(
        `This project: ${fmt(amount(totals.context))} guarded requests, ${fmt(amount(totals.prunedChars))} chars pruned cumulatively, ${fmt(amount(totals.collapsed))} repeats collapsed cumulatively`
      );
    }
    return lines.join("\n");
  }
  function buildMetrics(parent) {
    const live = el2("div", "fb-note");
    parent.append(live);
    const grid = el2("div", "fb-metrics");
    parent.append(grid);
    const pruned = metricCell(grid, "Pruned in latest request");
    const rate = metricCell(grid, "Latest savings rate");
    const requests = metricCell(grid, "Requests guarded");
    const repeats = metricCell(grid, "Repeats in latest request");
    const totalsNote = el2("div", "fb-note");
    parent.append(totalsNote);
    const shareWrap = el2("div", "fb-share-wrap");
    const shareLine = el2("div", "fb-meter-line");
    const shareCaption = el2("span", "", "Last outgoing request");
    const shareValue = el2("span");
    shareLine.append(shareCaption, shareValue);
    const shareBar = el2("div", "fb-share");
    const shareFill = el2("div", "fb-share-pruned");
    shareBar.append(shareFill);
    const shareLegend = el2("div", "fb-legend");
    shareWrap.append(shareLine, shareBar, shareLegend);
    parent.append(shareWrap);
    group(parent, "Where the latest request's savings went");
    const breakdown = el2("div", "fb-breakdown");
    parent.append(breakdown);
    group(parent, "Recent requests");
    const bars = el2("div", "fb-bars");
    const barsNote = el2("div", "fb-note");
    parent.append(bars, barsNote);
    group(parent, "Across this project (cumulative input saved)");
    const totalsLine = el2("div", "fb-inline");
    parent.append(totalsLine);
    const sessionsHost = el2("div", "fb-table-wrap");
    parent.append(sessionsHost);
    const actions = addActions(parent);
    const refresh = addButton(actions, "Refresh ledger", "secondary", () => {
      void withBusy(refresh, async () => {
        const refreshed = await refreshPluginStatus();
        toast(
          "info",
          refreshed ? "Ledger refreshed." : pluginStatus ? "The ledger was not refreshed; the next poll will try again." : "No ledger yet \u2014 the plugin writes it after the first request."
        );
      });
    });
    addButton(actions, "Copy ledger", "outline", () => {
      const report = metricsReport();
      if (!report) {
        toast("info", "No ledger data yet.");
        return;
      }
      void copyText(report);
    });
    addButton(actions, "Ask what to trim", "ghost", () => {
      if (!hasSession()) {
        toast("info", "Open a chat first.");
        return;
      }
      const report = metricsReport();
      if (!report) {
        toast("info", "No ledger data yet.");
        return;
      }
      void sendToSession(
        `Read this Fox Box pruning ledger. Name the three biggest context hogs and say what to drop, compact, or avoid re-reading next. Do not run tools. Keep it under 150 words.

${report}`,
        "Asked the agent about the context."
      );
    });
    const details = el2("details", "fb-details");
    details.append(
      el2("summary", "", "How these numbers are measured"),
      el2(
        "div",
        "fb-note",
        "Pruning is measured exactly, in characters, by counting the outgoing message text, tool results, and tool arguments before and after Fox Box edits the request. The whole-request line adds the system prompt, tool definitions, reasoning, media bytes, and tool inputs, so you can see which part dominates. Headline numbers describe the latest guarded request. A chat re-sends its history every turn, so the same text can be pruned again on the next request; the across-requests total sums those per-request savings and represents input saved over time, not unique characters removed. Tokens are estimated from the latest request's measured context tokens divided by the characters Fox Box kept for it, which gives this model's average tokens per character; when OpenChamber's context meter has no measurement yet, Fox Box falls back to four characters per token. The meter counts the whole request, including the system prompt and tool definitions, so a very small context can read slightly high. Totals begin when OpenCode starts and reset on restart."
      )
    );
    parent.append(details);
    const render = () => {
      const entry = currentPluginSession();
      const totals = pluginStatus?.totals;
      const runs = amount(entry?.runs);
      const totalSaved = amount(entry?.prunedChars);
      const lastSaved = amount(entry?.lastSaved);
      const lastOriginal = amount(entry?.lastOriginal);
      const lastKept = amount(entry?.lastKept) || Math.max(0, lastOriginal - lastSaved);
      const lastTotal = lastOriginal || lastSaved + lastKept;
      const lastRate = lastTotal > 0 ? percentOf(lastSaved, lastTotal) : 0;
      const lastCollapsed = latestRequestNumber("lastCollapsed", "collapsed");
      const lastCollapsedChars = latestRequestNumber("lastCollapsedChars", "collapsedChars");
      const estimate = tokenEstimate();
      if (!config.powers.context.enabled) {
        live.textContent = "Context Keeper is off, so nothing is pruned and the ledger stays empty. Turn it on in Context Keeper.";
      } else if (!pluginStatus) {
        live.textContent = "No ledger yet. The OpenCode plugin writes it after the first guarded request in a chat.";
      } else if (pluginStatus.stopped) {
        live.textContent = "The plugin is stopped. These are its last numbers; restart OpenCode to resume.";
      } else if (!pluginIsLive()) {
        live.textContent = "The plugin is not reporting. These are its last numbers.";
      } else if (!hasSession()) {
        live.textContent = "Plugin connected. Open a chat; its first guarded request starts this ledger.";
      } else if (!entry || runs === 0) {
        live.textContent = "No guarded request from this chat yet. The next turn will be measured.";
      } else {
        live.textContent = `Updated ${fmtAge(entry.lastAt)} \xB7 exact characters, tokens ${estimate.measured ? `at ${estimate.perChar.toFixed(2)} per character measured` : "at 4 chars/token fallback"}.`;
      }
      pruned.value.textContent = `${fmt(lastSaved)} chars`;
      pruned.sub.textContent = lastSaved > 0 ? `\u2248${fmtCompact(tokensForChars(lastSaved, estimate))} tokens` : "nothing pruned in the latest request";
      rate.value.textContent = lastTotal > 0 ? fmtPercent(lastRate) : "\u2014";
      rate.sub.textContent = lastTotal > 0 ? "of the latest request" : "waiting for data";
      requests.value.textContent = String(runs);
      requests.sub.textContent = runs > 0 ? `updated ${fmtAge(entry?.lastAt)}` : "none yet";
      repeats.value.textContent = String(lastCollapsed);
      repeats.sub.textContent = lastCollapsed > 0 ? `${fmtCompact(lastCollapsedChars)} chars saved` : "none in the latest request";
      totalsNote.textContent = runs > 0 ? `Across ${fmt(runs)} guarded request${runs === 1 ? "" : "s"}: ${fmt(totalSaved)} chars pruned (\u2248${fmt(
        tokensForChars(totalSaved, estimate)
      )} tokens). This is cumulative input saved; the same context is re-sent each turn, so it is not a unique-character count.` : "";
      if (lastTotal > 0) {
        const share = percentOf(lastSaved, lastTotal);
        shareWrap.hidden = false;
        shareValue.textContent = `${fmtPercent(share)} pruned`;
        shareFill.style.width = `${share}%`;
        shareBar.title = `${fmt(lastSaved)} of ${fmt(lastTotal)} characters pruned in the last request (\u2248${fmt(tokensForChars(lastSaved, estimate))} tokens).`;
        shareLegend.replaceChildren(
          el2("span", "", `${fmt(lastSaved)} chars pruned`),
          el2("span", "", `${fmt(lastKept)} chars kept`),
          el2("span", "", `\u2248${fmt(tokensForChars(lastSaved, estimate))} tokens pruned`)
        );
      } else {
        shareWrap.hidden = true;
      }
      breakdown.replaceChildren();
      if (entry && runs > 0 && lastTotal > 0) {
        const oldChars = latestRequestNumber("lastOld", "oldChars");
        const freshChars = latestRequestNumber("lastFresh", "freshChars");
        const latestCollapsedChars = latestRequestNumber("lastCollapsedChars", "collapsedChars");
        const supersededChars = latestRequestNumber("lastSupersededChars", "supersededChars");
        const staleChars = latestRequestNumber("lastStaleChars", "staleChars");
        const compactedChars = latestRequestNumber("lastCompactedChars", "compactedChars");
        const receiptChars = latestRequestNumber("lastReceiptChars", "receiptChars");
        const budgetChars = latestRequestNumber("lastBudgetChars", "budgetChars");
        const categorized = oldChars + freshChars + latestCollapsedChars + supersededChars + staleChars + compactedChars + receiptChars + budgetChars;
        const other = latestRequestNumber("lastOther", "otherChars") || Math.max(0, lastSaved - categorized);
        const total = Math.max(lastSaved, categorized + other);
        breakdown.append(
          breakdownRow("Aged results", oldChars, total),
          breakdownRow("Fresh / kept reads", freshChars, total),
          breakdownRow("Duplicate calls", latestCollapsedChars, total),
          breakdownRow("Superseded reads", supersededChars, total),
          breakdownRow("Stale reads", staleChars, total),
          breakdownRow("Type compactors", compactedChars, total),
          breakdownRow("Edit receipts", receiptChars, total),
          breakdownRow("Budget eviction", budgetChars, total)
        );
        if (other > 0) breakdown.append(breakdownRow("Other", other, total));
        breakdown.append(breakdownRow("Total", total, total, true));
        const toolResults = latestRequestNumber("lastToolResults", "toolResults");
        const trimmedResults = latestRequestNumber("lastTrimmedResults", "trimmedResults");
        if (toolResults > 0) {
          breakdown.append(
            el2(
              "div",
              "fb-note",
              `Trimmed ${trimmedResults} of ${toolResults} tool result${toolResults === 1 ? "" : "s"} by size in the latest request; repeats are counted separately.`
            )
          );
        }
        const last = pluginStatus?.last;
        const measure = entry && entry.lastMeasure || (last && last.sessionId === sessionId() ? last.measure : void 0);
        if (measure) {
          breakdown.append(
            el2(
              "div",
              "fb-note",
              `Whole request: ${fmt(amount(measure.chars))} chars \u2248 ${fmtCompact(
                amount(measure.estimatedTokens)
              )} tokens. System ${fmt(amount(measure.system))} \xB7 tool definitions ${fmt(
                amount(measure.toolDefinitions)
              )} \xB7 text ${fmt(amount(measure.text))} \xB7 reasoning ${fmt(amount(measure.reasoning))} \xB7 media ${fmt(
                amount(measure.media)
              )} \xB7 tool results ${fmt(amount(measure.toolResults))} \xB7 tool inputs ${fmt(amount(measure.toolInputs))}.`
            )
          );
        }
        if (last && last.sessionId === sessionId()) {
          const budgetOver = amount(last.budgetOver);
          const pruneErrors = amount(last.pruneErrors);
          if (budgetOver > 0) {
            breakdown.append(
              el2(
                "div",
                "fb-note",
                `Budget still exceeded by ${fmt(budgetOver)} chars after eviction: only protected or non-removable content remained.`
              )
            );
          }
          if (pruneErrors > 0) {
            breakdown.append(
              el2(
                "div",
                "fb-note",
                `${fmt(pruneErrors)} pruning stage${pruneErrors === 1 ? "" : "s"} failed on the latest request.`
              )
            );
          }
        }
      } else if (entry && runs > 0) {
        breakdown.append(el2("div", "fb-empty", "No latest-request breakdown yet."));
      } else {
        breakdown.append(el2("div", "fb-empty", "No guarded request in this chat yet."));
      }
      bars.replaceChildren();
      const history = Array.isArray(entry?.history) ? entry.history.slice(-16) : [];
      if (history.length) {
        const points = history.map((point) => ({ saved: amount(point.saved), kept: amount(point.kept) }));
        const peak = Math.max(1, ...points.map((point) => point.saved));
        for (const point of points) {
          const bar = el2("span", "fb-bar");
          const height = point.saved > 0 ? Math.max(6, Math.round(point.saved / peak * 42)) : 3;
          bar.style.height = `${height}px`;
          bar.dataset.empty = point.saved > 0 ? "false" : "true";
          const requestTotal = point.saved + point.kept;
          bar.title = `${fmt(point.saved)} chars pruned (\u2248${fmt(tokensForChars(point.saved, estimate))} tokens)${requestTotal > 0 ? ` \xB7 ${fmtPercent(percentOf(point.saved, requestTotal))} of the request` : ""}`;
          bars.append(bar);
        }
        barsNote.textContent = `Last ${history.length} guarded request${history.length === 1 ? "" : "s"} in this chat. Taller bars pruned more.`;
      } else {
        barsNote.textContent = "No request history yet.";
      }
      totalsLine.replaceChildren();
      if (totals && amount(totals.context) > 0) {
        const prunedChip = el2("span", "fb-chip", `${fmtCompact(amount(totals.prunedChars))} chars pruned`);
        prunedChip.dataset.tone = "primary";
        const chatCount = Object.keys(pluginStatus?.sessions ?? {}).length;
        totalsLine.append(
          el2("span", "fb-chip", `${fmt(amount(totals.context))} requests`),
          prunedChip,
          el2("span", "fb-chip", `${fmt(amount(totals.collapsed))} repeats`),
          el2("span", "fb-chip", `${chatCount} chat${chatCount === 1 ? "" : "s"}`)
        );
      } else {
        totalsLine.append(el2("span", "fb-chip", "No requests yet"));
      }
      sessionsHost.replaceChildren();
      const sessions = Object.entries(pluginStatus?.sessions ?? {}).sort((a, b) => amount(b[1].lastAt) - amount(a[1].lastAt)).slice(0, 5);
      if (!sessions.length) {
        sessionsHost.append(el2("div", "fb-empty", "No session ledger yet."));
      } else {
        const table = el2("table", "fb-table");
        const head = el2("thead");
        const headRow = el2("tr");
        headRow.append(
          el2("th", "", "Chat"),
          el2("th", "fb-num", "Guarded"),
          el2("th", "fb-num", "Cum. pruned"),
          el2("th", "fb-num", "Last")
        );
        head.append(headRow);
        const body = el2("tbody");
        for (const [id, session] of sessions) {
          const row = el2("tr");
          if (id === sessionId()) row.dataset.current = "true";
          const name = el2("td");
          name.textContent = id === sessionId() ? "this chat" : shortSessionId(id);
          name.title = id;
          row.append(
            name,
            el2("td", "fb-num", String(amount(session.runs))),
            el2("td", "fb-num", fmtCompact(amount(session.prunedChars))),
            el2("td", "fb-num", fmtAge(session.lastAt))
          );
          body.append(row);
        }
        table.append(head, body);
        sessionsHost.append(table);
      }
    };
    render();
    powerUpdaters["metrics"] = render;
  }
  var specs = [
    {
      id: "context-keeper",
      icon: "shield",
      title: "Context Keeper",
      tag: "Live context radar, pruning, skill + recent-message protection",
      tab: "context",
      build: buildContextKeeper,
      status: () => {
        if (!config.powers.context.enabled) return { label: "Off", tone: "neutral" };
        if (!hasSession()) return { label: "Armed", tone: "primary" };
        if (!pluginIsLive()) return { label: "Stale", tone: "warning" };
        return { label: "Guarding", tone: "success" };
      }
    },
    {
      id: "handoff",
      icon: "passport",
      title: "Handoff Passport",
      tag: "Move a session\u2019s brain into a clean context",
      tab: "context",
      build: buildHandoff,
      status: () => handoffState.messages?.length ? { label: "Loaded", tone: "success" } : { label: "On demand", tone: "neutral" }
    },
    {
      id: "slice",
      icon: "layers",
      title: "Slice Forge",
      tag: "Goal \u2192 tiny verifiable steps, acceptance checks, first prompt",
      tab: "build",
      build: buildSliceForge,
      status: () => powerResults["slice"] ? { label: "Ready", tone: "success" } : { label: "On demand", tone: "neutral" }
    },
    {
      id: "bug",
      icon: "bug",
      title: "Bug Hunter",
      tag: "Repro first, ranked causes, verification, regression guard",
      tab: "build",
      build: buildBugHunter,
      status: () => powerResults["bug"] ? { label: "Ready", tone: "success" } : { label: "On demand", tone: "neutral" }
    },
    {
      id: "red-pen",
      icon: "pen",
      title: "Red Pen",
      tag: "Correctness, edge cases, security, tests \u2014 on a selection",
      tab: "build",
      build: buildRedPen,
      status: () => redState.code.trim() ? { label: "Loaded", tone: "success" } : { label: "On demand", tone: "neutral" }
    },
    {
      id: "game",
      icon: "gamepad",
      title: "Game Feel Lab",
      tag: "Juice pass, tuning matrix, playtest kit",
      tab: "build",
      build: buildGameFeel,
      status: () => powerResults["game"] ? { label: "Ready", tone: "success" } : { label: "On demand", tone: "neutral" }
    },
    {
      id: "character",
      icon: "user",
      title: "Character Forge",
      tag: "Want, need, wound, contradiction, voice \u2014 a playable person",
      tab: "studio",
      build: buildCharacterForge,
      status: () => characters.length ? { label: `${characters.length} saved`, tone: "primary" } : { label: "On demand", tone: "neutral" }
    },
    {
      id: "prose",
      icon: "quill",
      title: "Prose Atelier",
      tag: "Line polish, scene diagnosis, voice matching",
      tab: "studio",
      build: buildProse,
      status: () => powerResults["prose"] ? { label: "Ready", tone: "success" } : { label: "On demand", tone: "neutral" }
    },
    {
      id: "idea",
      icon: "bulb",
      title: "Idea Distiller",
      tag: "Score sparks, blend two, promote the winner",
      tab: "studio",
      build: buildIdeaDistiller,
      status: () => sparks.length ? { label: `${sparks.length} sparks`, tone: "primary" } : { label: "On demand", tone: "neutral" }
    },
    {
      id: "model",
      icon: "cpu",
      title: "Model Fit",
      tag: "Sampling presets, a small-model contract, and a lean tool surface",
      tab: "tune",
      build: buildModelFit,
      status: () => {
        if (!config.powers.model.enabled) return { label: "Off", tone: "neutral" };
        if (!hasSession()) return { label: "Armed", tone: "primary" };
        if (!pluginIsLive()) return { label: "Stale", tone: "warning" };
        if (modelApplies()) return { label: "Live", tone: "success" };
        const last = pluginStatus?.last;
        const hidingNow = Boolean(last && last.sessionId === sessionId() && (last.hidden?.length ?? 0) > 0);
        if (hidingNow) return { label: "Tools live", tone: "success" };
        return { label: "Armed", tone: "warning" };
      }
    },
    {
      id: "metrics",
      icon: "chart",
      title: "Pruning Ledger",
      tag: "Exactly what was pruned, where it went, and what it saved",
      tab: "metrics",
      build: buildMetrics,
      status: () => {
        if (!pluginStatus) return { label: "No data", tone: "neutral" };
        if (pluginStatus.stopped) return { label: "Stopped", tone: "warning" };
        if (!pluginIsLive()) return { label: "Stale", tone: "warning" };
        const entry = currentPluginSession();
        if (!entry || amount(entry.runs) === 0) return { label: "Waiting", tone: "primary" };
        const lastSaved = amount(entry.lastSaved);
        return lastSaved > 0 ? { label: `${fmtCompact(lastSaved)} pruned now`, tone: "success" } : { label: "Watching", tone: "primary" };
      }
    }
  ];
  var TAB_DEFS = [
    { id: "context", label: "Context" },
    { id: "build", label: "Build" },
    { id: "studio", label: "Studio" },
    { id: "tune", label: "Tune" },
    { id: "metrics", label: "Metrics" }
  ];
  var TABS = TAB_DEFS.map((tab) => ({
    ...tab,
    count: specs.filter((spec) => spec.tab === tab.id).length
  }));
  var TAB_PANES = {};
  function buildPowerCard(spec, pane) {
    const card = el2("section", "fb-power");
    card.dataset.open = "false";
    const head = el2("button", "fb-power-head");
    head.type = "button";
    head.setAttribute("aria-expanded", "false");
    const iconTile = el2("span", "fb-power-ico");
    iconTile.append(icon2(spec.icon));
    const text = el2("span");
    text.append(el2("span", "fb-power-name", spec.title), el2("span", "fb-power-tag", spec.tag));
    text.style.display = "flex";
    text.style.flexDirection = "column";
    text.style.minWidth = "0";
    const badgeHost = el2("span", "fb-badge-host");
    const badge = mountBadge(badgeHost, spec.status());
    const chevron = el2("span", "fb-power-chev");
    chevron.append(icon2("chevron"));
    head.append(iconTile, text, badgeHost, chevron);
    const body = el2("div", "fb-power-body");
    body.hidden = true;
    card.append(head, body);
    pane.append(card);
    let built = false;
    const ensureBuilt = () => {
      if (built) return;
      built = true;
      try {
        spec.build(body);
      } catch (error) {
        body.append(el2("div", "fb-note", describeError(error)));
      }
    };
    const setOpen = (open) => {
      card.dataset.open = String(open);
      head.setAttribute("aria-expanded", String(open));
      body.hidden = !open;
      if (open) {
        ensureBuilt();
        activePower = spec.id;
        if (booted) card.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
      if (!open && activePower === spec.id) activePower = null;
    };
    head.addEventListener("click", () => {
      const next = card.dataset.open !== "true";
      if (next) {
        for (const [id, entry] of powerCards) {
          if (id !== spec.id) entry.close();
        }
      }
      setOpen(next);
    });
    const refresh = () => {
      try {
        badge.update(spec.status());
      } catch {
      }
    };
    powerCards.set(spec.id, { open: () => setOpen(true), close: () => setOpen(false), refresh, element: card });
    if (spec.id === "context-keeper") setOpen(true);
  }
  function buildShell() {
    try {
      tabsHandle?.dispose();
    } catch {
    }
    tabsHandle = null;
    for (const card of powerCards.values()) card.close();
    powerCards.clear();
    for (const key of Object.keys(powerUpdaters)) delete powerUpdaters[key];
    for (const key of Object.keys(resultClearers)) delete resultClearers[key];
    for (const key of Object.keys(handles)) delete handles[key];
    for (const key of Object.keys(TAB_PANES)) delete TAB_PANES[key];
    for (const key of Object.keys(modelFieldHandles)) delete modelFieldHandles[key];
    modelToolChecks.length = 0;
    modelPresetHandle = null;
    modelReasoningHandle = null;
    modelCapOutputHandle = null;
    modelExtraToolsHandle = null;
    modelToolLine = null;
    modelModelLine = null;
    sessionNameEl = null;
    sessionDot = null;
    sessionActivityEl = null;
    sessionModelChip = null;
    sessionMeterText = null;
    sessionStatsEl = null;
    sessionGuardEl = null;
    sessionPowersEl = null;
    try {
      sessionProgress?.dispose();
    } catch {
    }
    sessionProgress = null;
    activePower = null;
    try {
      bannerHandle?.dispose();
    } catch {
    }
    bannerHandle = null;
    root.replaceChildren();
    const shell = el2("div", "fb-shell");
    const head = el2("header", "fb-head");
    const mark = el2("div", "fb-mark-tile");
    mark.append(icon2("fox"));
    const headText = el2("div", "fb-head-text");
    headText.append(
      el2("h1", "fb-title", "Fox Box"),
      el2("p", "fb-subtitle", "Ten sharp little powers. A ledger for what they save.")
    );
    head.append(mark, headText, el2("span", "fb-version", `v${VERSION}`));
    shell.append(head, buildBannerHost(), buildSessionStrip());
    const tabsHost = el2("div", "fb-tabs-host");
    shell.append(tabsHost);
    const panes = el2("div");
    for (const tab of TABS) {
      const pane = el2("div", "fb-tabpane");
      pane.hidden = tab.id !== activeTab;
      TAB_PANES[tab.id] = pane;
      panes.append(pane);
    }
    shell.append(panes);
    tabsHandle = mountTabs(tabsHost, {
      items: TABS,
      activeId: activeTab,
      trackBackground: true,
      onChange: (id) => {
        activeTab = id;
        for (const [tabId, pane] of Object.entries(TAB_PANES)) pane.hidden = tabId !== id;
        tabsHandle?.update({ activeId: id });
      }
    });
    for (const spec of specs) {
      buildPowerCard(spec, TAB_PANES[spec.tab] ?? TAB_PANES["context"]);
    }
    shell.append(buildFooter());
    root.append(shell);
  }
  function focusPower(id) {
    const spec = specs.find((item) => item.id === id);
    if (!spec) return;
    activeTab = spec.tab;
    for (const [tabId, pane] of Object.entries(TAB_PANES)) pane.hidden = tabId !== activeTab;
    tabsHandle?.update({ activeId: activeTab });
    const card = powerCards.get(id);
    if (card) {
      for (const [otherId, other] of powerCards) {
        if (otherId !== id) other.close();
      }
      card.open();
    }
  }
  function refreshAll() {
    try {
      updateSessionUI();
    } catch {
    }
    for (const card of powerCards.values()) card.refresh();
    for (const update of Object.values(powerUpdaters)) {
      try {
        update();
      } catch {
      }
    }
    if (footerPlugin) {
      try {
        footerPlugin.replaceChildren();
        const plugin = pluginLabel();
        const chip = el2("span", "fb-chip", plugin.text);
        chip.dataset.tone = plugin.tone;
        footerPlugin.append(chip);
      } catch {
      }
    }
  }
  function captureSelection(text, target) {
    if (target === "red-pen") {
      redState.code = text.slice(0, 2e4);
      redState.label = "Selected text";
      redState.path = "";
      redState.range = "";
      redState.result = "";
      clearPowerResult("red-pen");
      handles["red-code"]?.update({ value: redState.code });
      handles["red-capture"]?.update({ value: redState.label });
    } else if (target === "bug") {
      bugState.symptom = text.slice(0, 8e3);
      bugState.result = "";
      clearPowerResult("bug");
      handles["bug-symptom"]?.update({ value: bugState.symptom });
    } else {
      proseState.text = text.slice(0, 16e3);
      proseState.source = "Selected text";
      proseState.result = "";
      clearPowerResult("prose");
      handles["prose-text"]?.update({ value: proseState.text });
    }
    focusPower(target);
    toast("info", "Selection loaded.");
  }
  async function captureFile(path, range) {
    const relative = path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) ? relativeToProject(path) : path;
    const safeRelative = relative ? normalizeGuestPath(relative) : "";
    if (!safeRelative || safeRelative.split("/").includes("..")) {
      showBanner("error", "That file is outside the project", "Fox Box can only read files inside the open project.");
      return;
    }
    try {
      await loadRedPenFile(safeRelative, range);
      focusPower("red-pen");
      toast("info", "File loaded for review.");
    } catch (error) {
      notifyError(error, "Reading the file");
    }
  }
  function handleItem(item) {
    if (!item) return;
    try {
      handleItemUnsafe(item);
    } catch (error) {
      notifyError(error, "Loading the item");
    }
  }
  function handleItemUnsafe(item) {
    actionItem = item;
    const data = item.data && typeof item.data === "object" ? item.data : typeof item.data === "string" ? (() => {
      try {
        return JSON.parse(item.data);
      } catch {
        return null;
      }
    })() : null;
    if (data?.power === "character" && typeof data.characterId === "string") {
      const character = characters.find((entry) => entry.id === data.characterId);
      if (character) {
        selectedCharacterId = character.id;
        focusPower("character");
        refreshAll();
        toast("info", "Character reloaded from the chip.");
      } else {
        toast("info", "That character is no longer saved.");
      }
      return;
    }
    const action = item.action ?? "";
    if (action === "handoff" || item.kind === "session") {
      const captured = Array.isArray(item.messages) ? item.messages.filter((message) => message && typeof message === "object").map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        text: String(message.text ?? "")
      })) : [];
      handoffState.messages = captured.length ? captured : null;
      handoffState.title = String(item.sessionTitle ?? item.title ?? "this session").slice(0, 200);
      handoffState.truncated = Boolean(item.truncated);
      handoffState.result = "";
      clearPowerResult("handoff");
      powerResults["handoff"] = Boolean(handoffState.messages?.length);
      focusPower("handoff");
      if (handoffState.messages?.length) toast("info", "Conversation captured.");
      refreshAll();
      return;
    }
    if (action === "hunt-bug" && typeof item.text === "string") {
      captureSelection(item.text, "bug");
      return;
    }
    if (action === "polish-prose" && typeof item.text === "string") {
      captureSelection(item.text, "prose");
      return;
    }
    if ((action === "red-pen-selection" || item.kind === "selection") && typeof item.text === "string") {
      captureSelection(item.text, "red-pen");
      return;
    }
    if ((action === "review-file" || item.kind === "file") && typeof item.path === "string") {
      void captureFile(item.path);
      return;
    }
    if ((action === "red-pen-diff" || item.kind === "diff") && typeof item.path === "string") {
      const start = Number(item.startLine ?? 1);
      const end = Number(item.endLine ?? start);
      void captureFile(item.path, { start, end });
      return;
    }
    if (item.kind === "message" && typeof item.text === "string") {
      captureSelection(item.text, "red-pen");
    }
  }
  function stopSessions() {
    sessionsToken += 1;
    if (sessionsRetryTimer !== void 0) {
      window.clearTimeout(sessionsRetryTimer);
      sessionsRetryTimer = void 0;
    }
    try {
      sessionsStop?.();
    } catch {
    }
    sessionsStop = null;
    currentSessionRecord = null;
  }
  async function subscribeSessions() {
    stopSessions();
    const id = projectId;
    if (!id) return;
    const token = sessionsToken;
    try {
      const stop = await host.onSessions(id, (snapshot) => {
        if (token !== sessionsToken || id !== projectId) return;
        const list = Array.isArray(snapshot?.sessions) ? snapshot.sessions : [];
        currentSessionRecord = list.find((session) => session.id === sessionId()) ?? null;
        refreshAll();
      });
      if (token !== sessionsToken || id !== projectId) {
        try {
          stop();
        } catch {
        }
        return;
      }
      sessionsStop = stop;
    } catch (error) {
      if (token === sessionsToken) currentSessionRecord = null;
      const code = errorCode(error);
      if (token === sessionsToken && id === projectId && code !== "NOT_GRANTED" && code !== "UNSUPPORTED") {
        if (sessionsRetryTimer !== void 0) window.clearTimeout(sessionsRetryTimer);
        sessionsRetryTimer = window.setTimeout(() => {
          sessionsRetryTimer = void 0;
          if (token === sessionsToken && id === projectId) void subscribeSessions();
        }, 5e3);
      }
    }
  }
  function clearProjectRetry() {
    if (projectRetryTimer !== void 0) {
      window.clearTimeout(projectRetryTimer);
      projectRetryTimer = void 0;
    }
  }
  function scheduleProjectRetry() {
    if (projectRetryTimer !== void 0 || !ready?.directory) return;
    const delay = projectRetryDelay;
    projectRetryDelay = Math.min(6e4, projectRetryDelay * 2);
    projectRetryTimer = window.setTimeout(() => {
      projectRetryTimer = void 0;
      if (!ready?.directory) return;
      void syncProject().catch(() => {
      });
    }, delay);
  }
  async function syncProject() {
    const seq = ++syncSeq;
    clearProjectRetry();
    const directory = ready?.directory;
    const nextStatusKey = statusFileKey(directory);
    if (nextStatusKey !== statusKey) {
      statusKey = nextStatusKey;
      pluginStatus = null;
      stopSessions();
    }
    const fallbackKey = normalizeDir(directory);
    projectKey = fallbackKey;
    projectScan = null;
    handles["context-brief"]?.update({ value: currentBrief(), disabled: true });
    if (!directory) {
      projectId = null;
      projectRetryDelay = 5e3;
      handles["context-brief"]?.update({ value: currentBrief(), disabled: false });
      stopSessions();
      refreshAll();
      return;
    }
    let resolved = false;
    let retryable = true;
    try {
      const projects = await host.listProjects();
      if (seq !== syncSeq) return;
      const match = (projects.projects ?? []).find(
        (project) => normalizeDir(project.directory) === normalizeDir(directory)
      );
      projectId = match?.id ?? null;
      projectKey = normalizeDir(match?.directory) || fallbackKey;
      resolved = Boolean(projectId);
    } catch (error) {
      if (seq !== syncSeq) return;
      projectId = null;
      const code = errorCode(error);
      retryable = code !== "NOT_GRANTED" && code !== "UNSUPPORTED";
    }
    if (seq !== syncSeq) return;
    handles["context-brief"]?.update({ value: currentBrief(), disabled: false });
    if (!resolved) {
      if (retryable) scheduleProjectRetry();
    } else {
      projectRetryDelay = 5e3;
      if (sessionsRetryTimer !== void 0) {
        window.clearTimeout(sessionsRetryTimer);
        sessionsRetryTimer = void 0;
      }
      await subscribeSessions();
      if (seq !== syncSeq) return;
    }
    refreshAll();
  }
  async function refreshPluginStatus() {
    if (document.hidden || statusBusy) return false;
    statusBusy = true;
    let read = false;
    const key = statusFileKey(ready?.directory);
    if (key !== statusKey) {
      statusKey = key;
      pluginStatus = null;
    }
    try {
      let content = null;
      const statusPaths = ready?.directory ? [projectStatusPath()] : [projectStatusPath(), LEGACY_STATUS_PATH];
      for (const path of statusPaths) {
        try {
          const result = await host.readFile(path);
          content = result.content;
          break;
        } catch (error) {
          if (errorCode(error) !== "NOT_FOUND") throw error;
        }
      }
      if (content) {
        const parsed = JSON.parse(content.replace(/^\uFEFF/, ""));
        if (parsed && typeof parsed === "object") {
          pluginStatus = parsed;
          read = true;
        }
      } else {
        pluginStatus = null;
      }
    } catch (error) {
    } finally {
      statusBusy = false;
    }
    try {
      refreshAll();
    } catch {
    }
    return read;
  }
  function isCharacter(value) {
    const id = value?.id;
    return Boolean(value) && typeof value === "object" && typeof id === "string" && id.length > 0 && id.length <= 100;
  }
  function isSpark(value) {
    const id = value?.id;
    return Boolean(value) && typeof value === "object" && typeof id === "string" && id.length > 0 && id.length <= 100;
  }
  function normalizeCharacter(value) {
    const short = (input, max = 600) => String(input ?? "").slice(0, max);
    return {
      id: value.id,
      name: short(value.name),
      role: short(value.role),
      pronouns: short(value.pronouns),
      era: short(value.era),
      look: short(value.look, 1200),
      want: short(value.want),
      need: short(value.need),
      wound: short(value.wound),
      contradiction: short(value.contradiction),
      secret: short(value.secret),
      arc: short(value.arc),
      rhythm: short(value.rhythm),
      vocabulary: short(value.vocabulary),
      tics: short(value.tics),
      taboo: short(value.taboo),
      relationships: short(value.relationships, 1200),
      updatedAt: Number(value.updatedAt) || Date.now()
    };
  }
  function normalizeSpark(value) {
    const scores = value.scores;
    const spark = {
      id: value.id,
      title: String(value.title ?? "").slice(0, 160),
      note: String(value.note ?? "").slice(0, NOTE_MAX),
      createdAt: Number(value.createdAt) || Date.now()
    };
    if (scores && typeof scores === "object") {
      spark.scores = {
        novelty: clampInt(scores.novelty, 1, 5, 3),
        usefulness: clampInt(scores.usefulness, 1, 5, 3),
        fit: clampInt(scores.fit, 1, 5, 3),
        effort: clampInt(scores.effort, 1, 5, 3)
      };
    }
    return spark;
  }
  async function loadStorage() {
    characters = [];
    sparks = [];
    characterCache.clear();
    sparkCache.clear();
    retainedCharacterIds.clear();
    retainedSparkIds.clear();
    charactersLoaded = false;
    sparksLoaded = false;
    charactersSaveWarned = false;
    sparksSaveWarned = false;
    let legacyCharacters = false;
    let legacySparks = false;
    try {
      const index = await host.storage.get(CHARACTER_INDEX_KEY);
      if (Array.isArray(index)) {
        const ids = index.filter((id) => typeof id === "string").slice(0, 40);
        const loaded = await Promise.all(
          ids.map((id) => host.storage.get(characterKey(id)).catch(() => void 0))
        );
        characters = loaded.filter(isCharacter).map(normalizeCharacter).slice(0, 40);
        for (let position = 0; position < ids.length; position += 1) {
          if (!isCharacter(loaded[position])) retainedCharacterIds.add(ids[position]);
        }
        selectedCharacterId = characters[0]?.id ?? null;
        charactersLoaded = true;
      } else {
        const legacy = await host.storage.get("characters");
        if (Array.isArray(legacy)) {
          legacyCharacters = true;
          characters = legacy.filter(isCharacter).map(normalizeCharacter).slice(0, 40);
          selectedCharacterId = characters[0]?.id ?? null;
          charactersLoaded = true;
          if (characters.length) {
            charactersTouched = true;
            persistCharacters();
          }
        } else if (legacy === void 0) {
          charactersLoaded = true;
        }
      }
    } catch {
      charactersLoaded = false;
    }
    try {
      const index = await host.storage.get(SPARK_INDEX_KEY);
      if (Array.isArray(index)) {
        const ids = index.filter((id) => typeof id === "string").slice(0, 60);
        const loaded = await Promise.all(
          ids.map((id) => host.storage.get(sparkKey(id)).catch(() => void 0))
        );
        sparks = loaded.filter(isSpark).map(normalizeSpark).slice(0, 60);
        for (let position = 0; position < ids.length; position += 1) {
          if (!isSpark(loaded[position])) retainedSparkIds.add(ids[position]);
        }
        sparksLoaded = true;
      } else {
        const legacy = await host.storage.get("sparks");
        if (Array.isArray(legacy)) {
          legacySparks = true;
          sparks = legacy.filter(isSpark).map(normalizeSpark).slice(0, 60);
          sparksLoaded = true;
          if (sparks.length) {
            sparksTouched = true;
            persistSparks();
          }
        } else if (legacy === void 0) {
          sparksLoaded = true;
        }
      }
    } catch {
      sparksLoaded = false;
    }
    if (!legacyCharacters) {
      characterCache.clear();
      for (const character of characters) characterCache.set(character.id, JSON.stringify(character));
    }
    if (!legacySparks) {
      sparkCache.clear();
      for (const spark of sparks) sparkCache.set(spark.id, JSON.stringify(spark));
    }
  }
  async function boot(ctx) {
    if (booting || booted) return;
    booting = true;
    try {
      await loadConfig();
      await loadStorage();
      buildShell();
      if (configNewer) {
        showBanner(
          "warning",
          "Rules need a newer Fox Box",
          "This config file was written by a newer Fox Box version. Update the extension before saving; changes stay in memory for now."
        );
        configSaveWarned = true;
      } else if (!configLoaded) {
        showBanner(
          "warning",
          "Rules are not saved",
          "Fox Box could not load its config file, so changes stay in memory only. Fix or remove ~/.config/openchamber/fox-box/config.json, or approve Fox Box's file access, then reopen the panel."
        );
        configSaveWarned = true;
      } else if (!charactersLoaded || !sparksLoaded) {
        showBanner(
          "warning",
          "Saved data could not be read",
          "Fox Box will not overwrite saved characters or ideas. Reopen the panel to try loading them again."
        );
      }
      booted = true;
      booting = false;
      await syncProject();
      lastDirectory = normalizeDir(ctx.directory);
      void refreshPluginStatus();
      if (pendingAction) {
        const item = pendingAction;
        pendingAction = null;
        handleItem(item);
      } else if (ctx.item) {
        handleItem(ctx.item);
      }
      if (statusTimer !== void 0) window.clearInterval(statusTimer);
      statusTimer = window.setInterval(() => {
        if (!document.hidden) void refreshPluginStatus();
      }, 4e3);
    } catch (error) {
      booting = false;
      booted = false;
      stopSessions();
      if (statusTimer !== void 0) {
        window.clearInterval(statusTimer);
        statusTimer = void 0;
      }
      root.replaceChildren();
      const box = el2("div", "fb-empty");
      box.textContent = `Fox Box could not start. ${describeError(error)}`;
      root.append(box);
    }
  }
  host.onReady((ctx) => {
    if (!ctx || typeof ctx !== "object") return;
    ready = ctx;
    try {
      applyHostReady(ctx, document.documentElement);
    } catch {
    }
    document.body.dataset.theme = ctx.theme?.mode ?? "dark";
    document.body.dataset.surface = ctx.surface ?? "panel";
    if (!booted) {
      void boot(ctx);
      return;
    }
    refreshAll();
    void syncProjectIfNeeded(ctx).catch(() => {
    });
  });
  async function syncProjectIfNeeded(ctx) {
    const directory = normalizeDir(ctx.directory);
    if (directory !== lastDirectory) {
      lastDirectory = directory;
      await syncProject();
    }
  }
  host.onDirectory((directory) => {
    if (!ready) return;
    ready.directory = directory;
    lastDirectory = normalizeDir(directory);
    void syncProject().catch(() => {
    });
  });
  host.onSession((session) => {
    if (!ready) return;
    if (ready.session?.id !== session?.id) currentSessionRecord = null;
    ready.session = session;
    refreshAll();
  });
  host.onAction((item) => {
    if (!booted) {
      pendingAction = item;
      return;
    }
    handleItem(item);
  });
  host.onItem((item) => {
    if (!item) return;
    if (!booted) {
      pendingAction = item;
      return;
    }
    handleItem(item);
  });
  window.addEventListener("pagehide", () => {
    stopSessions();
    clearProjectRetry();
    if (statusTimer !== void 0) {
      window.clearInterval(statusTimer);
      statusTimer = void 0;
    }
    const hadConfigTimer = configTimer !== void 0;
    if (configTimer !== void 0) {
      window.clearTimeout(configTimer);
      configTimer = void 0;
    }
    const writes = [];
    if (hadConfigTimer || configPending || savingConfig) writes.push(saveConfigNow());
    if (charactersTouched || charactersSaving) writes.push(saveCharactersNow());
    if (sparksTouched || sparksSaving) writes.push(saveSparksNow());
    void Promise.allSettled(writes).finally(() => {
      try {
        bannerHandle?.dispose();
      } catch {
      }
      try {
        host.dispose();
      } catch {
      }
    });
  });
})();
