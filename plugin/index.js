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

import { pruneContext } from "./context.js";

/*
 * Keep the injected contract free of style and workflow rules. Small models copy
 * "one tool at a time", "keep replies short", and similar lines literally, which
 * narrows their behavior beyond anything the task asked for. Only verification
 * guidance stays.
 */
const DEFAULT_CONTRACT = [
  "Fox Box small-model contract:",
  "- Prefer reading the code over guessing what it contains.",
  "- Before claiming success, run the check that proves it. If you cannot run it, say what remains unverified.",
].join("\n");

/* The version 2 contract, kept only so normalizeConfig can upgrade untouched copies. */
const LEGACY_CONTRACT_V2 = [
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
  version: 4,
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
    supersededChars: 0,
    staleChars: 0,
    compactedChars: 0,
    receiptChars: 0,
    budgetChars: 0,
    superseded: 0,
    stale: 0,
    compacted: 0,
    receipts: 0,
    budgetEvicted: 0,
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
const CONFIG_VERSION = 3;

function defaults() {
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
        maxToolOutput: 128000,
        maxOldToolOutput: 6000,
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
     re-read files. Upgrade those caps once. Version 2 shipped 48k, 10 recent messages, trimming,
     and code skeletons on; move untouched copies to the new defaults. A custom value survives. */
  const legacyCap = context.maxToolOutput === null || context.maxToolOutput === undefined
    ? Number.NaN
    : Number(context.maxToolOutput);
  const legacyKeepRecent = context.keepRecent === null || context.keepRecent === undefined
    ? Number.NaN
    : Number(context.keepRecent);
  const freshCapIsLegacyDefault =
    inputVersion < CONFIG_VERSION &&
    (!Number.isFinite(legacyCap) ||
      legacyCap === 48000 ||
      (inputVersion < 2 && legacyCap > 0 && legacyCap < 48000));
  const keepRecentIsLegacyDefault =
    inputVersion < CONFIG_VERSION && (!Number.isFinite(legacyKeepRecent) || legacyKeepRecent === 10);
  const contractIsLegacyDefault =
    inputVersion < CONFIG_VERSION && typeof model.contract === "string" && model.contract.trim() === LEGACY_CONTRACT_V2;
  const trimIsLegacyDefault = inputVersion < CONFIG_VERSION;
  return {
    version: CONFIG_VERSION,
    powers: {
      context: {
        enabled: context.enabled !== false,
        protectSkills: context.protectSkills !== false,
        keepRecent: keepRecentIsLegacyDefault
          ? base.powers.context.keepRecent
          : clampInt(context.keepRecent ?? base.powers.context.keepRecent, 2, 40, base.powers.context.keepRecent),
        protectedReads: clampInt(context.protectedReads ?? 6, 0, 12, base.powers.context.protectedReads),
        collapseDuplicates: context.collapseDuplicates !== false,
        trimToolOutput: trimIsLegacyDefault ? false : context.trimToolOutput === true,
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
        pathSupersession: context.pathSupersession !== false,
        staleReads: context.staleReads !== false,
        mergeReadRanges: context.mergeReadRanges !== false,
        editReceipts: context.editReceipts !== false,
        receiptMinChars: clampInt(
          context.receiptMinChars ?? base.powers.context.receiptMinChars,
          200,
          20000,
          base.powers.context.receiptMinChars,
        ),
        smartCompaction: context.smartCompaction !== false,
        skeletonCodeReads: trimIsLegacyDefault ? false : context.skeletonCodeReads === true,
        budgetTokens: clampInt(
          context.budgetTokens ?? base.powers.context.budgetTokens,
          0,
          2000000,
          base.powers.context.budgetTokens,
        ),
        charsPerToken: clampNumber(
          context.charsPerToken ?? base.powers.context.charsPerToken,
          1,
          20,
          base.powers.context.charsPerToken,
        ),
        relevanceScoring: context.relevanceScoring !== false,
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
          contractIsLegacyDefault || typeof model.contract !== "string" || !model.contract.trim()
            ? DEFAULT_CONTRACT
            : model.contract.slice(0, 3500),
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
    supersededChars: 0,
    staleChars: 0,
    compactedChars: 0,
    receiptChars: 0,
    budgetChars: 0,
    superseded: 0,
    stale: 0,
    compacted: 0,
    receipts: 0,
    budgetEvicted: 0,
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
    lastSuperseded: 0,
    lastSupersededChars: 0,
    lastStale: 0,
    lastStaleChars: 0,
    lastCompacted: 0,
    lastCompactedChars: 0,
    lastReceipts: 0,
    lastReceiptChars: 0,
    lastBudgetEvicted: 0,
    lastBudgetChars: 0,
    lastMeasure: null,
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

/* Conversation characters are exactly what the old ledger measured: the request
   itself, not the contract, brief, or tool definitions sent beside it. */
function conversationChars(measurement) {
  if (!measurement || typeof measurement !== "object") return 0;
  return Math.max(0, Number(measurement.chars || 0) - Number(measurement.system || 0) - Number(measurement.toolDefinitions || 0));
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
          let measurement = null;
          let trimmed = {
            old: 0,
            fresh: 0,
            collapsed: 0,
            collapsedChars: 0,
            superseded: 0,
            merged: 0,
            supersededChars: 0,
            stale: 0,
            staleChars: 0,
            compacted: 0,
            compactedChars: 0,
            receipts: 0,
            receiptChars: 0,
            budgetEvicted: 0,
            budgetChars: 0,
            budgetOver: 0,
            protectedReads: 0,
            trimmed: 0,
            errors: 0,
          };
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
            /* The engine measures the whole request before and after, then reports what
               each pass removed. Conversation counts stay exact and independent of the
               contract/brief and tool definitions the model also receives. */
            const outcome = pruneContext(event, { rules: contextConfig, projectKey });
            trimmed = outcome;
            originalChars = conversationChars(outcome.before);
            keptChars = conversationChars(outcome.after);
            savedChars = Math.max(0, originalChars - keptChars);
            toolResults = Number(outcome.before.toolResultParts) || 0;
            measurement = outcome.after;
            const reported =
              trimmed.old +
              trimmed.fresh +
              trimmed.collapsedChars +
              trimmed.supersededChars +
              trimmed.staleChars +
              trimmed.compactedChars +
              trimmed.receiptChars +
              trimmed.budgetChars;
            otherChars = Math.max(0, savedChars - reported);
            STATE.totals.originalChars += originalChars;
            STATE.totals.keptChars += keptChars;
            STATE.totals.oldChars += trimmed.old;
            STATE.totals.freshChars += trimmed.fresh;
            STATE.totals.collapsedChars += trimmed.collapsedChars;
            STATE.totals.supersededChars += trimmed.supersededChars;
            STATE.totals.staleChars += trimmed.staleChars;
            STATE.totals.compactedChars += trimmed.compactedChars;
            STATE.totals.receiptChars += trimmed.receiptChars;
            STATE.totals.budgetChars += trimmed.budgetChars;
            STATE.totals.otherChars += otherChars;
            STATE.totals.toolResults += toolResults;
            STATE.totals.trimmedResults += trimmed.trimmed;
            STATE.totals.collapsed += trimmed.collapsed;
            STATE.totals.superseded += trimmed.superseded;
            STATE.totals.stale += trimmed.stale;
            STATE.totals.compacted += trimmed.compacted;
            STATE.totals.receipts += trimmed.receipts;
            STATE.totals.budgetEvicted += trimmed.budgetEvicted;
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
            superseded: trimmed.superseded,
            merged: trimmed.merged,
            supersededChars: trimmed.supersededChars,
            stale: trimmed.stale,
            staleChars: trimmed.staleChars,
            compacted: trimmed.compacted,
            compactedChars: trimmed.compactedChars,
            receipts: trimmed.receipts,
            receiptChars: trimmed.receiptChars,
            budgetEvicted: trimmed.budgetEvicted,
            budgetChars: trimmed.budgetChars,
            budgetOver: trimmed.budgetOver,
            pruneErrors: trimmed.errors,
            toolResults,
            trimmedResults: trimmed.trimmed,
            requestChars: measurement ? measurement.chars : 0,
            requestTokens: measurement ? measurement.estimatedTokens : 0,
            measure: measurement,
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
              session.supersededChars = (session.supersededChars || 0) + trimmed.supersededChars;
              session.staleChars = (session.staleChars || 0) + trimmed.staleChars;
              session.compactedChars = (session.compactedChars || 0) + trimmed.compactedChars;
              session.receiptChars = (session.receiptChars || 0) + trimmed.receiptChars;
              session.budgetChars = (session.budgetChars || 0) + trimmed.budgetChars;
              session.otherChars = (session.otherChars || 0) + otherChars;
              session.originalChars = (session.originalChars || 0) + originalChars;
              session.keptChars = (session.keptChars || 0) + keptChars;
              session.toolResults = (session.toolResults || 0) + toolResults;
              session.trimmedResults = (session.trimmedResults || 0) + trimmed.trimmed;
              session.collapsed = (session.collapsed || 0) + trimmed.collapsed;
              session.superseded = (session.superseded || 0) + trimmed.superseded;
              session.stale = (session.stale || 0) + trimmed.stale;
              session.compacted = (session.compacted || 0) + trimmed.compacted;
              session.receipts = (session.receipts || 0) + trimmed.receipts;
              session.budgetEvicted = (session.budgetEvicted || 0) + trimmed.budgetEvicted;
              session.protectedReads = trimmed.protectedReads;
              session.lastSaved = savedChars;
              session.lastKept = keptChars;
              session.lastOriginal = originalChars;
              session.lastCollapsed = trimmed.collapsed;
              session.lastCollapsedChars = trimmed.collapsedChars;
              session.lastOld = trimmed.old;
              session.lastFresh = trimmed.fresh;
              session.lastOther = otherChars;
              session.lastSuperseded = trimmed.superseded;
              session.lastSupersededChars = trimmed.supersededChars;
              session.lastStale = trimmed.stale;
              session.lastStaleChars = trimmed.staleChars;
              session.lastCompacted = trimmed.compacted;
              session.lastCompactedChars = trimmed.compactedChars;
              session.lastReceipts = trimmed.receipts;
              session.lastReceiptChars = trimmed.receiptChars;
              session.lastBudgetEvicted = trimmed.budgetEvicted;
              session.lastBudgetChars = trimmed.budgetChars;
              session.lastMeasure = measurement;
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
