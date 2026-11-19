/*
 * Fox Box server plugin.
 *
 * Deliberately registers no tools. It only edits the outgoing model request:
 * context protection/pruning, a project focus brief, Qwen-family request
 * settings, a short small-model contract, and an optional lean tool surface.
 *
 * The extension panel writes config.json and reads this project's status file.
 * Both live in ~/.config/openchamber/fox-box/ (FOXBOX_HOME overrides it for tests).
 */

const DEFAULT_CONTRACT = [
  "Fox Box small-model contract:",
  "- Work in small, verifiable steps. Do not start a second step before the first has a visible result.",
  "- Read only what the current step needs. Prefer one tool call at a time, and never repeat a call that already answered.",
  "- Before claiming success, run the check that proves it. If you cannot run it, say what remains unverified.",
  "- Keep chat replies short. Put exploration in tools, not in prose. Ask one precise question only when blocked.",
].join("\n");

/* Keep these values in step with panel/main.ts QWEN_PRESETS. */
const MODEL_PRESETS = {
  "qwen-thinking": {
    temperature: 1.0,
    topP: 0.95,
    topK: 20,
    presencePenalty: 0,
    frequencyPenalty: 0,
    maxOutputTokens: 8192,
    reasoningEffort: "xhigh",
  },
  "qwen-instruct": {
    temperature: 0.7,
    topP: 0.8,
    topK: 20,
    presencePenalty: 1.5,
    frequencyPenalty: 0,
    maxOutputTokens: 8192,
    reasoningEffort: "none",
  },
  balanced: {
    temperature: 0.4,
    topP: 0.9,
    topK: 40,
    presencePenalty: 0,
    frequencyPenalty: 0,
    maxOutputTokens: 8192,
    reasoningEffort: "medium",
  },
};

const STATE = {
  version: 3,
  stopped: false,
  loadedAt: 0,
  updatedAt: 0,
  totals: {
    context: 0,
    toolTrims: 0,
    prunes: 0,
    prunedChars: 0,
    model: 0,
    collapsed: 0,
    collapsedChars: 0,
    /* The panel's ledger: exact character counts measured before and after the request edit. */
    originalChars: 0,
    keptChars: 0,
    oldChars: 0,
    freshChars: 0,
    otherChars: 0,
    toolResults: 0,
    trimmedResults: 0,
  },
  sessions: {},
  last: null,
};

let pathCache = null;
let configCache = { at: 0, mtime: -1, data: null };
let dirty = false;
let lastStatusWrite = 0;
let projectKey = "";

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeDir(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

/*
 * Status is per project, not global. Several OpenChamber projects can run their
 * own managed OpenCode process, and each writes this file; a single status.json
 * would be overwritten by whichever process flushed last, making the panel lose
 * the current session's ledger for a few seconds. FNV-1a keeps the name stable
 * and identical in the panel (panel/main.ts) without sharing code.
 */
function statusFileName(directory) {
  const key = normalizeDir(directory) || "global";
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `status-${(hash >>> 0).toString(36)}.json`;
}

function isQwenModel(value) {
  return /qwen|unsloth|flash[-_ ]?next|iq4_xs|iq3_xxs|ud-q[2-8]/i.test(String(value || ""));
}

/* Bumped when a stored default changes; old configs are migrated in normalizeConfig. */
const CONFIG_VERSION = 2;

function defaults() {
  return {
    version: CONFIG_VERSION,
    powers: {
      context: {
        enabled: true,
        protectSkills: true,
        keepRecent: 10,
        protectedReads: 6,
        collapseDuplicates: true,
        trimToolOutput: true,
        maxToolOutput: 48000,
        maxOldToolOutput: 6000,
        protectPaths: "",
        briefs: {},
      },
      model: {
        enabled: true,
        applyToQwenOnly: true,
        temperature: 1.0,
        topP: 0.95,
        topK: 20,
        presencePenalty: 0,
        frequencyPenalty: 0,
        maxOutputTokens: 8192,
        capOutput: true,
        reasoningEffort: "xhigh",
        contractEnabled: true,
        contract: DEFAULT_CONTRACT,
        hideTools: [],
      },
    },
  };
}

function normalizeConfig(input) {
  const base = defaults();
  const inputVersion = clampInt(input && input.version, 1, CONFIG_VERSION, 1);
  const context = input && input.powers && input.powers.context ? input.powers.context : {};
  const model = input && input.powers && input.powers.model ? input.powers.model : {};
  const preset = ["qwen-thinking", "qwen-instruct", "balanced", "custom"].includes(model.preset)
    ? model.preset
    : "qwen-thinking";
  const presetValues = MODEL_PRESETS[preset] ?? MODEL_PRESETS["qwen-thinking"];
  const briefs = {};
  if (context.briefs && typeof context.briefs === "object" && !Array.isArray(context.briefs)) {
    const entries = Object.entries(context.briefs).slice(0, 60);
    for (const [key, value] of entries) {
      if (typeof value === "string" && value.trim()) briefs[String(key).slice(0, 260)] = value.slice(0, 1800);
    }
  }
  const hideTools = [];
  if (Array.isArray(model.hideTools)) {
    for (const name of model.hideTools.slice(0, 24)) {
      if (typeof name !== "string" || !name.trim()) continue;
      const clean = name.trim().slice(0, 64);
      if (clean === "todo") {
        hideTools.push("todowrite", "todoread");
      } else if (clean === "task" || clean === "subagent") {
        /* V1 called the subagent spawner "task"; V2 calls it "subagent". Carry an old
           config forward so a hide toggle saved under either name keeps working. */
        hideTools.push("subagent", "task");
      } else {
        hideTools.push(clean);
      }
    }
  }
  /* Version 1 shipped a 16k default and options that stopped at 32k, which made small models
     re-read files. Upgrade every sub-48k v1 cap once; the panel can still choose any value after. */
  const legacyCap = context.maxToolOutput === null || context.maxToolOutput === undefined
    ? Number.NaN
    : Number(context.maxToolOutput);
  const freshCapIsLegacyDefault =
    inputVersion < CONFIG_VERSION && (!Number.isFinite(legacyCap) || (legacyCap > 0 && legacyCap < 48000));
  return {
    version: CONFIG_VERSION,
    powers: {
      context: {
        enabled: context.enabled !== false,
        protectSkills: context.protectSkills !== false,
        keepRecent: clampInt(context.keepRecent ?? base.powers.context.keepRecent, 2, 40, base.powers.context.keepRecent),
        protectedReads: clampInt(context.protectedReads ?? 6, 0, 12, base.powers.context.protectedReads),
        collapseDuplicates: context.collapseDuplicates !== false,
        trimToolOutput: context.trimToolOutput !== false,
        maxToolOutput: freshCapIsLegacyDefault
          ? base.powers.context.maxToolOutput
          : clampInt(context.maxToolOutput ?? base.powers.context.maxToolOutput, 2000, 256000, base.powers.context.maxToolOutput),
        maxOldToolOutput: clampInt(
          context.maxOldToolOutput ?? base.powers.context.maxOldToolOutput,
          1000,
          64000,
          base.powers.context.maxOldToolOutput,
        ),
        protectPaths: typeof context.protectPaths === "string" ? context.protectPaths.slice(0, 4000) : "",
        briefs,
      },
      model: {
        enabled: model.enabled !== false,
        applyToQwenOnly: model.applyToQwenOnly !== false,
        temperature: clampNumber(model.temperature ?? presetValues.temperature, 0, 2, presetValues.temperature),
        topP: clampNumber(model.topP ?? presetValues.topP, 0, 1, presetValues.topP),
        topK: clampInt(model.topK ?? presetValues.topK, 0, 200, presetValues.topK),
        presencePenalty: clampNumber(
          model.presencePenalty ?? presetValues.presencePenalty,
          -2,
          2,
          presetValues.presencePenalty,
        ),
        frequencyPenalty: clampNumber(
          model.frequencyPenalty ?? presetValues.frequencyPenalty,
          -2,
          2,
          presetValues.frequencyPenalty,
        ),
        maxOutputTokens: clampInt(
          model.maxOutputTokens ?? presetValues.maxOutputTokens,
          256,
          64000,
          presetValues.maxOutputTokens,
        ),
        capOutput: model.capOutput !== false,
        reasoningEffort:
          typeof model.reasoningEffort === "string"
            ? model.reasoningEffort.slice(0, 16)
            : presetValues.reasoningEffort,
        contractEnabled: model.contractEnabled !== false,
        contract:
          typeof model.contract === "string" && model.contract.trim()
            ? model.contract.slice(0, 3500)
            : DEFAULT_CONTRACT,
        hideTools: Array.from(new Set(hideTools)).slice(0, 24),
      },
    },
  };
}

async function paths() {
  if (pathCache) return pathCache;
  const os = await import("node:os");
  const path = await import("node:path");
  const base =
    process.env.FOXBOX_HOME || path.join(os.homedir(), ".config", "openchamber", "fox-box");
  pathCache = {
    base,
    config: path.join(base, "config.json"),
    status: path.join(base, statusFileName(projectKey)),
  };
  return pathCache;
}

async function readConfig() {
  const now = Date.now();
  try {
    const fs = await import("node:fs/promises");
    const where = await paths();
    /* Read the small config on every request: a settings change must apply immediately,
       and an atomic replace always leaves a complete file to read. */
    const raw = await fs.readFile(where.config, "utf8");
    const parsed = normalizeConfig(JSON.parse(raw.replace(/^\uFEFF/, "")));
    configCache = { at: now, mtime: 0, data: parsed };
    return parsed;
  } catch (error) {
    /* A missing file means defaults; other errors usually mean a transient read or replace
       window, so keep the last good rules instead of silently dropping protections. */
    const code = error && typeof error === "object" && "code" in error ? String(error.code || "") : "";
    if (configCache.data && code !== "ENOENT") {
      configCache.at = now;
      return configCache.data;
    }
    const fallback = defaults();
    configCache = { at: now, mtime: -1, data: fallback };
    return fallback;
  }
}

function markDirty() {
  dirty = true;
}

let flushChain = Promise.resolve();

async function writeStatusNow() {
  if (!dirty) return;
  dirty = false;
  let temp = "";
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const where = await paths();
    await fs.mkdir(where.base, { recursive: true });
    STATE.updatedAt = Date.now();
    /* Write beside the target and rename: the panel polls this file and must never parse a torn write. */
    temp = path.join(where.base, `.status-${process.pid}-${Date.now()}.json`);
    await fs.writeFile(temp, JSON.stringify(STATE), "utf8");
    await fs.rename(temp, where.status);
    temp = "";
    lastStatusWrite = Date.now();
  } catch {
    // Status is a convenience; never disturb a request because it cannot be written.
    dirty = true;
    if (temp) {
      try {
        const fs = await import("node:fs/promises");
        await fs.unlink(temp);
      } catch {
        // Best effort.
      }
    }
  }
}

function flushStatus(force) {
  if (!dirty && !force) return flushChain;
  if (force) dirty = true;
  /* Serialize writes; a forced flush waits for an in-flight one instead of being dropped. */
  flushChain = flushChain.then(writeStatusNow, writeStatusNow);
  return flushChain;
}

function ensureSessionEntry(sessionID) {
  if (!sessionID) return null;
  let entry = STATE.sessions[sessionID];
  if (entry) return entry;
  const ids = Object.keys(STATE.sessions);
  /* Keep a generous window so a busy multi-chat workspace does not evict a session
     that is merely waiting, and never evict the one being recorded right now. */
  if (ids.length >= 50) {
    let oldest = null;
    let oldestAt = Infinity;
    for (const id of ids) {
      if (id === sessionID) continue;
      const at = Number(STATE.sessions[id] && STATE.sessions[id].lastAt) || 0;
      if (at < oldestAt) {
        oldestAt = at;
        oldest = id;
      }
    }
    if (oldest) delete STATE.sessions[oldest];
  }
  entry = STATE.sessions[sessionID] = {
    runs: 0,
    prunedChars: 0,
    collapsed: 0,
    collapsedChars: 0,
    oldChars: 0,
    freshChars: 0,
    otherChars: 0,
    originalChars: 0,
    keptChars: 0,
    toolResults: 0,
    trimmedResults: 0,
    protectedReads: 0,
    lastSaved: 0,
    lastKept: 0,
    lastOriginal: 0,
    lastCollapsed: 0,
    lastCollapsedChars: 0,
    lastOld: 0,
    lastFresh: 0,
    lastOther: 0,
    lastToolResults: 0,
    lastTrimmedResults: 0,
    history: [],
    lastAt: 0,
  };
  return entry;
}

function touchSession(sessionID, model) {
  const entry = ensureSessionEntry(sessionID);
  if (!entry) return null;
  entry.runs = (entry.runs || 0) + 1;
  entry.lastAt = Date.now();
  if (model) entry.model = model;
  return entry;
}

function inputPaths(input) {
  const paths = [];
  if (typeof input === "string" && input.trim()) return [input];
  if (!input || typeof input !== "object") return paths;
  for (const key of ["path", "filePath", "file", "filename", "target", "pattern", "glob", "include"]) {
    const value = input[key];
    if (typeof value === "string" && value) paths.push(value);
  }
  return paths;
}

function isSkillCall(toolName, input) {
  if (/skill/i.test(String(toolName || ""))) return true;
  for (const path of inputPaths(input)) {
    const text = path.replace(/\\/g, "/");
    if (/(^|\/)skills\//i.test(text) || /(^|\/)skill\.md$/i.test(text)) return true;
  }
  return false;
}

function looksLikeSkillResult(result) {
  if (!result || typeof result !== "object") return false;
  let head = "";
  if (result.type === "text" && typeof result.value === "string") {
    head = result.value.slice(0, 4000);
  } else if (result.type === "content" && Array.isArray(result.value)) {
    for (const part of result.value) {
      if (!part || part.type !== "text" || typeof part.text !== "string") continue;
      head += part.text.slice(0, 4000);
      if (head.length >= 4000) break;
    }
  }
  return /\bSKILL\.md\b/i.test(head) || /(^|\/)skills\//i.test(head);
}

function globToRegex(pattern) {
  const escaped = pattern
    .replace(/\\/g, "/")
    .replace(/\*\*\//g, "\u0001")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, ".")
    .replace(/\u0001/g, "(?:.*/)?")
    .replace(/\u0000/g, ".*");
  try {
    return new RegExp(`^${escaped}$`, "i");
  } catch {
    return null;
  }
}

function protectedInputPaths(input) {
  const paths = [];
  if (!input || typeof input !== "object") return paths;
  for (const key of ["path", "filePath", "file", "filename", "target"]) {
    const value = input[key];
    if (typeof value === "string" && value) paths.push(value);
  }
  return paths;
}

function createProtectMatcher(protectPaths) {
  if (!protectPaths || !protectPaths.trim()) return () => false;
  const patterns = protectPaths
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^\.\//, ""))
    .filter(Boolean)
    .slice(0, 80)
    .map((pattern) => {
      if (pattern.includes("*") || pattern.includes("?")) {
        return { regex: globToRegex(pattern), text: "" };
      }
      return {
        regex: null,
        text: pattern
          .replace(/\\/g, "/")
          .replace(/^\/+/, "")
          .replace(/\/+$/, "")
          .toLowerCase(),
      };
    })
    .filter((pattern) => pattern.regex || pattern.text);
  if (!patterns.length) return () => false;
  return (input) => {
    const paths = protectedInputPaths(input).map((path) => path.replace(/\\/g, "/"));
    if (!paths.length) return false;
    for (const path of paths) {
      let relative = path;
      const lower = path.toLowerCase();
      if (projectKey && lower.startsWith(`${projectKey}/`)) {
        relative = path.slice(projectKey.length + 1);
      }
      const lowerPath = path.toLowerCase();
      const lowerRelative = relative.toLowerCase();
      for (const pattern of patterns) {
        if (pattern.regex) {
          if (pattern.regex.test(path) || (relative !== path && pattern.regex.test(relative))) return true;
          continue;
        }
        if (!pattern.text) continue;
        if (
          lowerPath === pattern.text ||
          lowerPath.endsWith(`/${pattern.text}`) ||
          lowerPath.startsWith(`${pattern.text}/`) ||
          lowerPath.includes(`/${pattern.text}/`) ||
          lowerRelative === pattern.text ||
          lowerRelative.endsWith(`/${pattern.text}`) ||
          lowerRelative.startsWith(`${pattern.text}/`) ||
          lowerRelative.includes(`/${pattern.text}/`)
        ) {
          return true;
        }
      }
    }
    return false;
  };
}

function matchesProtected(input, protectPaths) {
  return createProtectMatcher(protectPaths)(input);
}

const READ_TOOL_NAMES = new Set(["read", "read_file"]);
const COLLAPSIBLE_TOOL_NAMES = new Set([
  "read",
  "read_file",
  "grep",
  "glob",
  "list",
  "find",
  "webfetch",
  "websearch",
  "bash",
  "shell",
  "skill",
]);
const COLLAPSED_STUB_PREFIX = "[Fox Box: duplicate ";

function firstInputPath(input) {
  if (!input || typeof input !== "object") return "";
  for (const key of ["filePath", "path", "file", "filename"]) {
    const value = input[key];
    if (typeof value === "string" && value) return value;
  }
  return "";
}

function normalizePathKey(value) {
  let text = String(value || "")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .trim();
  while (text.startsWith("./")) text = text.slice(2);
  if (text && !text.startsWith("/") && !/^[a-z]:\//i.test(text) && projectKey) {
    text = `${projectKey}/${text}`;
  }
  const caseInsensitive =
    typeof process !== "undefined" && (process.platform === "win32" || process.platform === "darwin");
  return caseInsensitive ? text.toLowerCase() : text;
}

function stableStringify(value, depth = 0) {
  if (value === null || typeof value !== "object") {
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  }
  if (depth >= 6) return '"…"';
  if (Array.isArray(value)) {
    return `[${value.slice(0, 100).map((item) => stableStringify(item, depth + 1)).join(",")}]`;
  }
  const keys = Object.keys(value).sort().slice(0, 100);
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key], depth + 1)}`)
    .join(",")}}`;
}

function toolCallKey(name, input) {
  const tool = String(name || "tool").toLowerCase();
  if (READ_TOOL_NAMES.has(tool)) {
    const path = normalizePathKey(firstInputPath(input));
    if (path) {
      const offset = Number(input && (input.offset ?? input.startLine ?? input.start));
      const limit = Number(input && input.limit);
      const end = Number(input && (input.endLine ?? input.end));
      const start = Number.isFinite(offset) && offset > 0 ? Math.round(offset) : 0;
      const size = Number.isFinite(limit) && limit > 0 ? Math.round(limit) : 0;
      const endLine = Number.isFinite(end) && end > 0 ? Math.round(end) : 0;
      return `read|${path}|${start}|${size}|${endLine}`;
    }
  }
  const key = `${tool}|${stableStringify(input)}`;
  return key.length > 8000 ? `${key.slice(0, 7950)}…${key.length.toString(36)}` : key;
}

function resultTextLength(result) {
  if (!result || typeof result !== "object") return 0;
  if (result.type === "text" && typeof result.value === "string") return result.value.length;
  /* OpenCode tool results can be structured JSON. It is still text the model reads,
     so it belongs in the ledger; it is counted, not rewritten. */
  if (result.type === "json" && result.value !== undefined && result.value !== null) {
    try {
      return stableStringify(result.value).length;
    } catch {
      return 0;
    }
  }
  if (result.type === "content" && Array.isArray(result.value)) {
    let length = 0;
    for (const part of result.value) {
      if (part && part.type === "text" && typeof part.text === "string") length += part.text.length;
    }
    return length;
  }
  return 0;
}

function countToolResultParts(messages) {
  if (!Array.isArray(messages)) return 0;
  let count = 0;
  for (const message of messages) {
    if (!message || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part && part.type === "tool-result") count += 1;
    }
  }
  return count;
}

/*
 * Count the characters a model actually reads in the outgoing conversation.
 * Text parts, tool-result text (including structured JSON results), and tool-call
 * arguments are included; images and other binary parts are not, because their
 * prompt cost is tokenizer specific. Taking this before and after trimming gives the exact number of
 * characters Fox Box removed, independent of which trim path did the work.
 */
function messageCharCount(messages) {
  if (!Array.isArray(messages)) return 0;
  let total = 0;
  for (const message of messages) {
    if (!message) continue;
    const content = message.content;
    if (typeof content === "string") {
      total += content.length;
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      if (part.type === "text" && typeof part.text === "string") {
        total += part.text.length;
      } else if (part.type === "tool-result") {
        total += resultTextLength(part.result);
      } else if (part.type === "tool-call" && part.input !== undefined && part.input !== null) {
        try {
          total += stableStringify(part.input).length;
        } catch {
          // An unreadable input simply contributes nothing.
        }
      }
    }
  }
  return total;
}

function isCollapsedStub(result) {
  if (!result || typeof result !== "object") return false;
  if (result.type === "text" && typeof result.value === "string") {
    return result.value.startsWith(COLLAPSED_STUB_PREFIX);
  }
  if (result.type === "content" && Array.isArray(result.value)) {
    const first = result.value.find((part) => part && part.type === "text");
    return Boolean(first && typeof first.text === "string" && first.text.startsWith(COLLAPSED_STUB_PREFIX));
  }
  return false;
}

function oneLine(value, max) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").slice(0, max);
}

function duplicateStub(name, displayPath) {
  const isRead = READ_TOOL_NAMES.has(String(name || "").toLowerCase());
  const label = isRead && displayPath ? `read of ${oneLine(displayPath, 180)}` : `${oneLine(name || "tool", 80)} call`;
  return `${COLLAPSED_STUB_PREFIX}${label} collapsed. The newest result is later in this request; use it instead of repeating the call.]`;
}

function countNewlines(text) {
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) count += 1;
  }
  return count;
}

function trimReadText(text, max, reason, meta) {
  const totalLines = countNewlines(text) + 1;
  if (totalLines < 3) return null;
  const rawOffset = Number(meta && meta.input && (meta.input.offset ?? meta.input.startLine ?? meta.input.start));
  const startLine = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.round(rawOffset) : 1;
  const endLine = startLine + totalLines - 1;
  const path = firstInputPath(meta && meta.input);
  const where = path ? ` from ${oneLine(path, 120)}` : "";
  const kind = reason === "old" ? "older read" : reason === "kept" ? "latest read" : "fresh result";
  const readName = String((meta && meta.tool) || "read");
  const attempt = (headRatio, tailRatio) => {
    const headBudget = Math.max(200, Math.floor(max * headRatio));
    const tailBudget = Math.max(120, Math.floor(max * tailRatio));
    let headCut = text.lastIndexOf("\n", headBudget);
    if (headCut < Math.floor(headBudget * 0.45)) headCut = headBudget;
    let tailStart = text.indexOf("\n", Math.max(0, text.length - tailBudget));
    if (tailStart < 0) tailStart = text.length - tailBudget;
    else tailStart += 1;
    if (tailStart > text.length - Math.floor(tailBudget * 0.3)) tailStart = text.length - tailBudget;
    if (headCut <= 0 || tailStart <= headCut || tailStart >= text.length) return null;
    const headLines = countNewlines(text.slice(0, headCut)) + 1;
    const tailLines = countNewlines(text.slice(tailStart)) + 1;
    const headEndLine = startLine + headLines - 1;
    const tailStartLine = endLine - tailLines + 1;
    const gapStart = headEndLine + 1;
    const gapEnd = tailStartLine - 1;
    if (gapEnd < gapStart) return null;
    const label = [
      `Fox Box kept lines ${startLine}–${headEndLine} and ${tailStartLine}–${endLine}${where} (${kind}, cap ${max.toLocaleString()} chars). `,
      `Lines ${gapStart}–${gapEnd} are omitted. To read the gap, call ${readName} with offset=${gapStart} limit=${gapEnd - gapStart + 1} instead of repeating the whole file.`,
    ].join("");
    const headText = text.slice(0, headCut);
    const tailText = text.slice(tailStart);
    const marker = `\n\n… [${label}] …\n\n`;
    if (headText.length + tailText.length + marker.length > max) return null;
    const output = `${headText}${marker}${tailText}`;
    return { text: output, saved: Math.max(0, text.length - output.length) };
  };
  /* Use as much of the cap as the marker allows; fall back to a tighter split, then to a char cut. */
  return attempt(0.62, 0.24) ?? attempt(0.56, 0.2) ?? null;
}

function trimText(text, max, reason, meta) {
  if (typeof text !== "string" || text.length <= max) return { text, saved: 0 };
  if (meta && READ_TOOL_NAMES.has(String(meta.tool || "").toLowerCase())) {
    const readTrimmed = trimReadText(text, max, reason, meta);
    if (readTrimmed) return readTrimmed;
  }
  const kind = reason === "fresh" ? "fresh result" : reason === "kept" ? "latest read" : "old result";
  /* trimText always ends at exactly `max` characters below, so state the cap and the
     original size. An estimated "removed" count here used to overstate the saving. */
  const label =
    reason === "old"
      ? `Fox Box trimmed an old result to ${max.toLocaleString()} chars (was ${text.length.toLocaleString()}).`
      : `Fox Box kept the first and last part of this ${kind}: capped at ${max.toLocaleString()} chars (was ${text.length.toLocaleString()}). If the missing middle matters, request only that range or narrow the call instead of repeating it.`;
  let marker = `\n\n… [${label}] …\n\n`;
  if (marker.length >= max) marker = "\n… [Fox Box trimmed] …\n";
  if (marker.length >= max) {
    const output = text.slice(0, max);
    return { text: output, saved: Math.max(0, text.length - output.length) };
  }
  const room = max - marker.length;
  const head = Math.max(1, Math.floor(room * 0.68));
  const tail = Math.max(0, room - head);
  const tailText = tail > 0 ? text.slice(-tail) : "";
  const output = `${text.slice(0, head)}${marker}${tailText}`;
  return {
    text: output,
    saved: Math.max(0, text.length - output.length),
  };
}

function trimResult(result, max, reason, meta) {
  if (!result || typeof result !== "object") return { result, saved: 0 };
  if (result.type === "text" && typeof result.value === "string") {
    const trimmed = trimText(result.value, max, reason, meta);
    if (trimmed.saved > 0) return { result: { ...result, value: trimmed.text }, saved: trimmed.saved };
    return { result, saved: 0 };
  }
  if (result.type === "content" && Array.isArray(result.value)) {
    const kind = reason === "fresh" ? "fresh result" : reason === "kept" ? "latest read" : "old result";
    const marker = `[Fox Box: later text in this ${kind} was trimmed]`;
    let budget = Math.max(0, max - marker.length);
    let originalText = 0;
    let dropped = false;
    const value = [];
    for (const part of result.value) {
      if (!part || part.type !== "text" || typeof part.text !== "string") {
        value.push(part);
        continue;
      }
      originalText += part.text.length;
      if (budget <= 0) {
        dropped = true;
        continue;
      }
      if (part.text.length > budget) {
        const trimmed = trimText(part.text, budget, reason, meta);
        value.push({ ...part, text: trimmed.text });
        budget = 0;
        continue;
      }
      budget -= part.text.length;
      value.push(part);
    }
    if (dropped) value.push({ type: "text", text: marker });
    let replacementText = 0;
    for (const part of value) {
      if (part && part.type === "text" && typeof part.text === "string") replacementText += part.text.length;
    }
    const saved = Math.max(0, originalText - replacementText);
    if (saved > 0) return { result: { ...result, value }, saved };
  }
  return { result, saved: 0 };
}

function toolCallMap(messages) {
  const calls = new Map();
  for (const message of messages) {
    if (!message || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part && part.type === "tool-call" && part.id) calls.set(part.id, part);
    }
  }
  return calls;
}

function isProtectedResult(name, part, call, context, protect) {
  if (context.protectSkills && isSkillCall(name, call && call.input)) return true;
  if (context.protectSkills && looksLikeSkillResult(part.result)) return true;
  const matches = protect || ((input) => matchesProtected(input, context.protectPaths));
  if (matches(call && call.input)) return true;
  return false;
}

function collectToolResultEntries(messages, context, calls) {
  const entries = [];
  const protect = createProtectMatcher(context.protectPaths);
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const message = messages[messageIndex];
    if (!message || message.role !== "tool" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (!part || part.type !== "tool-result") continue;
      const call = calls.get(part.id);
      const name = String(part.name || (call && call.name) || "");
      const input = call && call.input;
      const displayPath = firstInputPath(input);
      const pathKey = normalizePathKey(displayPath);
      const protectedResult = isProtectedResult(name, part, call, context, protect);
      const toolName = String(name || "").toLowerCase();
      const collapsible = COLLAPSIBLE_TOOL_NAMES.has(toolName);
      /* Keep large write/edit payloads out of the duplicate key. Non-collapsible protected
         results still share a logical path key so only their newest copy stays whole. */
      const key = collapsible
        ? call
          ? toolCallKey(name, input)
          : `${name || "tool"}|id:${part.id || entries.length}`
        : protectedResult
          ? pathKey
            ? `protected|${toolName || "tool"}|${pathKey}`
            : `${name || "tool"}|id:${part.id || entries.length}`
          : "";
      entries.push({
        index: entries.length,
        messageIndex,
        part,
        name,
        input,
        displayPath,
        pathKey,
        key,
        protected: protectedResult,
        collapsed: false,
      });
    }
  }
  return entries;
}

function collapseDuplicateEntries(entries, context) {
  if (context.collapseDuplicates === false) return { collapsed: 0, chars: 0 };
  const groups = new Map();
  for (const entry of entries) {
    if (!COLLAPSIBLE_TOOL_NAMES.has(String(entry.name || "").toLowerCase())) continue;
    if (isCollapsedStub(entry.part.result)) continue;
    const list = groups.get(entry.key);
    if (list) list.push(entry);
    else groups.set(entry.key, [entry]);
  }
  let collapsed = 0;
  let chars = 0;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const newest = list[list.length - 1];
    if (!newest.part.result || newest.part.result.type === "error" || isCollapsedStub(newest.part.result)) continue;
    /* An empty or failed-looking newer result must not erase a useful older one. */
    if (resultTextLength(newest.part.result) < 16) continue;
    /* Do not replace a protected older read with an empty/failed newer one. */
    if (newest.protected && resultTextLength(newest.part.result) < 100) continue;
    for (const entry of list.slice(0, -1)) {
      if (entry.collapsed || isCollapsedStub(entry.part.result)) continue;
      const before = resultTextLength(entry.part.result);
      const stub = duplicateStub(entry.name, entry.displayPath);
      if (stub.length >= before) continue;
      entry.part.result = { type: "text", value: stub };
      entry.collapsed = true;
      collapsed += 1;
      chars += before - stub.length;
    }
  }
  return { collapsed, chars };
}

function latestProtectedEntries(entries) {
  const latest = new Map();
  for (const entry of entries) {
    if (entry.collapsed || !entry.protected || isCollapsedStub(entry.part.result)) continue;
    if (!entry.part.result || entry.part.result.type === "error") continue;
    /* A failed or tiny re-read must not displace the last useful protected copy. */
    if (resultTextLength(entry.part.result) < 100) continue;
    latest.set(entry.key, entry);
  }
  return latest;
}

function latestReadEntries(entries) {
  const latest = new Map();
  const protectedPaths = new Set();
  for (const entry of entries) {
    if (entry.protected && entry.pathKey) protectedPaths.add(entry.pathKey);
  }
  for (const entry of entries) {
    if (entry.collapsed || entry.protected || isCollapsedStub(entry.part.result)) continue;
    if (!entry.pathKey || protectedPaths.has(entry.pathKey)) continue;
    if (!READ_TOOL_NAMES.has(String(entry.name || "").toLowerCase())) continue;
    if (!entry.part.result || entry.part.result.type === "error") continue;
    if (resultTextLength(entry.part.result) < 16) continue;
    latest.set(entry.pathKey, entry);
  }
  return latest;
}

/*
 * Protect and trim the outgoing request only. In order:
 *  1. Collapse repeated discovery calls, keeping the newest result and replacing older copies.
 *  2. Keep the newest copy of every skill/pinned result whole, no matter how old it is.
 *  3. Keep the newest read of up to `protectedReads` files at the fresh cap even when old.
 *  4. Cap every other result at the fresh or old budget.
 * Stored history is never rewritten; a cap change takes effect on the next request.
 */
function trimToolResults(messages, context) {
  const empty = { old: 0, fresh: 0, collapsed: 0, collapsedChars: 0, protectedReads: 0, trimmed: 0 };
  if (!Array.isArray(messages) || messages.length === 0) return empty;
  const trimEnabled = context.trimToolOutput !== false;
  if (!trimEnabled && context.collapseDuplicates === false) return empty;
  const keep = Math.max(2, Math.min(40, Number(context.keepRecent) || 10));
  const cutoff = Math.max(0, messages.length - keep);
  const calls = toolCallMap(messages);
  const entries = collectToolResultEntries(messages, context, calls);
  const collapse = collapseDuplicateEntries(entries, context);
  const protectedLatest = trimEnabled ? latestProtectedEntries(entries) : new Map();
  const latestReads = trimEnabled ? latestReadEntries(entries) : new Map();
  const configuredReads = context.protectedReads === undefined ? 6 : Number(context.protectedReads);
  const readLimit = Number.isFinite(configuredReads) ? Math.max(0, Math.min(12, Math.round(configuredReads))) : 6;
  const keptReadEntries = new Set(
    Array.from(latestReads.values())
      .filter((entry) => entry.messageIndex < cutoff)
      .sort((a, b) => b.index - a.index)
      .slice(0, readLimit)
      .map((entry) => entry.index),
  );
  const oldMax = Math.max(1000, Math.min(64000, Number(context.maxOldToolOutput) || 6000));
  const freshMax = Math.max(2000, Math.min(256000, Number(context.maxToolOutput) || 48000));
  let oldSaved = 0;
  let freshSaved = 0;
  let trimmedResults = 0;
  if (trimEnabled) {
    for (const entry of entries) {
      if (entry.collapsed || isCollapsedStub(entry.part.result)) continue;
      const isOld = entry.messageIndex < cutoff;
      if (entry.protected && protectedLatest.get(entry.key) === entry) continue;
      const isKeptRead = isOld && keptReadEntries.has(entry.index);
      const max = isOld && !isKeptRead ? oldMax : freshMax;
      const reason = isOld && !isKeptRead ? "old" : isKeptRead ? "kept" : "fresh";
      const outcome = trimResult(entry.part.result, max, reason, {
        tool: entry.name,
        input: entry.input,
      });
      if (outcome.saved > 0) {
        entry.part.result = outcome.result;
        trimmedResults += 1;
        if (isOld && !isKeptRead) oldSaved += outcome.saved;
        else freshSaved += outcome.saved;
      }
    }
  }
  return {
    old: oldSaved,
    fresh: freshSaved,
    collapsed: collapse.collapsed,
    collapsedChars: collapse.chars,
    protectedReads: keptReadEntries.size,
    trimmed: trimmedResults,
  };
}

export default {
  id: "fox-box",
  async setup(ctx) {
    projectKey = normalizeDir(ctx.location && ctx.location.directory);
    STATE.loadedAt = Date.now();
    STATE.updatedAt = Date.now();

    const hooks = [];

    if (ctx.session && typeof ctx.session.hook === "function") {
      hooks.push(
        await ctx.session.hook("context", async (event) => {
          try {
          const config = await readConfig();
          const contextConfig = config.powers.context;
          const modelConfig = config.powers.model;
          const providerID = String((event.model && event.model.providerID) || "");
          const modelID = String((event.model && event.model.id) || "");
          const fullModel = providerID ? `${providerID}/${modelID}` : modelID;
          const qwen = isQwenModel(fullModel);
          const sessionID = String(event.sessionID || "");
          let appliedModel = false;
          let originalChars = 0;
          let keptChars = 0;
          let savedChars = 0;
          let otherChars = 0;
          let toolResults = 0;
          let trimmed = { old: 0, fresh: 0, collapsed: 0, collapsedChars: 0, protectedReads: 0, trimmed: 0 };
          const hidden = [];

          /* Work on copies so a frozen or reused event cannot turn a request into a failure. */
          const system = Array.isArray(event.system) ? [...event.system] : null;
          if (system) event.system = system;

          if (modelConfig.enabled) {
            /* Hiding a tool is a surface rule, not model tuning: it applies to every model.
               The Qwen-only switch below governs sampling and the contract, which are tuned
               for one model family. Keeping the two together made a hide toggle inert on
               every non-Qwen model, with no visible sign in the panel. */
            const names = Array.isArray(modelConfig.hideTools) ? modelConfig.hideTools : [];
            if (names.length) {
              if (event.tools && typeof event.tools === "object") event.tools = { ...event.tools };
              for (const name of names) {
                if (event.tools && Object.prototype.hasOwnProperty.call(event.tools, name)) {
                  delete event.tools[name];
                  hidden.push(name);
                }
              }
            }
            if (!modelConfig.applyToQwenOnly || qwen) {
              appliedModel = true;
              const options = {
                ...(event.options && typeof event.options === "object" ? event.options : {}),
              };
              event.options = options;
              if (Number.isFinite(modelConfig.temperature)) {
                options.temperature = modelConfig.temperature;
              }
              if (Number.isFinite(modelConfig.topP)) options.topP = modelConfig.topP;
              if (Number.isFinite(modelConfig.topK)) options.topK = modelConfig.topK;
              if (Number.isFinite(modelConfig.presencePenalty)) {
                options.presencePenalty = modelConfig.presencePenalty;
              }
              if (Number.isFinite(modelConfig.frequencyPenalty)) {
                options.frequencyPenalty = modelConfig.frequencyPenalty;
              }
              if (modelConfig.capOutput && Number.isFinite(modelConfig.maxOutputTokens)) {
                options.maxTokens = modelConfig.maxOutputTokens;
              }
              if (modelConfig.reasoningEffort && modelConfig.reasoningEffort !== "auto") {
                options.reasoningEffort = modelConfig.reasoningEffort;
              }
              if (modelConfig.contractEnabled && modelConfig.contract && system) {
                const present = system.some(
                  (part) => part && part.type === "text" && part.text === modelConfig.contract,
                );
                if (!present) system.push({ type: "text", text: modelConfig.contract });
              }
              STATE.totals.model += 1;
            }
          }

          if (contextConfig.enabled) {
            const brief = contextConfig.briefs[projectKey];
            if (brief && brief.trim() && system) {
              const text = `Fox Box focus brief for this project (user-authored; keep it steady unless the latest user message overrides it):\n${brief}`;
              const present = system.some(
                (part) =>
                  part &&
                  part.type === "text" &&
                  typeof part.text === "string" &&
                  part.text.startsWith("Fox Box focus brief for this project"),
              );
              if (!present) system.push({ type: "text", text });
            }
            /* Measure before and after with the same counter: that delta is the exact number
               of characters removed from the outgoing conversation, whichever trim path ran. */
            toolResults = countToolResultParts(event.messages);
            originalChars = messageCharCount(event.messages);
            trimmed = trimToolResults(event.messages, contextConfig);
            keptChars = messageCharCount(event.messages);
            savedChars = Math.max(0, originalChars - keptChars);
            const reported = trimmed.old + trimmed.fresh + trimmed.collapsedChars;
            otherChars = Math.max(0, savedChars - reported);
            STATE.totals.originalChars += originalChars;
            STATE.totals.keptChars += keptChars;
            STATE.totals.oldChars += trimmed.old;
            STATE.totals.freshChars += trimmed.fresh;
            STATE.totals.collapsedChars += trimmed.collapsedChars;
            STATE.totals.otherChars += otherChars;
            STATE.totals.toolResults += toolResults;
            STATE.totals.trimmedResults += trimmed.trimmed;
            if (trimmed.collapsed > 0) STATE.totals.collapsed += trimmed.collapsed;
            if (savedChars > 0) {
              STATE.totals.prunes += 1;
              STATE.totals.prunedChars += savedChars;
              if (trimmed.fresh > 0) STATE.totals.toolTrims += 1;
            }
          }

          const now = Date.now();
          STATE.last = {
            sessionId: sessionID,
            model: fullModel,
            tools: Object.keys(event.tools || {}).length,
            hidden,
            applied: appliedModel,
            freshCap: contextConfig.maxToolOutput,
            oldCap: contextConfig.maxOldToolOutput,
            trimToolOutput: contextConfig.trimToolOutput,
            protectedReads: trimmed.protectedReads,
            collapsed: trimmed.collapsed,
            collapsedChars: trimmed.collapsedChars,
            originalChars,
            keptChars,
            savedChars,
            savedPercent: originalChars > 0 ? Math.round((savedChars / originalChars) * 1000) / 10 : 0,
            oldChars: trimmed.old,
            freshChars: trimmed.fresh,
            otherChars,
            toolResults,
            trimmedResults: trimmed.trimmed,
            at: now,
          };
          /* The ledger is a pruning ledger: a request made while Context Keeper is off has no
             guarded context to account for, and must not inflate "requests guarded". The last
             request above still feeds the Model Fit status, which is independent of pruning. */
          if (contextConfig.enabled) {
            STATE.totals.context += 1;
            const session = touchSession(sessionID, fullModel);
            if (session) {
              session.prunedChars = (session.prunedChars || 0) + savedChars;
              session.oldChars = (session.oldChars || 0) + trimmed.old;
              session.freshChars = (session.freshChars || 0) + trimmed.fresh;
              session.collapsedChars = (session.collapsedChars || 0) + trimmed.collapsedChars;
              session.otherChars = (session.otherChars || 0) + otherChars;
              session.originalChars = (session.originalChars || 0) + originalChars;
              session.keptChars = (session.keptChars || 0) + keptChars;
              session.toolResults = (session.toolResults || 0) + toolResults;
              session.trimmedResults = (session.trimmedResults || 0) + trimmed.trimmed;
              session.collapsed = (session.collapsed || 0) + trimmed.collapsed;
              session.protectedReads = trimmed.protectedReads;
              session.lastSaved = savedChars;
              session.lastKept = keptChars;
              session.lastOriginal = originalChars;
              session.lastCollapsed = trimmed.collapsed;
              session.lastCollapsedChars = trimmed.collapsedChars;
              session.lastOld = trimmed.old;
              session.lastFresh = trimmed.fresh;
              session.lastOther = otherChars;
              session.lastToolResults = toolResults;
              session.lastTrimmedResults = trimmed.trimmed;
              if (originalChars > 0) {
                session.history = Array.isArray(session.history) ? session.history : [];
                session.history.push({ at: now, saved: savedChars, kept: keptChars });
                if (session.history.length > 16) session.history = session.history.slice(-16);
              }
            }
          }
          markDirty();
          } catch {
            // Fox Box must never fail the model request because an event could not be edited.
          }
        }),
      );
    }

    if (ctx.command && typeof ctx.command.transform === "function") {
      hooks.push(
        await ctx.command.transform((editor) => {
          editor.add({
            name: "foxbox-compact",
            description: "Compact this session after Fox Box has protected recent messages and skill content",
            execute: async (input) => {
              const sessionID = input && input.sessionID;
              if (!sessionID || !ctx.session || typeof ctx.session.compact !== "function") return;
              await ctx.session.compact({ sessionID });
            },
          });
        }),
      );
    }

    STATE.stopped = false;
    lastStatusWrite = 0;
    const statusTimer = setInterval(() => {
      if (Date.now() - lastStatusWrite >= 20000) void flushStatus(true);
      else void flushStatus(false);
    }, 2000);
    void flushStatus(true);

    return async () => {
      clearInterval(statusTimer);
      STATE.stopped = true;
      for (const registration of hooks) {
        try {
          await registration.dispose();
        } catch {
          // Unload must not throw.
        }
      }
      await flushStatus(true);
    };
  },
};
