import { connectHost, HostRequestError } from "@openchamber/sdk";
import {
  applyHostReady,
  mountBadge,
  mountBanner,
  mountButton,
  mountCheckbox,
  mountProgress,
  mountSelect,
  mountSwitch,
  mountTabs,
  mountTextField,
  mountText,
} from "@openchamber/sdk/ui";
import { extractJsonObject, fillValuesFromJson, type FillField } from "./fill";

/* ------------------------------------------------------------------ */
/*  Constants and types                                               */
/* ------------------------------------------------------------------ */

const VERSION = "1.1.1";
const CONFIG_VERSION = 2;
const CONFIG_PATH = "~/.config/openchamber/fox-box/config.json";
/* Older plugin versions wrote one global status; still read it when the project file is absent. */
const LEGACY_STATUS_PATH = "~/.config/openchamber/fox-box/status.json";
const CHARACTER_INDEX_KEY = "characters:index";
const SPARK_INDEX_KEY = "sparks:index";
const characterKey = (id: string) => `character:${id}`;
const sparkKey = (id: string) => `spark:${id}`;
const characterCache = new Map<string, string>();
const sparkCache = new Map<string, string>();
const COMPOSE_MAX = 15_600;
const PROMPT_MAX = 15_600;
const CLIPBOARD_MAX = 32_000;
const BRIEF_MAX = 1_800;
const NOTE_MAX = 2_000;
const CONVERSATION_MAX = 26_000;

type Tone = "neutral" | "primary" | "success" | "warning" | "error" | "info";
type Handle = { update: (next: Record<string, unknown>) => void; dispose: () => void };
type ButtonHandle = { update: (next: Record<string, unknown>) => void };

type ContextPower = {
  enabled: boolean;
  protectSkills: boolean;
  keepRecent: number;
  protectedReads: number;
  collapseDuplicates: boolean;
  trimToolOutput: boolean;
  maxToolOutput: number;
  maxOldToolOutput: number;
  protectPaths: string;
  briefs: Record<string, string>;
};

type ModelPower = {
  enabled: boolean;
  preset: string;
  applyToQwenOnly: boolean;
  temperature: number;
  topP: number;
  topK: number;
  presencePenalty: number;
  frequencyPenalty: number;
  maxOutputTokens: number;
  capOutput: boolean;
  reasoningEffort: string;
  contractEnabled: boolean;
  contract: string;
  hideTools: string[];
};

type FoxConfig = {
  version: number;
  powers: {
    context: ContextPower;
    model: ModelPower;
  };
};

type Character = {
  id: string;
  name: string;
  role: string;
  pronouns: string;
  era: string;
  look: string;
  want: string;
  need: string;
  wound: string;
  contradiction: string;
  secret: string;
  arc: string;
  rhythm: string;
  vocabulary: string;
  tics: string;
  taboo: string;
  relationships: string;
  updatedAt: number;
};

type SparkScores = {
  novelty: number;
  usefulness: number;
  fit: number;
  effort: number;
};

type Spark = {
  id: string;
  title: string;
  note: string;
  scores?: SparkScores;
  createdAt: number;
};

type PluginTotals = {
  context?: number;
  toolTrims?: number;
  prunes?: number;
  prunedChars?: number;
  model?: number;
  collapsed?: number;
  collapsedChars?: number;
  originalChars?: number;
  keptChars?: number;
  oldChars?: number;
  freshChars?: number;
  otherChars?: number;
  toolResults?: number;
  trimmedResults?: number;
};

type PluginSessionMetrics = {
  lastAt?: number;
  runs?: number;
  prunedChars?: number;
  collapsed?: number;
  collapsedChars?: number;
  model?: string;
  originalChars?: number;
  keptChars?: number;
  oldChars?: number;
  freshChars?: number;
  otherChars?: number;
  toolResults?: number;
  trimmedResults?: number;
  protectedReads?: number;
  lastSaved?: number;
  lastKept?: number;
  lastOriginal?: number;
  lastCollapsed?: number;
  lastCollapsedChars?: number;
  lastOld?: number;
  lastFresh?: number;
  lastOther?: number;
  lastToolResults?: number;
  lastTrimmedResults?: number;
  history?: Array<{ at?: number; saved?: number; kept?: number }>;
};

type PluginStatus = {
  version?: number;
  stopped?: boolean;
  loadedAt?: number;
  updatedAt?: number;
  totals?: PluginTotals;
  sessions?: Record<string, PluginSessionMetrics>;
  last?: {
    sessionId?: string;
    model?: string;
    tools?: number;
    hidden?: string[];
    applied?: boolean;
    freshCap?: number;
    oldCap?: number;
    trimToolOutput?: boolean;
    protectedReads?: number;
    collapsed?: number;
    collapsedChars?: number;
    originalChars?: number;
    keptChars?: number;
    savedChars?: number;
    savedPercent?: number;
    oldChars?: number;
    freshChars?: number;
    otherChars?: number;
    toolResults?: number;
    trimmedResults?: number;
    at?: number;
  };
};

type StackInfo = {
  key: string;
  label: string;
  summary: string;
  isGame: boolean;
};

const DEFAULT_CONTRACT = [
  "Fox Box small-model contract:",
  "- Work in small, verifiable steps. Do not start a second step before the first has a visible result.",
  "- Read only what the current step needs. Prefer one tool call at a time, and never repeat a call that already answered.",
  "- Before claiming success, run the check that proves it. If you cannot run it, say what remains unverified.",
  "- Keep chat replies short. Put exploration in tools, not in prose. Ask one precise question only when blocked.",
].join("\n");

const KNOWN_TOOLS: Array<{ id: string; label: string; names: string[]; description: string }> = [
  {
    id: "subagent",
    label: "Subagents",
    /* OpenCode V2 names the spawner "subagent"; V1 called it "task". Hide both so the
       toggle works across versions and does not silently match nothing. */
    names: ["subagent", "task"],
    description: "Removes the subagent spawner from this request.",
  },
  {
    id: "webfetch",
    label: "Web fetch",
    names: ["webfetch"],
    description: "Removes the page fetcher.",
  },
  {
    id: "websearch",
    label: "Web search",
    names: ["websearch"],
    description: "Removes the search tool.",
  },
  {
    id: "todo",
    label: "Todo tools",
    names: ["todowrite", "todoread"],
    description: "Removes the task-list pair.",
  },
];

const QWEN_PRESETS: Record<
  string,
  Pick<
    ModelPower,
    | "temperature"
    | "topP"
    | "topK"
    | "presencePenalty"
    | "frequencyPenalty"
    | "maxOutputTokens"
    | "capOutput"
    | "reasoningEffort"
  >
> = {
  "qwen-thinking": {
    temperature: 1.0,
    topP: 0.95,
    topK: 20,
    presencePenalty: 0,
    frequencyPenalty: 0,
    maxOutputTokens: 8192,
    capOutput: true,
    reasoningEffort: "xhigh",
  },
  "qwen-instruct": {
    temperature: 0.7,
    topP: 0.8,
    topK: 20,
    presencePenalty: 1.5,
    frequencyPenalty: 0,
    maxOutputTokens: 8192,
    capOutput: true,
    reasoningEffort: "none",
  },
  balanced: {
    temperature: 0.4,
    topP: 0.9,
    topK: 40,
    presencePenalty: 0,
    frequencyPenalty: 0,
    maxOutputTokens: 8192,
    capOutput: true,
    reasoningEffort: "medium",
  },
};

/* ------------------------------------------------------------------ */
/*  State                                                             */
/* ------------------------------------------------------------------ */

const host = connectHost();
const root = document.querySelector<HTMLElement>("#root");
if (!root) throw new Error("Missing #root");

let ready: any = null;
let booted = false;
let booting = false;
let config: FoxConfig = defaultConfig();
let characters: Character[] = [];
let sparks: Spark[] = [];
let selectedCharacterId: string | null = null;
let selectedSparks = new Set<string>();
let pluginStatus: PluginStatus | null = null;
let statusKey = "";
let currentSessionRecord: any = null;
let sessionsStop: (() => void) | null = null;
let sessionsToken = 0;
let projectId: string | null = null;
let projectKey = "";
let lastDirectory = "";
let syncSeq = 0;
let activeTab = "context";
let activePower: string | null = "context-keeper";
let actionItem: any = null;
let pendingAction: any = null;

const powerCards = new Map<
  string,
  {
    open: () => void;
    close: () => void;
    refresh: () => void;
    element: HTMLElement;
  }
>();
const powerResults: Record<string, boolean> = {};
const powerUpdaters: Record<string, () => void> = {};
const resultClearers: Record<string, () => void> = {};
const handles: Record<string, Handle> = {};

let tabsHandle: { update: (next: any) => void; dispose: () => void } | null = null;
let bannerHandle: { dispose: () => void } | null = null;
let bannerHost: HTMLElement | null = null;
let footerStatus: HTMLElement | null = null;
let footerPlugin: HTMLElement | null = null;
let footerMessage = "Rules loaded";
let projectScan: StackInfo | null = null;
let statusTimer: number | undefined;
let statusBusy = false;

let sessionNameEl: HTMLElement | null = null;
let sessionDot: HTMLElement | null = null;
let sessionActivityEl: HTMLElement | null = null;
let sessionModelChip: HTMLElement | null = null;
let sessionMeterText: HTMLElement | null = null;
let sessionStatsEl: HTMLElement | null = null;
let sessionGuardEl: HTMLElement | null = null;
let sessionPowersEl: HTMLElement | null = null;
let sessionProgress: { update: (next: any) => void; dispose: () => void } | null = null;

/* Power-specific state kept outside the DOM so collapsed cards keep drafts. */
const sliceState = {
  mode: "feature",
  goal: "",
  constraints: "",
  scan: true,
  small: true,
  brief: true,
  result: "",
};
const bugState = {
  symptom: "",
  where: "",
  changed: "",
  focus: "full",
  includeFile: true,
  result: "",
};
const redState = {
  code: "",
  path: "",
  range: "",
  label: "",
  focus: new Set<string>(["correctness", "edge", "tests"]),
  extra: "",
  result: "",
};
const gameState = {
  genre: "platformer",
  engine: "bevy",
  loop: "",
  feel: "",
  mechanic: "",
  workbench: "juice",
  result: "",
};
const charState = {
  result: "",
};
const proseState = {
  mode: "line",
  text: "",
  focus: "sensory",
  style: "preserve",
  characterId: "",
  result: "",
  source: "",
};
const ideaState = {
  title: "",
  note: "",
  result: "",
};
const handoffState = {
  messages: null as Array<{ role: string; text: string }> | null,
  title: "",
  notes: "",
  result: "",
  truncated: false,
};

/* ------------------------------------------------------------------ */
/*  Small utilities                                                   */
/* ------------------------------------------------------------------ */

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(name: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "fb-icon");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#fb-${name}`);
  svg.append(use);
  return svg;
}

function uid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }
}

function normalizeDir(value: string | null | undefined): string {
  return (value ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/* Must match plugin/index.js statusFileName: FNV-1a over the normalized project path. */
function statusFileKey(directory: string | null | undefined): string {
  const key = normalizeDir(directory) || "global";
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `status-${(hash >>> 0).toString(36)}.json`;
}

function projectStatusPath(): string {
  return `~/.config/openchamber/fox-box/${statusFileKey(ready?.directory)}`;
}

function fmt(value: number): string {
  return Math.round(value).toLocaleString();
}

function fmtCompact(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}

/** Status files are user-writable; every number read from one goes through this. */
function amount(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function percentOf(part: number, whole: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return 0;
  return Math.min(100, Math.max(0, (part / whole) * 100));
}

function fmtPercent(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0%";
  if (value < 1) return "<1%";
  return `${Math.round(value)}%`;
}

function fmtAge(at: number | undefined): string {
  const time = Number(at);
  if (!Number.isFinite(time) || time <= 0) return "never";
  const age = Math.max(0, Date.now() - time);
  if (age < 45_000) return "just now";
  /* Floor, so elapsed time never reads a unit it has not reached yet (59.6m stays 59m). */
  const minutes = Math.max(1, Math.floor(age / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.max(1, Math.floor(minutes / 60));
  if (hours < 36) return `${hours}h ago`;
  return `${Math.max(1, Math.floor(hours / 24))}d ago`;
}

function shortSessionId(id: string): string {
  const clean = String(id || "");
  return clean.length <= 12 ? clean : `…${clean.slice(-6)}`;
}

function statChip(label: string, value: string, sub?: string): HTMLElement {
  const chip = el("span", "fb-stat");
  chip.append(el("span", "fb-stat-label", label), el("span", "fb-stat-value", value));
  if (sub) chip.append(el("span", "fb-stat-sub", sub));
  return chip;
}

function shortModel(value: string | null | undefined): string {
  const text = (typeof value === "string" ? value : String(value ?? "")).trim();
  if (!text) return "model unknown";
  const tail = text.includes("/") ? text.slice(text.lastIndexOf("/") + 1) : text;
  return tail.length > 30 ? `${tail.slice(0, 28)}…` : tail;
}

function isQwenModel(value: string | null | undefined): boolean {
  const text = (value ?? "").toLowerCase();
  return /qwen|unsloth|flash[-_ ]?next|iq4_xs|iq3_xxs|ud-q[2-8]/.test(text);
}

function capText(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.62);
  const tail = Math.floor(max * 0.24);
  return `${text.slice(0, head)}\n\n… [${fmt(text.length - head - tail)} characters trimmed] …\n\n${text.slice(-tail)}`;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 52);
  return slug || "plan";
}

function fileStamp(): string {
  return `${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): (...args: Parameters<T>) => void {
  let timer: number | undefined;
  return (...args: Parameters<T>) => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), ms);
  };
}

function errorCode(error: unknown): string | null {
  return error instanceof HostRequestError ? error.code : null;
}

function describeError(error: unknown): string {
  const code = errorCode(error);
  switch (code) {
    case "NOT_GRANTED":
      return "That permission is not approved. Open Settings → Extensions → Fox Box and approve its capabilities.";
    case "NO_SESSION":
      return "Open a chat first, then try again.";
    case "SESSION_BUSY":
      return "The chat is busy. The text can be placed in the composer instead.";
    case "NO_MODEL":
      return "No Small Model is available. Set one in Settings → Sessions → Small Model.";
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
      return "Fox Box is paused in Settings → Extensions.";
    default:
      if (typeof error === "string" && error.trim()) return error;
      return error instanceof Error ? error.message : "Something went wrong.";
  }
}

function toast(kind: "info" | "success" | "error", message: string): void {
  void host.toast({ kind, message: capText(message, 220) }).catch(() => {
    // A failed toast must never become an unhandled rejection.
  });
}

function showBanner(tone: "info" | "success" | "warning" | "error", title: string, body?: string): void {
  if (!bannerHost) return;
  try {
    bannerHandle?.dispose();
    bannerHost.hidden = false;
    bannerHandle = mountBanner(bannerHost, {
      tone,
      title,
      body,
      action: { label: "Dismiss", onClick: () => clearBanner() },
    });
  } catch {
    bannerHandle = null;
    bannerHost.hidden = true;
  }
}

function clearBanner(): void {
  try {
    bannerHandle?.dispose();
  } catch {
    // A disposed banner is harmless.
  }
  bannerHandle = null;
  if (bannerHost) bannerHost.hidden = true;
}

function notifyError(error: unknown, context: string): void {
  const code = errorCode(error);
  showBanner("error", `${context} failed`, `${describeError(error)}${code ? ` (${code})` : ""}`);
  toast("error", describeError(error));
}

function setFooter(text: string): void {
  footerMessage = text;
  if (footerStatus) footerStatus.textContent = text;
}

function clearPowerResult(id: string): void {
  try {
    resultClearers[id]?.();
  } catch {
    // A result view may have been replaced by a rebuild.
  }
  powerResults[id] = false;
  powerCards.get(id)?.refresh();
}

/* ------------------------------------------------------------------ */
/*  Config                                                            */
/* ------------------------------------------------------------------ */

function defaultConfig(): FoxConfig {
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
        preset: "qwen-thinking",
        applyToQwenOnly: true,
        ...QWEN_PRESETS["qwen-thinking"]!,
        contractEnabled: true,
        contract: DEFAULT_CONTRACT,
        hideTools: [],
      },
    },
  };
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function mergeConfig(input: any): FoxConfig {
  const base = defaultConfig();
  const inputVersion = clampInt(input?.version, 1, CONFIG_VERSION, 1);
  const context = input?.powers?.context ?? {};
  const model = input?.powers?.model ?? {};
  const briefs: Record<string, string> = {};
  if (context.briefs && typeof context.briefs === "object" && !Array.isArray(context.briefs)) {
    for (const [key, value] of Object.entries(context.briefs)) {
      if (typeof key === "string" && typeof value === "string" && value.trim()) {
        briefs[key.slice(0, 260)] = value.slice(0, BRIEF_MAX);
      }
      if (Object.keys(briefs).length >= 60) break;
    }
  }
  const preset = ["qwen-thinking", "qwen-instruct", "balanced", "custom"].includes(model.preset)
    ? model.preset
    : base.powers.model.preset;
  const presetValues = QWEN_PRESETS[preset] ?? QWEN_PRESETS["qwen-thinking"]!;
  const hiddenTools: string[] = [];
  if (Array.isArray(model.hideTools)) {
    for (const name of model.hideTools.slice(0, 24)) {
      if (typeof name !== "string" || !name.trim()) continue;
      const clean = name.trim().slice(0, 64);
      if (clean === "todo") hiddenTools.push("todowrite", "todoread");
      else if (clean === "task" || clean === "subagent") hiddenTools.push("subagent", "task");
      else hiddenTools.push(clean);
    }
  }
  /* Version 1 shipped a 16k default and options that stopped at 32k, which made small models
     re-read files. Upgrade every sub-48k v1 cap once; the panel can still choose any value after. */
  const legacyCap =
    context.maxToolOutput === null || context.maxToolOutput === undefined
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
        preset,
        applyToQwenOnly: model.applyToQwenOnly !== false,
        temperature: clampNumber(
          model.temperature ?? presetValues.temperature,
          0,
          2,
          presetValues.temperature,
        ),
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
        hideTools: Array.from(new Set(hiddenTools)).slice(0, 24),
      },
    },
  };
}

let configTimer: number | undefined;
let savingConfig = false;
let saveAgain = false;
let configLoaded = false;
let configNewer = false;
let configSaveWarned = false;

function queueConfigSave(): void {
  setFooter("Saving rules…");
  if (configTimer !== undefined) window.clearTimeout(configTimer);
  configTimer = window.setTimeout(() => {
    configTimer = undefined;
    void saveConfigNow();
  }, 320);
}

async function saveConfigNow(): Promise<void> {
  if (!configLoaded || configNewer) {
    setFooter("Rules not saved");
    if (!configSaveWarned) {
      configSaveWarned = true;
      showBanner(
        "error",
        configNewer ? "Rules need a newer Fox Box" : "Rules could not be saved",
        configNewer
          ? "This config file was written by a newer Fox Box version. Update the extension before saving; changes stay in memory for now."
          : "Fox Box could not load its config file, so it will not overwrite it. Fix or remove ~/.config/openchamber/fox-box/config.json, or approve Fox Box's file access in Settings → Extensions, then reopen the panel.",
      );
    }
    return;
  }
  if (savingConfig) {
    saveAgain = true;
    return;
  }
  savingConfig = true;
  try {
    do {
      saveAgain = false;
      const snapshot = JSON.stringify(config, null, 2);
      try {
        await host.writeFile(CONFIG_PATH, snapshot);
        setFooter("Rules saved");
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
}

async function loadConfig(): Promise<void> {
  try {
    const { content } = await host.readFile(CONFIG_PATH);
    const raw = JSON.parse(content.replace(/^\uFEFF/, ""));
    config = mergeConfig(raw);
    configLoaded = true;
    configSaveWarned = false;
    const rawVersion = Number(raw?.version);
    configNewer = Number.isFinite(rawVersion) && rawVersion > CONFIG_VERSION;
    if (!Number.isFinite(rawVersion) || rawVersion < CONFIG_VERSION) {
      /* Older schemas are normalized and rewritten so panel and plugin agree. Never downgrade
         a newer file just by opening the panel. */
      try {
        await host.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
      } catch {
        // A read-only or ungranted file still lets the panel run from the in-memory config.
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
    config = defaultConfig();
    configLoaded = false;
    configNewer = false;
    setFooter("Local rules only");
    if (errorCode(error) !== "NOT_GRANTED") notifyError(error, "Loading rules");
  }
}

function currentBrief(): string {
  return config.powers.context.briefs[projectKey] ?? "";
}

function setCurrentBrief(value: string): void {
  const next = value.slice(0, BRIEF_MAX);
  if (next.trim()) config.powers.context.briefs[projectKey] = next;
  else delete config.powers.context.briefs[projectKey];
  queueConfigSave();
}

/* ------------------------------------------------------------------ */
/*  Status and model helpers                                          */
/* ------------------------------------------------------------------ */

function sessionId(): string {
  return ready?.session?.id ?? "";
}

function sessionModel(): string {
  return ready?.session?.model ?? "";
}

function hasSession(): boolean {
  return Boolean(ready?.session?.id);
}

function modelApplies(): boolean {
  const model = config.powers.model;
  if (!model.enabled) return false;
  if (!model.applyToQwenOnly) return true;
  return isQwenModel(sessionModel());
}

/*
 * Prefer the model's own measurement over the 4-chars/token rule. OpenChamber's session
 * record gives the token count of the latest step; dividing it by the characters Fox Box
 * actually sent for that request yields this model's average tokens per character.
 * The meter can be absent (before a step, after compaction) or from another session, so
 * fall back to the old estimate whenever the pair does not line up or looks impossible.
 */
const FALLBACK_TOKENS_PER_CHAR = 0.25;

function tokenEstimate(): { perChar: number; measured: boolean } {
  const last = pluginStatus?.last;
  const tokens = amount(currentSessionRecord?.context?.tokens);
  const chars = amount(last?.keptChars);
  if (
    !config.powers.context.enabled ||
    !last ||
    last.sessionId !== sessionId() ||
    tokens <= 0 ||
    chars <= 0
  ) {
    return { perChar: FALLBACK_TOKENS_PER_CHAR, measured: false };
  }
  const perChar = tokens / chars;
  if (!Number.isFinite(perChar) || perChar < 0.05 || perChar > 2) {
    return { perChar: FALLBACK_TOKENS_PER_CHAR, measured: false };
  }
  return { perChar, measured: true };
}

function tokensForChars(chars: number, estimate = tokenEstimate()): number {
  return Math.round(Math.max(0, chars) * estimate.perChar);
}

/*
 * Per-session latest-request fields arrived after the original ledger. Read them from the
 * session record when present, otherwise borrow the same field from the global last request
 * if that request belongs to this chat; that keeps the panel correct while an older status
 * file is still on disk.
 */
function latestRequestNumber(
  entryKey: keyof PluginSessionMetrics,
  lastKey: keyof NonNullable<PluginStatus["last"]>,
): number {
  const entry = currentPluginSession();
  const direct = entry ? entry[entryKey] : undefined;
  if (typeof direct === "number") return amount(direct);
  const last = pluginStatus?.last;
  if (last && last.sessionId === sessionId()) {
    const fallback = last[lastKey];
    if (typeof fallback === "number") return amount(fallback);
  }
  return 0;
}

function tokenBasisText(estimate = tokenEstimate()): string {
  return estimate.measured
    ? `${estimate.perChar.toFixed(2)} tokens per character, measured from the latest request`
    : "4 characters per token, the fallback";
}

function pluginIsLive(): boolean {
  if (!pluginStatus || pluginStatus.stopped) return false;
  const at = pluginStatus.updatedAt ?? pluginStatus.loadedAt ?? 0;
  return at > 0 && Date.now() - at < 120_000;
}

function pluginLabel(): { text: string; tone: string } {
  if (!pluginStatus) return { text: "Plugin waiting", tone: "warning" };
  if (pluginStatus.stopped) return { text: "Plugin stopped", tone: "warning" };
  const at = pluginStatus.updatedAt ?? pluginStatus.loadedAt ?? 0;
  const age = Date.now() - at;
  if (age < 30_000) return { text: "Plugin active", tone: "success" };
  if (age < 120_000) return { text: "Plugin connected", tone: "success" };
  return { text: "Plugin stale", tone: "warning" };
}

function currentPluginSession(): NonNullable<PluginStatus["sessions"]>[string] | null {
  const id = sessionId();
  const sessions = pluginStatus?.sessions;
  if (!id || !sessions) return null;
  return sessions[id] ?? null;
}

function guardSummary(): string {
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
    return `Guarded ${runs} request${runs === 1 ? "" : "s"} in this session · latest request pruned ${fmtCompact(
      lastSaved,
    )} chars · ${lastCollapsed} repeat${lastCollapsed === 1 ? "" : "s"} collapsed.`;
  }
  return "Plugin ready · no request from this session yet.";
}

function activePowerNames(): string[] {
  const names: string[] = [];
  if (!hasSession() || !pluginIsLive()) return names;
  if (config.powers.context.enabled) names.push("Context guard");
  if (modelApplies()) names.push("Qwen fit");
  return names;
}

/* ------------------------------------------------------------------ */
/*  Session strip                                                     */
/* ------------------------------------------------------------------ */

function buildSessionStrip(): HTMLElement {
  const strip = el("section", "fb-session");
  const top = el("div", "fb-session-top");
  sessionDot = el("span", "fb-dot");
  sessionDot.dataset.tone = "idle";
  sessionNameEl = el("div", "fb-session-name fb-empty", "No session open");
  sessionActivityEl = el("span", "fb-live");
  sessionActivityEl.append(sessionDot, el("span", "", "idle"));
  sessionModelChip = el("span", "fb-chip", "model unknown");
  top.append(sessionNameEl, sessionActivityEl, sessionModelChip);

  const meterLine = el("div", "fb-meter-line");
  meterLine.append(el("span", "", "Context window"));
  sessionMeterText = el("span", "", "Open a chat to see its context.");
  meterLine.append(sessionMeterText);

  const meterHost = el("div", "fb-meter-host");
  sessionProgress = mountProgress(meterHost, { value: 0, tone: "neutral", label: "" });

  sessionStatsEl = el("div", "fb-stats");
  sessionStatsEl.hidden = true;

  sessionPowersEl = el("div", "fb-powers-line");

  const guardLine = el("div", "fb-note");
  sessionGuardEl = el("span", "", "Waiting for the plugin.");
  guardLine.append(sessionGuardEl);

  strip.append(top, meterLine, meterHost, sessionStatsEl, sessionPowersEl, guardLine);
  return strip;
}

function updateSessionUI(): void {
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
    const activityText: Record<string, string> = {
      running: "working",
      idle: "idle",
      retrying: "retrying",
      "waiting-permission": "waiting",
      "waiting-question": "waiting",
      unknown: session ? "idle" : "no chat",
    };
    const textNode = sessionActivityEl.querySelector("span:last-child");
    if (textNode) textNode.textContent = activityText[activity] ?? activity;
    sessionDot.dataset.tone =
      activity === "running" || activity === "retrying"
        ? "warning"
        : activity === "waiting-permission" || activity === "waiting-question"
          ? "error"
          : "idle";
  }

  const context = record?.context;
  if (context && context.tokens > 0) {
    const limit = context.limit && context.limit > 0 ? context.limit : 0;
    const percent = limit > 0 ? Math.min(100, (context.tokens / limit) * 100) : 0;
    if (sessionMeterText) {
      sessionMeterText.textContent = limit > 0
        ? `${fmtCompact(context.tokens)} / ${fmtCompact(limit)} tokens`
        : `${fmtCompact(context.tokens)} tokens in context`;
    }
    sessionProgress?.update({
      value: percent,
      tone: percent >= 90 ? "error" : percent >= 70 ? "warning" : "primary",
      label: "",
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
          lastSaved > 0 ? `≈${fmtCompact(tokensForChars(lastSaved, estimate))} tok` : "latest request",
        ),
        statChip(
          "Saved now",
          lastTotal > 0 ? fmtPercent(lastRate) : "—",
          "of the latest request",
        ),
        statChip(
          "Repeats now",
          String(lastCollapsed),
          lastCollapsed > 0 ? `${fmtCompact(lastCollapsedChars)} chars` : "none",
        ),
        statChip(
          "Cumulative",
          `${fmtCompact(totalPruned)} chars`,
          `≈${fmtCompact(tokensForChars(totalPruned, estimate))} tok · ${runs} req`,
        ),
      );
    }
  }

  if (sessionPowersEl) {
    sessionPowersEl.replaceChildren();
    const names = activePowerNames();
    const label = el("span");
    label.append(el("strong", "", names.length ? "Live" : "Idle"));
    sessionPowersEl.append(label);
    if (names.length) {
      for (const name of names) sessionPowersEl.append(el("span", "fb-chip", name));
    } else {
      sessionPowersEl.append(el("span", "fb-chip", "no automatic powers"));
    }
    const plugin = pluginLabel();
    const pluginChip = el("span", "fb-chip", plugin.text);
    pluginChip.dataset.tone = plugin.tone;
    sessionPowersEl.append(pluginChip);
  }

  if (sessionGuardEl) sessionGuardEl.textContent = guardSummary();
  if (sessionProgress && !context) {
    sessionProgress.update({ value: 0, tone: "neutral", label: "" });
  }
}

/* ------------------------------------------------------------------ */
/*  Banner and footer                                                 */
/* ------------------------------------------------------------------ */

function buildBannerHost(): HTMLElement {
  const node = el("div");
  node.hidden = true;
  bannerHost = node;
  return node;
}

function buildFooter(): HTMLElement {
  const footer = el("footer", "fb-footer");
  footerStatus = el("span", "", footerMessage);
  footerPlugin = el("span", "fb-inline");
  const plugin = pluginLabel();
  footerPlugin.append(el("span", "fb-chip", plugin.text));
  const sep = el("span", "fb-sep");
  const path = el("code", "", "~/.config/openchamber/fox-box/config.json");
  footer.append(footerStatus, sep, footerPlugin, sep, path);
  return footer;
}

/* ------------------------------------------------------------------ */
/*  Shared control helpers                                            */
/* ------------------------------------------------------------------ */

function group(parent: HTMLElement, title: string): HTMLElement {
  const node = el("div", "fb-group");
  node.append(el("div", "fb-group-title", title));
  parent.append(node);
  return node;
}

function addSwitch(
  parent: HTMLElement,
  label: string,
  description: string | undefined,
  get: () => boolean,
  set: (value: boolean) => void,
  save = true,
): Handle {
  const hostNode = el("div");
  parent.append(hostNode);
  let handle: Handle | null = null;
  handle = mountSwitch(hostNode, {
    label,
    description,
    checked: get(),
    onChange: (value) => {
      /* The SDK control is controlled: without this update its thumb and aria state stay stale,
         and the next click toggles the old value again. */
      handle?.update({ checked: value });
      set(value);
      if (save) void saveConfigNow();
      refreshAll();
    },
  });
  return handle;
}

function addSelect(
  parent: HTMLElement,
  label: string,
  options: Array<{ id: string; label: string; hint?: string }>,
  get: () => string,
  set: (value: string) => void,
  save = true,
): Handle {
  const hostNode = el("div");
  parent.append(hostNode);
  let handle: Handle | null = null;
  const current = get();
  const usableOptions = options.some((option) => option.id === current)
    ? options
    : [...options, { id: current, label: current || "Custom" }];
  handle = mountSelect(hostNode, {
    label,
    value: current,
    options: usableOptions,
    onChange: (value) => {
      /* Same controlled-widget rule as addSwitch: paint the chosen value or the label never changes. */
      handle?.update({ value });
      set(value);
      if (save) void saveConfigNow();
      refreshAll();
    },
  });
  return handle;
}

function addCheckbox(
  parent: HTMLElement,
  label: string,
  description: string | undefined,
  get: () => boolean,
  set: (value: boolean) => void,
  save = false,
): Handle {
  const hostNode = el("div");
  parent.append(hostNode);
  let handle: Handle | null = null;
  handle = mountCheckbox(hostNode, {
    label,
    description,
    checked: get(),
    onChange: (value) => {
      handle?.update({ checked: value });
      set(value);
      if (save) void saveConfigNow();
      refreshAll();
    },
  });
  return handle;
}

function addText(
  parent: HTMLElement,
  label: string,
  value: string,
  onChange: (value: string) => void,
  options: {
    multiline?: boolean;
    rows?: number;
    helper?: string;
    placeholder?: string;
    mono?: boolean;
    onCommit?: () => void;
  } = {},
): Handle {
  const hostNode = el("div");
  parent.append(hostNode);
  const handle = mountTextField(hostNode, {
    label,
    value,
    multiline: options.multiline,
    rows: options.rows,
    helper: options.helper,
    placeholder: options.placeholder,
    mono: options.mono,
    onChange,
  });
  if (options.onCommit) {
    const input = hostNode.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
    input?.addEventListener("change", options.onCommit);
    input?.addEventListener("blur", options.onCommit);
  }
  return handle;
}

function addButton(
  parent: HTMLElement,
  label: string,
  variant: "default" | "secondary" | "outline" | "ghost" | "destructive",
  onClick: () => void,
  size: "default" | "sm" | "xs" = "sm",
): ButtonHandle {
  const hostNode = el("span");
  parent.append(hostNode);
  return mountButton(hostNode, { label, variant, size, onClick });
}

function addResult(parent: HTMLElement): { node: HTMLElement; set: (text: string) => void } {
  const node = el("div", "fb-result");
  node.hidden = true;
  const inner = el("div");
  node.append(inner);
  parent.append(node);
  const textHandle = mountText(inner, {
    text: "",
    onOpenUrl: (url) => {
      void host.openUrl(url).catch(() => {});
    },
  });
  return {
    node,
    set: (text: string) => {
      node.hidden = !text.trim();
      textHandle.update({ text });
      node.scrollTop = 0;
    },
  };
}

function addActions(parent: HTMLElement): HTMLElement {
  const row = el("div", "fb-actions");
  parent.append(row);
  return row;
}

function addNote(parent: HTMLElement, text: string): HTMLElement {
  const node = el("div", "fb-note");
  node.textContent = text;
  parent.append(node);
  return node;
}

/* ------------------------------------------------------------------ */
/*  Prompt and artifact helpers                                       */
/* ------------------------------------------------------------------ */

async function withBusy(button: ButtonHandle, work: () => Promise<void>): Promise<void> {
  try {
    button.update({ loading: true, disabled: true });
  } catch {
    // A detached button still lets the work run.
  }
  try {
    await work();
  } catch (error) {
    notifyError(error, "Fox Box");
  } finally {
    try {
      button.update({ loading: false, disabled: false });
    } catch {
      // The control may have been replaced by a rebuild.
    }
  }
}

async function composeText(text: string, mode: "append" | "replace" = "append"): Promise<void> {
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

async function sendToSession(text: string, label: string): Promise<void> {
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
        toast("info", "Chat busy — placed in the composer.");
        return;
      } catch {
        // Fall through to the normal error.
      }
    }
    notifyError(error, "Sending to chat");
  }
}

async function startFreshSession(title: string, text: string): Promise<void> {
  if (!text.trim()) {
    toast("info", "Nothing to start a chat with yet.");
    return;
  }
  try {
    const result: any = await host.startSession({
      providerId: "fox-box",
      id: `foxbox-${uid()}`,
      title: title.slice(0, 200),
      text: capText(text, PROMPT_MAX),
      navigation: "open",
    } as any);
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

async function attachText(
  title: string,
  text: string,
  data?: { power: string; characterId: string },
): Promise<void> {
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
      data,
    });
    toast("success", "Attached to the composer.");
  } catch (error) {
    notifyError(error, "Attaching");
  }
}

async function copyText(text: string): Promise<void> {
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

async function generateText(
  button: ButtonHandle,
  system: string,
  prompt: string,
  maxOutputTokens = 1600,
): Promise<string | null> {
  let result: string | null = null;
  await withBusy(button, async () => {
    try {
      const answer = await host.generate({
        system: capText(system, 8000),
        prompt: capText(prompt, 60000),
        maxOutputTokens,
      });
      result = answer.text.trim();
    } catch (error) {
      notifyError(error, "Generation");
    }
  });
  return result;
}

/*
 * Fill only the empty fields of a small-model form. This deliberately stays on the
 * host.generate path: it never sends anything to the chat agent. The apply callback
 * returns false when the form changed while generation was running.
 */
async function fillMissingFields(
  button: ButtonHandle,
  options: {
    noun: string;
    fields: FillField[];
    system: string;
    context?: string;
    maxOutputTokens?: number;
  },
  apply: (values: Record<string, string>) => number | boolean | void,
): Promise<void> {
  const missing = options.fields.filter((field) => !field.value.trim());
  if (!missing.length) {
    toast("info", `Nothing to fill in the ${options.noun}.`);
    return;
  }
  const written = options.fields
    .filter((field) => field.value.trim())
    .map((field) => `${field.label} (${field.key}):\n${field.value}`);
  const shape: Record<string, string> = {};
  for (const field of missing) shape[field.key] = "string";
  const notes = missing
    .map((field) => `- ${field.key}: ${field.label}; at most ${field.max} characters${field.hint ? `; ${field.hint}` : ""}`)
    .join("\n");
  const prompt = [
    `Fill the empty fields of this ${options.noun}.`,
    written.length
      ? `Fields already written (keep consistent with them; do not return these keys):\n${written.join("\n\n")}`
      : `The ${options.noun} is empty. Invent a coherent one.`,
    options.context?.trim() ? `Context:\n${options.context.trim().slice(0, 12000)}` : "",
    `Return a JSON object with exactly these keys:\n${JSON.stringify(shape, null, 2)}`,
    `Field limits and intent:\n${notes}`,
    "Use string values only. Do not return empty strings. No markdown fences, no commentary.",
  ]
    .filter(Boolean)
    .join("\n\n");
  const result = await generateText(
    button,
    `${options.system}\nReturn JSON only.`,
    prompt,
    options.maxOutputTokens ?? 1200,
  );
  if (!result) return;
  const parsed = extractJsonObject(result);
  if (!parsed) {
    showBanner(
      "warning",
      "Fill blanks could not read the answer",
      "The Small Model did not return usable JSON. Try again, or fill the empty fields by hand.",
    );
    return;
  }
  const values = fillValuesFromJson(parsed, missing);
  if (!Object.keys(values).length) {
    showBanner(
      "warning",
      "Fill blanks came back empty",
      "The Small Model returned no usable fields. Try again, or fill the empty fields by hand.",
    );
    return;
  }
  let applied: number | boolean | void;
  try {
    applied = apply(values);
  } catch (error) {
    notifyError(error, "Filling blank fields");
    return;
  }
  if (applied === false) return;
  const parsedCount = Object.keys(values).length;
  const appliedCount =
    typeof applied === "number" ? Math.min(parsedCount, Math.max(0, Math.floor(applied))) : parsedCount;
  if (appliedCount <= 0) return;
  const left = Math.max(0, missing.length - appliedCount);
  toast(
    "success",
    `Filled ${appliedCount} field${appliedCount === 1 ? "" : "s"}${left > 0 ? `; ${left} left blank` : ""}.`,
  );
}


async function readOptional(path: string): Promise<string | null> {
  try {
    const { content } = await host.readFile(normalizeGuestPath(path));
    return content;
  } catch {
    return null;
  }
}

function normalizeGuestPath(path: string): string {
  return String(path || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
}

function relativeToProject(absolute: string): string | null {
  const dir = ready?.directory;
  if (!dir) return null;
  const normalDir = dir.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalPath = absolute.replace(/\\/g, "/");
  if (normalPath.toLowerCase() === normalDir.toLowerCase()) return "";
  if (!normalPath.toLowerCase().startsWith(`${normalDir.toLowerCase()}/`)) return null;
  return normalPath.slice(normalDir.length + 1);
}

async function detectProject(): Promise<StackInfo> {
  const dir = ready?.directory;
  const key = normalizeDir(dir);
  if (projectScan && projectScan.key === key) return projectScan;

  const parts: string[] = [];
  let label = "Unknown stack";
  let isGame = false;

  const pkgRaw = await readOptional("package.json");
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw);
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      const names = Object.keys(deps);
      const known = names.filter((name) =>
        ["react", "vue", "svelte", "solid-js", "next", "vite", "electron", "three", "phaser", "pixi.js", "bevy", "typescript", "express", "fastify", "tauri"].some(
          (needle) => name === needle || name.startsWith(`${needle}/`),
        ),
      );
      label = known.length ? `JavaScript · ${known.slice(0, 4).join(", ")}` : "JavaScript / Node";
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
    const names = Array.from(deps.matchAll(/^\s*([a-zA-Z0-9_-]+)\s*=/gm))
      .map((match) => match[1])
      .filter((name): name is string => Boolean(name));
    const game = names.some((name) => ["bevy", "macroquad", "ggez", "fyrox", "amethyst"].includes(name));
    isGame = isGame || game;
    label = game ? `Rust · ${names.find((name) => ["bevy", "macroquad", "ggez", "fyrox"].includes(name))}` : "Rust";
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
    // Listing is optional.
  }

  projectScan = {
    key,
    label,
    isGame,
    summary: parts.join("\n").slice(0, 3600),
  };
  return projectScan;
}

/* ------------------------------------------------------------------ */
/*  Context Keeper                                                    */
/* ------------------------------------------------------------------ */

function buildContextKeeper(parent: HTMLElement): void {
  const live = el("div", "fb-note");
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
    /* Status is user-writable; every number from it goes through amount(). */
    const runs = amount(entry.runs);
    const lastSaved = amount(entry.lastSaved);
    const lastCollapsed = latestRequestNumber("lastCollapsed", "collapsed");
    live.textContent = `This session: ${runs} request${runs === 1 ? "" : "s"} guarded · latest request pruned ${fmtCompact(
      lastSaved,
    )} chars · ${lastCollapsed} repeat${lastCollapsed === 1 ? "" : "s"} collapsed.`;
  };
  refreshLive();
  powerUpdaters["context-keeper"] = refreshLive;

  addSwitch(
    parent,
    "Context Keeper active",
    "Applies this project’s rules to outgoing requests only. Nothing is rewritten on disk.",
    () => config.powers.context.enabled,
    (value) => {
      config.powers.context.enabled = value;
    },
  );

  const protection = group(parent, "Protection");
  addSwitch(
    protection,
    "Shield skill files",
    "The newest read of a SKILL.md, a skill-tool result, or a pinned path stays whole until that exact read is replaced by a newer one.",
    () => config.powers.context.protectSkills,
    (value) => {
      config.powers.context.protectSkills = value;
    },
  );
  const protectionGrid = el("div", "fb-grid2");
  protection.append(protectionGrid);
  addSelect(
    protectionGrid,
    "Keep recent messages",
    [2, 4, 6, 8, 10, 12, 16, 20, 24, 32, 40].map((value) => ({ id: String(value), label: String(value) })),
    () => String(config.powers.context.keepRecent),
    (value) => {
      config.powers.context.keepRecent = Number(value) || 10;
    },
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
      { id: "12", label: "12 files", hint: "max" },
    ],
    () => String(config.powers.context.protectedReads),
    (value) => {
      config.powers.context.protectedReads = Number(value) || 0;
    },
  );
  addNote(
    protection,
    "The newest read of these files keeps the fresh result cap even after it ages. While shielding is on, skills and pinned paths are outside this limit and stay whole until read again.",
  );
  addText(
    protection,
    "Pinned paths",
    config.powers.context.protectPaths,
    (value) => {
      config.powers.context.protectPaths = value.slice(0, 4000);
      queueConfigSave();
    },
    {
      multiline: true,
      rows: 3,
      helper: "One path or glob per line, e.g. src/core/** or README.md. The newest read of a matched file is kept whole.",
      placeholder: "src/core/**\ndocs/*.md",
    },
  );

  const pruning = group(parent, "Pruning");
  addSwitch(
    pruning,
    "Trim tool output",
    "Caps fresh results and shortens old ones in the outgoing request. The newest skill or pinned read stays whole; older duplicates may be collapsed.",
    () => config.powers.context.trimToolOutput,
    (value) => {
      config.powers.context.trimToolOutput = value;
    },
  );
  addSwitch(
    pruning,
    "Collapse repeated calls",
    "When the same read, search, web, or shell call appears again, keep the newest result and replace older copies with a one-line pointer. Works even when trimming is off.",
    () => config.powers.context.collapseDuplicates,
    (value) => {
      config.powers.context.collapseDuplicates = value;
    },
  );
  const pruningGrid = el("div", "fb-grid2");
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
      { id: "48000", label: "48k chars", hint: "default" },
      { id: "64000", label: "64k chars" },
      { id: "96000", label: "96k chars" },
      { id: "128000", label: "128k chars" },
      { id: "192000", label: "192k chars" },
      { id: "256000", label: "256k chars", hint: "almost never trim" },
    ],
    () => String(config.powers.context.maxToolOutput),
    (value) => {
      config.powers.context.maxToolOutput = Number(value) || 48000;
    },
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
      { id: "64000", label: "64k chars" },
    ],
    () => String(config.powers.context.maxOldToolOutput),
    (value) => {
      config.powers.context.maxOldToolOutput = Number(value) || 6000;
    },
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
      placeholder: "The thing this project is really about, and the rules that must not drift.",
    },
  );
  handles["context-brief"] = brief;

  addNote(
    parent,
    "Pruning only changes what the model sees in the outgoing request. Your messages on disk are untouched.",
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
          "Restart OpenCode or enable Fox Box in Settings → Extensions. Without it, /foxbox-compact is not a command.",
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
      `Pinned paths: ${config.powers.context.protectPaths.trim() || "none"}`,
      `Focus brief: ${currentBrief().trim() || "empty"}`,
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
          "Fox Box is still using its in-memory rules. Fix or remove ~/.config/openchamber/fox-box/config.json, or approve its file access, then try again.",
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
          "This config file was written by a newer Fox Box version. Update the extension before saving; changes stay in memory for now.",
        );
        configSaveWarned = true;
        return;
      }
      toast("success", "Rules reloaded.");
    });
  });
}

/* ------------------------------------------------------------------ */
/*  Handoff Passport                                                  */
/* ------------------------------------------------------------------ */

function handoffConversationText(): string {
  const messages = handoffState.messages ?? [];
  const lines: string[] = [];
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

function buildHandoff(parent: HTMLElement): void {
  const capture = el("div", "fb-capture");
  parent.append(capture);
  const refreshCapture = () => {
    const count = handoffState.messages?.length ?? 0;
    capture.replaceChildren();
    if (count > 0) {
      capture.append(el("b", "", `${count} messages`), document.createTextNode(` captured from “${handoffState.title || "this session"}”.`));
      if (handoffState.truncated) {
        capture.append(document.createTextNode(" Older messages were dropped to fit the attach limit."));
      }
    } else {
      capture.append(document.createTextNode("Open this from a chat’s ⋯ menu → "), el("b", "", "Fox Box: build handoff"), document.createTextNode(" to capture the conversation."));
    }
  };
  refreshCapture();
  powerUpdaters["handoff"] = refreshCapture;

  const notes = addText(
    parent,
    "Notes to carry",
    handoffState.notes,
    (value) => {
      handoffState.notes = value.slice(0, 6000);
      handoffState.result = "";
      clearPowerResult("handoff");
    },
    {
      multiline: true,
      rows: 3,
      helper: "Optional. This is added to the captured conversation when you distill.",
      placeholder: "What matters, what changed, what not to repeat…",
    },
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
        "Be concrete and terse. Keep only facts that change the next action. Mark guesses as guesses. Never invent file paths, commands, or results.",
      ].join("\n");
      const prompt = [
        "Build a handoff passport from the material below. It must let a fresh session continue without the old chat history.",
        conversation ? `Conversation:\n<conversation>\n${conversation}\n</conversation>` : "",
        notesText ? `Extra notes:\n<notes>\n${capText(notesText, 4000)}\n</notes>` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
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
  resultClearers["handoff"] = () => setResult("");

  const resultActions = addActions(parent);
  addButton(resultActions, "Start fresh chat", "secondary", () => {
    if (!handoffState.result) {
      toast("info", "Distill a passport first.");
      return;
    }
    void startFreshSession(
      `Handoff: ${handoffState.title || "continue"}`,
      `${handoffState.result}\n\nContinue this work from the passport. Start by restating the goal and the first next move, then proceed.`,
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

  const details = el("details", "fb-details");
  details.append(
    el("summary", "", "Why this is not memory"),
    el(
      "div",
      "fb-note",
      "A passport is a one-time artifact you choose to carry. It is not stored in a background memory and nothing is recalled automatically.",
    ),
  );
  parent.append(details);
}

/* ------------------------------------------------------------------ */
/*  Slice Forge                                                       */
/* ------------------------------------------------------------------ */

function buildSliceForge(parent: HTMLElement): void {
  const stackLine = el("div", "fb-note", "Project scan: will run when you forge.");
  parent.append(stackLine);

  const topGrid = el("div", "fb-grid2");
  parent.append(topGrid);
  addSelect(
    topGrid,
    "Slice type",
    [
      { id: "feature", label: "Feature", hint: "inside an existing project" },
      { id: "app", label: "App", hint: "new product" },
      { id: "game", label: "Game", hint: "playable loop" },
      { id: "tool", label: "Tool", hint: "utility or extension" },
    ],
    () => sliceState.mode,
    (value) => {
      sliceState.mode = value;
      sliceState.result = "";
      clearPowerResult("slice");
    },
    false,
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
    false,
  );

  const goal = addText(
    parent,
    "What are we building?",
    sliceState.goal,
    (value) => {
      sliceState.goal = value.slice(0, 6000);
      sliceState.result = "";
      clearPowerResult("slice");
    },
    {
      multiline: true,
      rows: 4,
      placeholder: "A vertical slice of… The one thing it must do is…",
    },
  );
  handles["slice-goal"] = goal;

  const constraints = addText(
    parent,
    "Constraints",
    sliceState.constraints,
    (value) => {
      sliceState.constraints = value.slice(0, 3000);
      sliceState.result = "";
      clearPowerResult("slice");
    },
    {
      multiline: true,
      rows: 2,
      helper: "Stack, time, scope, things not to touch, definition of done.",
      placeholder: "Keep the current save format. No new dependencies. One evening.",
    },
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
    false,
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
    false,
  );

  const sections = [
    "# Slice",
    "## Outcome",
    "## Non-goals",
    "## Steps",
    "## Acceptance checks",
    "## Risks",
    "## First prompt",
  ];
  const briefReasoning =
    "Reasoning effort is set to low. Keep your thinking brief and focused, moving directly to the conclusion without unnecessary elaboration.";
  const system = [
    /* This is the model chat template's own low-reasoning system line, not a generic
       concision hint. generate() exposes no reasoning_effort field, so it is the only
       way to request low effort; a model without that template may ignore it. */
    sliceState.brief ? briefReasoning : "",
    "You are a senior product engineer and game designer.",
    "Turn a goal into one vertical slice that a small coding model can execute.",
    "Return markdown only, with these sections:",
    ...sections,
    "Each step must name concrete files or areas, one deliverable, and a verification. Keep steps small. Do not pad. If something is unknown, put it under Risks instead of inventing it.",
  ]
    .filter(Boolean)
    .join("\n");
  const promptFor = (stack: string) =>
    [
      `Slice type: ${sliceState.mode}`,
      `Goal: ${sliceState.goal}`,
      sliceState.constraints.trim() ? `Constraints: ${sliceState.constraints}` : "",
      stack ? `Project scan:\n${stack}` : "",
      sliceState.small
        ? "Use 3 to 5 steps. Each step should fit in one short work session. The first step must be the smallest end-to-end proof."
        : "Use as many steps as the work needs, but keep each independently verifiable.",
    ]
      .filter(Boolean)
      .join("\n\n");
  /* Shared by both buttons: the scan is optional and its failure never blocks the forge. */
  const gatherScan = async (): Promise<string> => {
    if (!sliceState.scan) return "";
    try {
      const info = await detectProject();
      stackLine.textContent = `Project scan: ${info.label}${info.isGame ? " · game project" : ""}.`;
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
        stack ? `Project scan:\n${stack}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      await fillMissingFields(
        fill,
        {
          noun: "slice brief",
          system: [
            "You fill a short slice brief for a coding assistant.",
            "Write one concrete, testable goal and practical constraints: stack, scope, time, things not to touch, definition of done.",
            "Do not plan the whole project. Do not invent file paths or commands; keep names generic when unknown.",
          ].join("\n"),
          context,
          maxOutputTokens: 1000,
          fields: [
            {
              key: "goal",
              label: "Goal",
              value: sliceState.goal,
              max: 900,
              hint: "one vertical slice with a visible result",
            },
            {
              key: "constraints",
              label: "Constraints",
              value: sliceState.constraints,
              max: 700,
              hint: "stack, time, scope, things not to touch, definition of done",
            },
          ],
        },
        (values) => {
          let applied = 0;
          if (values.goal !== undefined && !sliceState.goal.trim()) {
            sliceState.goal = values.goal;
            handles["slice-goal"]?.update({ value: values.goal });
            applied += 1;
          }
          if (values.constraints !== undefined && !sliceState.constraints.trim()) {
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
        },
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
        /* A reasoning Small Model can take minutes on one non-streaming call. Catch the
           failure here so the banner can point at Forge in chat instead of dead-ending. */
        const answer = await host.generate({
          system: capText(system, 8000),
          prompt: capText(promptFor(stack), 60000),
          maxOutputTokens: 2400,
        });
        const result = answer.text.trim();
        if (!result) {
          showBanner(
            "warning",
            "The Small Model returned no slice",
            "It may have spent its whole output budget on reasoning. Try Forge in chat, or shorten the goal and constraints.",
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
          `${describeError(error)} Use Forge in chat to hand this same brief to the chat agent${
            code ? ` (${code})` : ""
          }.`,
        );
        toast("error", "Forge failed — try Forge in chat.");
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
        "Each step must name concrete files or areas, one deliverable, and a verification. Keep steps small. If something is unknown, put it under Risks instead of inventing it. Stop after the plan.",
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
    "Forge slice uses the Small Model and waits for one complete answer. Forge in chat hands the same brief to the chat agent, which streams, can read the repo, and is not bound by the panel's one-shot generation call. Fill blanks is a separate Small Model call: it only writes empty goal or constraint fields and is never run by Forge in chat or Send to agent.",
  );

  const { node: resultHost, set: setResult } = addResult(parent);
  resultClearers["slice"] = () => setResult("");
  const resultActions = addActions(parent);
  addButton(resultActions, "Send to agent", "secondary", () => {
    if (!sliceState.result) {
      toast("info", "Forge a slice first.");
      return;
    }
    void sendToSession(
      `Execute this slice. Start with step 1 only. Inspect the files named before editing, then report the verification result.\n\n${sliceState.result}`,
      "Slice sent to the agent.",
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
      stackLine.textContent = `Project scan: ${projectScan.label}${projectScan.isGame ? " · game project" : ""}.`;
    }
  };
}

/* ------------------------------------------------------------------ */
/*  Bug Hunter                                                        */
/* ------------------------------------------------------------------ */

function buildBugHunter(parent: HTMLElement): void {
  const capture = el("div", "fb-capture");
  parent.append(capture);
  const refreshCapture = () => {
    capture.replaceChildren();
    if (bugState.symptom.trim()) {
      capture.append(el("b", "", "Symptom captured."), document.createTextNode(" Review it below, add where it happens, then hunt."));
    } else {
      capture.append(document.createTextNode("Select an error in chat → "), el("b", "", "Fox Box: hunt this bug"), document.createTextNode(", or paste the symptom below."));
    }
  };
  refreshCapture();
  powerUpdaters["bug"] = refreshCapture;

  const symptom = addText(
    parent,
    "Symptom, error, or stack trace",
    bugState.symptom,
    (value) => {
      bugState.symptom = value.slice(0, 8000);
      bugState.result = "";
      clearPowerResult("bug");
    },
    {
      multiline: true,
      rows: 5,
      placeholder: "What happens, what should happen, the exact error…",
    },
  );
  handles["bug-symptom"] = symptom;

  const grid = el("div", "fb-grid2");
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
    { placeholder: "src/parser.ts:118, save/load, multiplayer…" },
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
    { placeholder: "Last feature, dependency bump, content change…" },
  );
  addSelect(
    parent,
    "Hunt focus",
    [
      { id: "full", label: "Full hunt", hint: "repro, cause, fix, guard" },
      { id: "repro", label: "Reproduce first" },
      { id: "cause", label: "Root cause" },
      { id: "fix", label: "Fix plan" },
      { id: "guard", label: "Regression guard" },
    ],
    () => bugState.focus,
    (value) => {
      bugState.focus = value;
      bugState.result = "";
      clearPowerResult("bug");
    },
    false,
  );
  addSwitch(
    parent,
    "Read the referenced file",
    "If “where” names a file, include a capped excerpt in the prompt.",
    () => bugState.includeFile,
    (value) => {
      bugState.includeFile = value;
      bugState.result = "";
      clearPowerResult("bug");
    },
    false,
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
          if (content) fileText = `\nFile excerpt (${path}):\n${capText(content, 12000)}`;
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
        "Rank at most three causes with confidence. Do not invent logs or claim a fix was tested. Give one next command or check.",
      ].join("\n");
      const prompt = [
        `Focus: ${bugState.focus}`,
        `Symptom:\n${bugState.symptom}`,
        bugState.where.trim() ? `Where: ${bugState.where}` : "",
        bugState.changed.trim() ? `Recent change: ${bugState.changed}` : "",
        fileText,
      ]
        .filter(Boolean)
        .join("\n\n");
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
  resultClearers["bug"] = () => setResult("");
  const resultActions = addActions(parent);
  addButton(resultActions, "Send to agent", "secondary", () => {
    if (!bugState.result) {
      toast("info", "Hunt the bug first.");
      return;
    }
    void sendToSession(
      `Work this bug from the hunt below. Reproduce it before changing code. After the fix, run the verification and add the regression guard.\n\n${bugState.result}`,
      "Hunt sent to the agent.",
    );
  });
  addButton(resultActions, "Compose", "outline", () => void composeText(bugState.result));
  addButton(resultActions, "Copy", "outline", () => void copyText(bugState.result));
}

/* ------------------------------------------------------------------ */
/*  Red Pen                                                           */
/* ------------------------------------------------------------------ */

async function loadRedPenFile(path: string, range?: { start: number; end: number }): Promise<void> {
  const content = await readOptional(path);
  /* An empty file is a readable file: only a failed read returns null. */
  if (content === null) {
    throw new Error(`Could not read ${path}.`);
  }
  if (range) {
    const lines = content.split(/\r?\n/);
    const start = Math.max(1, Math.min(lines.length, range.start));
    const end = Math.max(start, Math.min(lines.length, range.end));
    const slice = lines
      .slice(start - 1, end)
      .map((line, index) => `${String(start + index).padStart(4, " ")} | ${line}`)
      .join("\n");
    redState.code = capText(slice, 20000);
    redState.range = `${start}–${end}`;
    /* Use the clamped range, not the raw diff lines, so a range past EOF labels what was read. */
    redState.label = `${path} · lines ${start}–${end}`;
  } else {
    redState.code = capText(content, 20000);
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

function buildRedPen(parent: HTMLElement): void {
  const capture = el("div", "fb-capture");
  parent.append(capture);
  const refreshCapture = () => {
    capture.replaceChildren();
    if (redState.label) {
      capture.append(el("b", "", redState.label), document.createTextNode(redState.range ? ` · ${redState.code.length.toLocaleString()} chars` : ""));
    } else if (redState.code.trim()) {
      capture.append(el("b", "", "Pasted code ready."), document.createTextNode(" Choose a focus and review."));
    } else {
      capture.append(document.createTextNode("Select code, a file, or diff lines → "), el("b", "", "Fox Box: red-pen"), document.createTextNode(", or paste code below."));
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
    { helper: "A path label for the review. The code below is what gets scanned.", placeholder: "src/foo.ts · lines 20–60" },
  );
  handles["red-capture"] = note;

  const code = addText(
    parent,
    "Code or diff",
    redState.code,
    (value) => {
      redState.code = value.slice(0, 20000);
      redState.result = "";
      clearPowerResult("red-pen");
    },
    {
      multiline: true,
      rows: 7,
      mono: true,
      placeholder: "Paste the code, diff, or selection here…",
    },
  );
  handles["red-code"] = code;

  group(parent, "Look for");
  const focusGrid = el("div", "fb-switchgrid");
  parent.append(focusGrid);
  const focusItems: Array<[string, string]> = [
    ["correctness", "Correctness"],
    ["edge", "Edge cases"],
    ["security", "Security"],
    ["performance", "Performance"],
    ["tests", "Missing tests"],
    ["readability", "Readability"],
  ];
  for (const [id, label] of focusItems) {
    addCheckbox(
      focusGrid,
      label,
      undefined,
      () => redState.focus.has(id),
      (checked) => {
        if (checked) redState.focus.add(id);
        else redState.focus.delete(id);
        redState.result = "";
        clearPowerResult("red-pen");
      },
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
    { placeholder: "Assume this runs on the hot path. Ignore formatting." },
  );
  handles["red-extra"] = extra;

  const actions = addActions(parent);
  const agentReview = addButton(actions, "Review with agent", "default", () => {
    if (!redState.code.trim()) {
      toast("info", "Add code or capture a selection first.");
      return;
    }
    const focus = Array.from(redState.focus).join(", ") || "correctness";
    const source = redState.label.trim() ? `Source: ${redState.label}\n` : "";
    void sendToSession(
      `Red-pen this code. Focus on: ${focus}.${redState.extra.trim() ? ` Extra instruction: ${redState.extra.trim()}` : ""}\n${source}\nReview the code below. Report findings ordered by severity with line references, why it matters, and a concrete fix. Do not rewrite the whole file unless asked.\n\n\`\`\`\n${capText(redState.code, 12000)}\n\`\`\``,
      "Review sent to the agent.",
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
        "If there is no real defect in a category, say nothing about it. Do not praise. Do not rewrite the whole file.",
      ].join("\n");
      const prompt = [
        `Focus: ${focus}`,
        redState.label ? `Source: ${redState.label}` : "",
        redState.extra.trim() ? `Extra instruction: ${redState.extra}` : "",
        `Code:\n\`\`\`\n${redState.code}\n\`\`\``,
      ]
        .filter(Boolean)
        .join("\n\n");
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
  resultClearers["red-pen"] = () => setResult("");
  const resultActions = addActions(parent);
  addButton(resultActions, "Send findings", "secondary", () => {
    if (!redState.result) {
      toast("info", "Run a quick scan first.");
      return;
    }
    void sendToSession(
      `Fix the issues in this review. Work highest severity first, and add or update tests for each behavioral fix.\n\n${redState.result}`,
      "Findings sent to the agent.",
    );
  });
  addButton(resultActions, "Compose", "outline", () => void composeText(redState.result));
  addButton(resultActions, "Copy", "outline", () => void copyText(redState.result));
}

/* ------------------------------------------------------------------ */
/*  Game Feel Lab                                                     */
/* ------------------------------------------------------------------ */

function buildGameFeel(parent: HTMLElement): void {
  const stackLine = el("div", "fb-note", "No game stack detected yet.");
  parent.append(stackLine);
  let scanKey = "";
  let scanSeq = 0;
  const refreshStack = () => {
    const key = normalizeDir(ready?.directory);
    if (key === scanKey) return;
    const seq = ++scanSeq;
    void detectProject()
      .then((info) => {
        if (seq !== scanSeq) return;
        scanKey = key;
        stackLine.textContent = info.isGame
          ? `Game project detected: ${info.label}.`
          : `Project: ${info.label}. This works for design-only passes too.`;
      })
      .catch(() => {
        if (seq !== scanSeq) return;
        scanKey = key;
        stackLine.textContent = "Project scan unavailable; the lab still works from your notes.";
      });
  };
  refreshStack();
  powerUpdaters["game"] = refreshStack;

  const top = el("div", "fb-grid2");
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
      { id: "other", label: "Other" },
    ],
    () => gameState.genre,
    (value) => {
      gameState.genre = value;
      gameState.result = "";
      clearPowerResult("game");
    },
    false,
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
      { id: "other", label: "Other" },
    ],
    () => gameState.engine,
    (value) => {
      gameState.engine = value;
      gameState.result = "";
      clearPowerResult("game");
    },
    false,
  );
  addSelect(
    parent,
    "Workbench",
    [
      { id: "juice", label: "Juice pass", hint: "feedback on every event" },
      { id: "tuning", label: "Tuning matrix", hint: "numbers to feel" },
      { id: "playtest", label: "Playtest kit", hint: "questions and experiments" },
    ],
    () => gameState.workbench,
    (value) => {
      gameState.workbench = value;
      gameState.result = "";
      clearPowerResult("game");
    },
    false,
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
    { multiline: true, rows: 2, placeholder: "Run, jump, collect, return, spend…" },
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
    { multiline: true, rows: 2, placeholder: "Crunchy, weighty, floaty, tense, toy-like…" },
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
    { multiline: true, rows: 2, placeholder: "The jump, the hit, the pickup, the boss phase…" },
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
          "Name concrete motion, sound, camera, and timing choices. Avoid generic 'add juice' advice. Keep each field useful to a small implementation pass.",
        ].join("\n"),
        context: [
          `Genre: ${gameState.genre}`,
          `Engine: ${gameState.engine}`,
          `Workbench: ${gameState.workbench}`,
        ].join("\n"),
        maxOutputTokens: 900,
        fields: [
          {
            key: "loop",
            label: "Core loop",
            value: gameState.loop,
            max: 700,
            hint: "the repeatable player action and reward",
          },
          {
            key: "feel",
            label: "Target feel",
            value: gameState.feel,
            max: 500,
            hint: "crunchy, weighty, floaty, tense, toy-like",
          },
          {
            key: "mechanic",
            label: "Mechanic under the knife",
            value: gameState.mechanic,
            max: 700,
            hint: "the jump, hit, pickup, boss phase, or other event to tune",
          },
        ],
      },
      (values) => {
        let applied = 0;
        if (values.loop !== undefined && !gameState.loop.trim()) {
          gameState.loop = values.loop.slice(0, 1500);
          handles["game-loop"]?.update({ value: gameState.loop });
          applied += 1;
        }
        if (values.feel !== undefined && !gameState.feel.trim()) {
          gameState.feel = values.feel.slice(0, 1200);
          handles["game-feel"]?.update({ value: gameState.feel });
          applied += 1;
        }
        if (values.mechanic !== undefined && !gameState.mechanic.trim()) {
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
      },
    );
  });
  const design = addButton(actions, "Design the pass", "default", () => {
    void withBusy(design, async () => {
      const system = [
        "You are a gameplay feel designer who ships.",
        "Return a concrete, testable markdown document. Use numbers and timings. Name the channel and the event. Never say 'add juice' without saying what changes on screen, in the ear, or in the hand.",
        "Keep the whole answer under 700 words.",
      ].join("\n");
      const workbench = gameState.workbench;
      const sections =
        workbench === "juice"
          ? [
              "# Juice pass",
              "## Feel target",
              "## Feedback table",
              "| Event | Motion | Particles | Sound | Camera | Timing |",
              "## Implementation notes",
              "## Playtest checks",
            ]
          : workbench === "tuning"
            ? [
                "# Tuning matrix",
                "## Feel target",
                "## Variables",
                "| Variable | Start | Range | What to watch |",
                "## Couplings",
                "## Experiment order",
              ]
            : [
                "# Playtest kit",
                "## What this build is testing",
                "## Questions to ask",
                "## What to watch in the body",
                "## Five experiments",
                "## Kill criteria",
              ];
      const prompt = [
        `Workbench: ${workbench}`,
        `Genre: ${gameState.genre}`,
        `Engine: ${gameState.engine}`,
        `Core loop: ${gameState.loop || "(not given)"}`,
        `Target feel: ${gameState.feel || "(not given)"}`,
        `Mechanic: ${gameState.mechanic || "(not given)"}`,
        `Use these sections:\n${sections.join("\n")}`,
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
  resultClearers["game"] = () => setResult("");
  const resultActions = addActions(parent);
  addButton(resultActions, "Send to agent", "secondary", () => {
    if (!gameState.result) {
      toast("info", "Design a pass first.");
      return;
    }
    void sendToSession(
      `Implement one slice of this game-feel pass. Start with the highest-impact row only, make the change, then tell me what to feel for.\n\n${gameState.result}`,
      "Game feel pass sent to the agent.",
    );
  });
  addButton(resultActions, "Compose", "outline", () => void composeText(gameState.result));
  addButton(resultActions, "Copy", "outline", () => void copyText(gameState.result));
}

/* ------------------------------------------------------------------ */
/*  Character Forge                                                   */
/* ------------------------------------------------------------------ */

function blankCharacter(): Character {
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
    updatedAt: Date.now(),
  };
}

function selectedCharacter(): Character | null {
  return characters.find((character) => character.id === selectedCharacterId) ?? null;
}

function ensureCharacter(): Character {
  const existing = selectedCharacter();
  if (existing) return existing;
  const created = characters[0] ?? blankCharacter();
  if (!characters.length) characters.push(created);
  selectedCharacterId = created.id;
  return created;
}

let charactersSaving = false;
let charactersSavePending = false;
let charactersTouched = false;
let charactersVersion = 0;

function saveCharactersNow(): void {
  if (charactersSaving) {
    charactersSavePending = true;
    return;
  }
  charactersSaving = true;
  const version = charactersVersion;
  const snapshot = characters.slice(0, 40).map((character) => ({ ...character }));
  void (async () => {
    let ok = false;
    const nextCache = new Map<string, string>();
    const writes: Array<Promise<unknown>> = [];
    for (const character of snapshot) {
      const serialized = JSON.stringify(character);
      nextCache.set(character.id, serialized);
      if (characterCache.get(character.id) !== serialized) {
        writes.push(host.storage.set(characterKey(character.id), character));
      }
    }
    try {
      await Promise.all(writes);
      await host.storage.set(CHARACTER_INDEX_KEY, snapshot.map((character) => character.id));
      characterCache.clear();
      for (const [id, serialized] of nextCache) characterCache.set(id, serialized);
      ok = true;
    } catch {
      toast("error", "Could not save characters.");
    } finally {
      charactersSaving = false;
      if (ok && charactersVersion === version) charactersTouched = false;
      if (charactersSavePending) {
        charactersSavePending = false;
        persistCharacters();
      }
    }
  })();
}

const persistCharacters = debounce(saveCharactersNow, 450);

function markCharactersChanged(): void {
  charactersTouched = true;
  charactersVersion += 1;
  persistCharacters();
}

function characterCard(character: Character): string {
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
    character.taboo.trim() && `avoids: ${character.taboo.trim()}`,
  ].filter(Boolean);
  if (voice.length) lines.push(`**Voice** ${voice.join("; ")}`);
  if (character.relationships.trim()) lines.push(`**Relationships** ${character.relationships.trim()}`);
  if (character.arc.trim()) lines.push(`**Arc** ${character.arc.trim()}`);
  return lines.join("\n");
}

function buildCharacterForge(parent: HTMLElement): void {
  ensureCharacter();

  const top = el("div", "fb-actions");
  parent.append(top);
  const selectHost = el("div", "fb-actions-grow");
  top.append(selectHost);
  let selectHandle: Handle | null = null;
  let resetDelete: () => void = () => {};
  let clearResult: () => void = () => {};
  const fieldHandles = new Map<keyof Character, Handle>();
  /* Declared before the select so its change handler can never hit a temporal-dead-zone binding
     on the first paint; the field handles are filled in below. */
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
      label: character.name.trim() || "Unnamed character",
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
      },
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
  const menuHost = el("span");
  top.append(menuHost);
  let deleteButton: ButtonHandle | null = null;
  let deleteArmed = false;
  let deleteTimer: number | undefined;
  resetDelete = () => {
    deleteArmed = false;
    if (deleteTimer !== undefined) {
      window.clearTimeout(deleteTimer);
      deleteTimer = undefined;
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
        deleteTimer = window.setTimeout(resetDelete, 3000);
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
      markCharactersChanged();
      void host.storage.delete(characterKey(removedId)).catch(() => {});
      resetDelete();
      renderSelect();
      syncFields();
      refreshAll();
      toast("info", "Character removed.");
    },
  });

  const fields: Array<{ key: keyof Character; label: string; multiline?: boolean; rows?: number; helper?: string }> = [
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
    { key: "relationships", label: "Relationships", multiline: true, rows: 2 },
  ];

  const identity = group(parent, "Identity");
  const identityGrid = el("div", "fb-grid2");
  identity.append(identityGrid);
  const engine = group(parent, "Engine");
  const engineGrid = el("div", "fb-grid2");
  engine.append(engineGrid);
  const voice = group(parent, "Voice and ties");
  const voiceGrid = el("div", "fb-grid2");
  voice.append(voiceGrid);

  const destinationFor = (key: keyof Character) => {
    if (["name", "role", "pronouns", "era", "look"].includes(key)) return identityGrid;
    if (["want", "need", "wound", "contradiction", "secret", "arc"].includes(key)) return engineGrid;
    return voiceGrid;
  };

  for (const field of fields) {
    const parentNode = destinationFor(field.key);
    const handle = addText(
      parentNode,
      field.label,
      String(selectedCharacter()?.[field.key] ?? ""),
      (value) => {
        const character = selectedCharacter();
        if (!character) return;
        (character as any)[field.key] = value.slice(0, field.key === "look" || field.key === "relationships" ? 1200 : 600);
        character.updatedAt = Date.now();
        charState.result = "";
        clearResult();
        markCharactersChanged();
        if (field.key === "name") {
          window.setTimeout(() => {
            renderSelect();
            refreshAll();
          }, 500);
        }
      },
      { multiline: field.multiline, rows: field.rows, helper: field.helper },
    );
    fieldHandles.set(field.key, handle);
  }

  const { node: resultHost, set: setResult } = addResult(parent);
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
          "Write specific, playable details: concrete behavior, costs, contradictions, and voice. Keep name, role, pronouns, and era short; put texture in look, want, need, wound, contradiction, and voice. Avoid generic traits, stock phrases, and long backstory.",
        ].join("\n"),
        fields: fields.map((field) => ({
          key: field.key,
          label: field.label,
          value: String(character[field.key] ?? ""),
          max: field.key === "look" || field.key === "relationships" ? 1200 : 600,
          hint: field.helper,
        })),
        maxOutputTokens: 2400,
      },
      (values) => {
        if (selectedCharacterId !== character.id) {
          toast("info", "Character changed; the fill was discarded.");
          return false;
        }
        let applied = 0;
        for (const [key, value] of Object.entries(values)) {
          if (!fields.some((field) => field.key === key)) continue;
          if (String((character as any)[key] ?? "").trim()) continue;
          (character as any)[key] = value;
          fieldHandles.get(key as keyof Character)?.update({ value });
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
      },
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
        "Given a character card, return 5 sharp suggestions as markdown bullets: 2 contradictions or costs, 2 concrete scene pressures, 1 voice quirk. Each bullet must be specific to this character and playable on the page. No preamble. No rewriting the whole card.",
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
      { power: "character", characterId: character.id },
    );
  });
  addButton(actions, "Start scene", "outline", () => {
    const character = ensureCharacter();
    const card = characterCard(character);
    void startFreshSession(
      `Scene: ${character.name || "Unnamed"}`,
      `${card}\n\nStart a scene with this character. Put them under pressure that targets their contradiction. Open with them pursuing their want and failing in a small, specific way. Stay close to their voice. End on a turn, not a summary.`,
    );
  });

  addNote(parent, "Fill blanks asks the Small Model for only the empty fields. It does not start a chat or overwrite text you have already typed.");

  syncFields();
}

/* ------------------------------------------------------------------ */
/*  Prose Atelier                                                     */
/* ------------------------------------------------------------------ */

function buildProse(parent: HTMLElement): void {
  /* Assigned after the character controls exist; the mode select above can only call it later. */
  let updateMode: () => void = () => {};
  const top = el("div", "fb-grid2");
  parent.append(top);
  addSelect(
    top,
    "Workbench",
    [
      { id: "line", label: "Line polish" },
      { id: "scene", label: "Scene doctor" },
      { id: "voice", label: "Voice match" },
    ],
    () => proseState.mode,
    (value) => {
      proseState.mode = value;
      proseState.result = "";
      clearPowerResult("prose");
      updateMode();
    },
    false,
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
      { id: "cut", label: "Cut 10%" },
    ],
    () => proseState.focus,
    (value) => {
      proseState.focus = value;
      proseState.result = "";
      clearPowerResult("prose");
    },
    false,
  );

  const style = addSelect(
    parent,
    "Treatment",
    [
      { id: "preserve", label: "Preserve voice" },
      { id: "tighten", label: "Tighten" },
      { id: "heighten", label: "Heighten" },
      { id: "plain", label: "Plain and direct" },
    ],
    () => proseState.style,
    (value) => {
      proseState.style = value;
      proseState.result = "";
      clearPowerResult("prose");
    },
    false,
  );

  const characterWrap = el("div");
  parent.append(characterWrap);
  let characterSignature = "__unset__";
  let characterHandle: Handle | null = null;
  const renderCharacters = () => {
    const nextSignature = characters.map((character) => `${character.id}:${character.name}`).join("|");
    if (nextSignature === characterSignature) return;
    characterSignature = nextSignature;
    characterHandle?.dispose();
    characterHandle = null;
    characterWrap.replaceChildren();
    if (!characters.length) {
      characterWrap.append(el("div", "fb-note", "No saved characters. Build one in Character Forge first."));
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
      },
    });
  };

  const source = el("div", "fb-capture");
  parent.append(source);
  const refreshSource = () => {
    source.replaceChildren();
    if (proseState.source) {
      source.append(el("b", "", proseState.source), document.createTextNode(" loaded."));
    } else {
      source.append(document.createTextNode("Select prose in chat → "), el("b", "", "Fox Box: polish prose"), document.createTextNode(", or paste below."));
    }
  };
  refreshSource();
  powerUpdaters["prose"] = refreshSource;

  const text = addText(
    parent,
    "Prose or scene",
    proseState.text,
    (value) => {
      proseState.text = value.slice(0, 16000);
      proseState.source = "";
      proseState.result = "";
      clearPowerResult("prose");
    },
    { multiline: true, rows: 7, placeholder: "Paste the paragraph, scene, or scene summary…" },
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
      const character =
        characters.find((item) => item.id === proseState.characterId) ?? selectedCharacter();
      const system =
        proseState.mode === "scene"
          ? [
              "You are a story editor. You diagnose scenes, you do not rewrite them.",
              "Return markdown: ## Want, ## Conflict, ## Turn, ## Exit, ## Three escalations, ## Continuity risks. Be concrete and short. No praise.",
            ].join("\n")
          : [
              "You are a line editor with a ruthless ear.",
              "Return only the revised text, then a blank line, then exactly three bullets: what changed and why.",
              "Preserve meaning, point of view, and the author's voice. Do not add new events. Do not pad. If the passage is under 40 words, do not lengthen it.",
            ].join("\n");
      const prompt = [
        `Mode: ${proseState.mode}`,
        `Focus: ${proseState.focus}`,
        `Treatment: ${proseState.style}`,
        character && proseState.mode === "voice" ? `Voice card:\n${characterCard(character)}` : "",
        `Text:\n${proseState.text}`,
      ]
        .filter(Boolean)
        .join("\n\n");
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
  resultClearers["prose"] = () => setResult("");
  const resultActions = addActions(parent);
  addButton(resultActions, "Send to agent", "secondary", () => {
    if (!proseState.result) {
      toast("info", "Polish or diagnose first.");
      return;
    }
    void sendToSession(
      `Use this edit as a starting point. Preserve the author's voice and do not add events. Explain any change that alters meaning.\n\n${proseState.result}`,
      "Prose pass sent to the agent.",
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

/* ------------------------------------------------------------------ */
/*  Idea Distiller                                                    */
/* ------------------------------------------------------------------ */

function sparkScore(spark: Spark): number | null {
  if (!spark.scores) return null;
  const { novelty, usefulness, fit, effort } = spark.scores;
  return Math.round(((novelty + usefulness + fit) / 3 - effort * 0.25) * 10) / 10;
}

let sparksSaving = false;
let sparksSavePending = false;
let sparksTouched = false;
let sparksVersion = 0;

function saveSparksNow(): void {
  if (sparksSaving) {
    sparksSavePending = true;
    return;
  }
  sparksSaving = true;
  const version = sparksVersion;
  const snapshot = sparks.slice(0, 60).map((spark) => ({ ...spark }));
  void (async () => {
    let ok = false;
    const nextCache = new Map<string, string>();
    const writes: Array<Promise<unknown>> = [];
    for (const spark of snapshot) {
      const serialized = JSON.stringify(spark);
      nextCache.set(spark.id, serialized);
      if (sparkCache.get(spark.id) !== serialized) {
        writes.push(host.storage.set(sparkKey(spark.id), spark));
      }
    }
    try {
      await Promise.all(writes);
      await host.storage.set(SPARK_INDEX_KEY, snapshot.map((spark) => spark.id));
      sparkCache.clear();
      for (const [id, serialized] of nextCache) sparkCache.set(id, serialized);
      ok = true;
    } catch {
      toast("error", "Could not save ideas.");
    } finally {
      sparksSaving = false;
      if (ok && sparksVersion === version) sparksTouched = false;
      if (sparksSavePending) {
        sparksSavePending = false;
        persistSparks();
      }
    }
  })();
}

const persistSparks = debounce(saveSparksNow, 450);

function markSparksChanged(): void {
  sparksTouched = true;
  sparksVersion += 1;
  persistSparks();
}

function buildIdeaDistiller(parent: HTMLElement): void {
  let addButtonHandle: ButtonHandle | null = null;
  group(parent, "Add a spark");
  const addGrid = el("div", "fb-grid2");
  parent.append(addGrid);
  const title = addText(
    addGrid,
    "Title",
    ideaState.title,
    (value) => {
      ideaState.title = value.slice(0, 160);
      addButtonHandle?.update({ disabled: !ideaState.title.trim() });
    },
    { placeholder: "One line that makes you curious" },
  );
  handles["idea-title"] = title;
  const note = addText(
    parent,
    "Note",
    ideaState.note,
    (value) => {
      ideaState.note = value.slice(0, NOTE_MAX);
    },
    { multiline: true, rows: 2, placeholder: "What is it, why now, what would make it fun…" },
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
      createdAt: Date.now(),
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
        context = `Project: ${info.label}\n${info.summary}`;
      } catch {
        // A project scan is optional; the fill still works without one.
      }
      await fillMissingFields(
        fill,
        {
          noun: "idea spark",
          system: [
            "You write terse, concrete game or software ideas.",
            "Avoid generic advice, buzzwords, and long explanations. A title should make the reader curious; a note should say what it is, why it might work, and what would make it fun.",
          ].join("\n"),
          context,
          maxOutputTokens: 500,
          fields: [
            {
              key: "title",
              label: "Title",
              value: ideaState.title,
              max: 120,
              hint: "one line that makes the reader curious",
            },
            {
              key: "note",
              label: "Note",
              value: ideaState.note,
              max: 700,
              hint: "what it is, why now, what would make it fun",
            },
          ],
        },
        (values) => {
          let applied = 0;
          if (values.title !== undefined && !ideaState.title.trim()) {
            ideaState.title = values.title.slice(0, 160);
            handles["idea-title"]?.update({ value: ideaState.title });
            applied += 1;
          }
          if (values.note !== undefined && !ideaState.note.trim()) {
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
        },
      );
    })().finally(() => {
      filling = false;
    });
  });
  addButtonHandle.update({ disabled: true });
  addNote(parent, "Fill blanks asks the Small Model for the missing title or note only; it does not save or send the spark.");

  group(parent, "The rack");
  const list = el("div", "fb-scroll");
  parent.append(list);

  let resetRemove: () => void = () => {};
  const renderSparks = () => {
    resetRemove();
    list.replaceChildren();
    if (!sparks.length) {
      list.append(el("div", "fb-empty", "No sparks yet. Every good project starts as a bad note."));
      return;
    }
    for (const spark of sparks) {
      const selected = selectedSparks.has(spark.id);
      const row = el("label", "fb-spark");
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
      const body = el("div");
      body.append(el("div", "fb-spark-title", spark.title));
      if (spark.note) body.append(el("div", "fb-spark-note", spark.note));
      if (spark.scores) {
        const scores = el("div", "fb-spark-scores");
        for (const [label, value] of [
          ["N", spark.scores.novelty],
          ["U", spark.scores.usefulness],
          ["F", spark.scores.fit],
          ["E", spark.scores.effort],
        ] as Array<[string, number]>) {
          scores.append(el("span", "fb-chip", `${label}${value}`));
        }
        body.append(scores);
      }
      const score = sparkScore(spark);
      const badge = el("span", "fb-chip", score === null ? "unscored" : String(score));
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
        "Effort is 1 for a weekend and 5 for a year. No other text.",
      ].join("\n");
      const prompt = chosen
        .map((spark) => `id=${spark.id}\ntitle=${spark.title}\nnote=${spark.note}`)
        .join("\n\n");
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
          effort: clampInt(e[1], 1, 5, 3),
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
        "Repeat for 2 and 3. No preamble. Keep it under 350 words.",
      ].join("\n");
      const prompt = chosen.map((spark) => `Title: ${spark.title}\nNote: ${spark.note}`).join("\n\n---\n\n");
      const result = await generateText(blend, system, prompt, 1300);
      if (result) {
        ideaState.result = result;
        powerResults["idea"] = true;
        setResult(result);
        refreshAll();
      }
    });
  });

  let remove: ButtonHandle | null = null;
  let removeArmed = false;
  let removeTimer: number | undefined;
  resetRemove = () => {
    removeArmed = false;
    if (removeTimer !== undefined) {
      window.clearTimeout(removeTimer);
      removeTimer = undefined;
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
      removeTimer = window.setTimeout(resetRemove, 3000);
      return;
    }
    const removedIds = Array.from(selectedSparks);
    sparks = sparks.filter((spark) => !selectedSparks.has(spark.id));
    selectedSparks.clear();
    selectedSparks = new Set<string>();
    markSparksChanged();
    for (const id of removedIds) {
      sparkCache.delete(id);
      void host.storage.delete(sparkKey(id)).catch(() => {});
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
      `Turn this blend into a small, testable first move for the current project. Pick one concept, state why, then outline the thin slice.\n\n${ideaState.result}`,
      "Blend sent to the agent.",
    );
  });
  addButton(resultActions, "Copy", "outline", () => void copyText(ideaState.result));

  renderSparks();
  updateIdeaButtons();
  powerUpdaters["idea"] = () => updateIdeaButtons();
}

/* ------------------------------------------------------------------ */
/*  Model Fit                                                         */
/* ------------------------------------------------------------------ */

function applyPreset(name: string): void {
  const preset = QWEN_PRESETS[name];
  if (!preset) return;
  config.powers.model.preset = name;
  Object.assign(config.powers.model, preset);
  syncModelFields();
  void saveConfigNow();
  refreshAll();
}

function syncToolChecks(): void {
  for (const item of modelToolChecks) {
    item.handle.update({
      checked: item.names.some((name) => config.powers.model.hideTools.includes(name)),
    });
  }
}

function syncModelFields(): void {
  for (const [key, handle] of Object.entries(modelFieldHandles)) {
    const value = (config.powers.model as any)[key];
    handle.update({ value: String(value) });
  }
  modelPresetHandle?.update({ value: config.powers.model.preset });
  modelReasoningHandle?.update({ value: config.powers.model.reasoningEffort });
  modelCapOutputHandle?.update({ checked: config.powers.model.capOutput });
  syncToolChecks();
  modelExtraToolsHandle?.update({ value: extraToolNames() });
}

const modelFieldHandles: Record<string, Handle> = {};
let modelPresetHandle: Handle | null = null;
let modelReasoningHandle: Handle | null = null;
let modelCapOutputHandle: Handle | null = null;
let modelToolLine: HTMLElement | null = null;
let modelModelLine: HTMLElement | null = null;
let modelExtraToolsHandle: Handle | null = null;
const modelToolChecks: Array<{ names: string[]; handle: Handle }> = [];

function extraToolNames(): string {
  return config.powers.model.hideTools
    .filter((name) => !KNOWN_TOOLS.some((known) => known.names.includes(name)))
    .join(", ");
}

function setToolHidden(name: string, hidden: boolean): void {
  const set = new Set(config.powers.model.hideTools);
  if (hidden) set.add(name);
  else set.delete(name);
  config.powers.model.hideTools = Array.from(set).slice(0, 24);
}

function setExtraToolNames(value: string): void {
  const known = config.powers.model.hideTools.filter((name) =>
    KNOWN_TOOLS.some((item) => item.names.includes(name)),
  );
  const extra = value
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, 16);
  config.powers.model.hideTools = Array.from(new Set([...known, ...extra])).slice(0, 24);
}

function buildModelFit(parent: HTMLElement): void {
  for (const key of Object.keys(modelFieldHandles)) delete modelFieldHandles[key];
  modelToolChecks.length = 0;
  modelPresetHandle = null;
  modelReasoningHandle = null;
  modelCapOutputHandle = null;
  modelExtraToolsHandle = null;
  modelToolLine = null;
  modelModelLine = null;
  modelModelLine = el("div", "fb-capture");
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
      el("b", "", shortModel(model)),
      document.createTextNode(
        applies
          ? " · tuned by Fox Box."
          : config.powers.model.applyToQwenOnly
            ? " · not a Qwen-family name, so sampling and the contract are idle; tool hiding still applies."
            : " · profile applies to every model.",
      ),
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
    },
  );

  const presetHost = el("div");
  parent.append(presetHost);
  modelPresetHandle = mountSelect(presetHost, {
    label: "Profile",
    value: config.powers.model.preset,
    options: [
      { id: "qwen-thinking", label: "Qwen3.8 thinking", hint: "recommended" },
      { id: "qwen-instruct", label: "Qwen3.8 instruct", hint: "faster" },
      { id: "balanced", label: "Balanced", hint: "other models" },
      { id: "custom", label: "Custom" },
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
    },
  });

  const switches = el("div");
  parent.append(switches);
  addSwitch(
    switches,
    "Apply only to Qwen-family models",
    "Matches Qwen, Unsloth, Flash-Next and common Qwen quant names. Turn off to apply to every model.",
    () => config.powers.model.applyToQwenOnly,
    (value) => {
      config.powers.model.applyToQwenOnly = value;
    },
  );
  addSwitch(
    switches,
    "Inject small-model contract",
    "A short system note that keeps the agent tool-first, stepwise and honest about verification.",
    () => config.powers.model.contractEnabled,
    (value) => {
      config.powers.model.contractEnabled = value;
    },
  );
  modelCapOutputHandle = addSwitch(
    switches,
    "Cap output tokens",
    "Stops a chatty turn from spending its whole budget on prose.",
    () => config.powers.model.capOutput,
    (value) => {
      config.powers.model.capOutput = value;
    },
  );
  group(parent, "Sampling");
  const grid = el("div", "fb-grid2");
  parent.append(grid);
  for (const [key, label, help] of [
    ["temperature", "Temperature", "Thinking 1.0 · instruct 0.7"],
    ["topP", "Top P", "Thinking 0.95 · instruct 0.80"],
    ["topK", "Top K", "Qwen recommends 20"],
    ["presencePenalty", "Presence penalty", "Instruct 1.5; thinking 0"],
    ["frequencyPenalty", "Frequency penalty", "Usually 0; raise to reduce repeats"],
    ["maxOutputTokens", "Max output tokens", "Used when the cap is on"],
  ] as Array<[keyof ModelPower, string, string]>) {
    let handle: Handle | null = null;
    handle = addText(
      grid,
      label,
      String(config.powers.model[key]),
      (value) => {
        if (!value.trim()) return;
        const number = Number(value);
        if (!Number.isFinite(number)) return;
        const limits: Record<string, [number, number, boolean]> = {
          temperature: [0, 2, false],
          topP: [0, 1, false],
          topK: [0, 200, true],
          presencePenalty: [-2, 2, false],
          frequencyPenalty: [-2, 2, false],
          maxOutputTokens: [256, 64000, true],
        };
        const [min, max, integer] = limits[key as string] ?? [number, number, false];
        const next = integer ? Math.round(number) : number;
        (config.powers.model[key] as any) = Math.min(max, Math.max(min, next));
        config.powers.model.preset = "custom";
        modelPresetHandle?.update({ value: "custom" });
        queueConfigSave();
        refreshAll();
      },
      {
        mono: true,
        helper: help,
        onCommit: () => handle?.update({ value: String(config.powers.model[key]) }),
      },
    );
    modelFieldHandles[key as string] = handle;
  }

  const reasoningHost = el("div");
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
      { id: "auto", label: "Provider default" },
    ],
    onChange: (value) => {
      config.powers.model.reasoningEffort = value;
      modelReasoningHandle?.update({ value });
      void saveConfigNow();
      refreshAll();
    },
  });

  const contract = addText(
    parent,
    "Small-model contract",
    config.powers.model.contract,
    (value) => {
      config.powers.model.contract = value.slice(0, 3500);
      queueConfigSave();
    },
    { multiline: true, rows: 5, helper: "Injected into the system prompt only when this profile applies." },
  );
  modelFieldHandles["contract"] = contract;

  group(parent, "Tool surface");
  addNote(
    parent,
    "Hide tools from the request only. They stay installed; this just keeps a small model from choosing between near-duplicates. Hiding applies to every model while Model Fit is active, not only Qwen-family ones.",
  );
  const toolGrid = el("div", "fb-switchgrid");
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
      true,
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
    { helper: "Comma-separated exact tool names. Missing names are ignored.", placeholder: "tool_a, tool_b" },
  );

  modelToolLine = el("div", "fb-note");
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
    const applied = last.applied !== false ? "" : " · sampling profile not applied";
    const missing =
      configured > 0 && hidden === 0
        ? " · none of the configured names were in that request"
        : "";
    modelToolLine.textContent = sameSession
      ? `Last request in this session: ${last.tools ?? "?"} tools visible${hidden ? `, ${hidden} hidden` : ""}${applied}${missing}.`
      : `Last request was in another session: ${last.tools ?? "?"} tools visible${hidden ? `, ${hidden} hidden` : ""}${applied}${missing}.`;
  };
  refreshToolLine();
  powerUpdaters["model-tools"] = refreshToolLine;

  const actions = addActions(parent);
  addButton(actions, "Copy contract", "outline", () => void copyText(config.powers.model.contract));
  addButton(actions, "Reset thinking", "outline", () => applyPreset("qwen-thinking"));

  const details = el("details", "fb-details");
  details.append(
    el("summary", "", "Qwen3.8-Flash-Next reference"),
    el(
      "div",
      "fb-note",
      "Thinking: temp 1.0, top_p 0.95, top_k 20, no presence penalty, extra-high reasoning. Instruct: temp 0.7, top_p 0.80, top_k 20, presence penalty 1.5. Native context 262k. These are starting points, not laws.",
    ),
  );
  parent.append(details);
}

/* ------------------------------------------------------------------ */
/*  Pruning Ledger                                                    */
/* ------------------------------------------------------------------ */

function metricCell(parent: HTMLElement, label: string): { value: HTMLElement; sub: HTMLElement } {
  const box = el("div", "fb-metric");
  const value = el("div", "fb-metric-value", "—");
  const sub = el("div", "fb-metric-sub", "");
  box.append(el("div", "fb-metric-label", label), value, sub);
  parent.append(box);
  return { value, sub };
}

function breakdownRow(label: string, chars: number, total: number, isTotal = false): HTMLElement {
  const row = el("div", "fb-brow");
  if (isTotal) row.dataset.total = "true";
  const share = percentOf(chars, total);
  const track = el("span", "fb-brow-track");
  const fill = el("span", "fb-brow-fill");
  fill.style.width = `${chars > 0 ? Math.max(2, share) : 0}%`;
  track.append(fill);
  row.append(
    el("span", "fb-brow-label", label),
    track,
    el("span", "fb-brow-value", fmt(chars)),
    el("span", "fb-brow-share", fmtPercent(share)),
  );
  return row;
}

function metricsReport(): string {
  if (!pluginStatus) return "";
  const entry = currentPluginSession();
  const totals = pluginStatus.totals;
  const hasSession = Boolean(entry && amount(entry.runs) > 0);
  const hasTotals = Boolean(totals && amount(totals.context) > 0);
  if (!hasSession && !hasTotals) return "";
  const title = ready?.session?.title;
  const lines = ["Fox Box pruning ledger"];
  lines.push(`Chat: ${sessionId() || "unknown"}${title ? ` — ${title}` : ""}`);
  if (entry && hasSession) {
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
    const lastTrimmedResults = latestRequestNumber("lastTrimmedResults", "trimmedResults");
    const lastToolResults = latestRequestNumber("lastToolResults", "toolResults");
    lines.push(
      `Requests guarded: ${fmt(runs)}`,
      `Latest request: ${fmt(lastSaved)} of ${fmt(lastTotal)} chars pruned (≈${fmt(tokensForChars(lastSaved, estimate))} tokens; ${tokenBasisText(estimate)})`,
      `Latest savings rate: ${lastTotal > 0 ? fmtPercent(lastRate) : "unknown"} of that request`,
      `Latest breakdown: aged ${fmt(lastOld)}, fresh ${fmt(lastFresh)}, repeats ${fmt(lastCollapsedChars)} (${fmt(lastCollapsed)} calls), other ${fmt(lastOther)} chars`,
      `Tool results: ${fmt(lastTrimmedResults)} of ${fmt(lastToolResults)} shortened by size in the latest request`,
      `Across all guarded requests: ${fmt(totalSaved)} chars pruned (≈${fmt(tokensForChars(totalSaved, estimate))} tokens)`,
      `Average per guarded request: ${totalOriginal > 0 ? fmtPercent(percentOf(totalSaved, totalOriginal)) : "unknown"} of the text`,
      `Note: the same context is re-sent every turn, so the across-requests total is cumulative input saved, not unique characters.`,
    );
  } else {
    lines.push("Requests guarded: none in this chat yet");
  }
  if (totals) {
    lines.push(
      `This project: ${fmt(amount(totals.context))} guarded requests, ${fmt(amount(totals.prunedChars))} chars pruned cumulatively, ${fmt(amount(totals.collapsed))} repeats collapsed cumulatively`,
    );
  }
  return lines.join("\n");
}

function buildMetrics(parent: HTMLElement): void {
  const live = el("div", "fb-note");
  parent.append(live);

  const grid = el("div", "fb-metrics");
  parent.append(grid);
  const pruned = metricCell(grid, "Pruned in latest request");
  const rate = metricCell(grid, "Latest savings rate");
  const requests = metricCell(grid, "Requests guarded");
  const repeats = metricCell(grid, "Repeats in latest request");

  const totalsNote = el("div", "fb-note");
  parent.append(totalsNote);

  const shareWrap = el("div", "fb-share-wrap");
  const shareLine = el("div", "fb-meter-line");
  const shareCaption = el("span", "", "Last outgoing request");
  const shareValue = el("span");
  shareLine.append(shareCaption, shareValue);
  const shareBar = el("div", "fb-share");
  const shareFill = el("div", "fb-share-pruned");
  shareBar.append(shareFill);
  const shareLegend = el("div", "fb-legend");
  shareWrap.append(shareLine, shareBar, shareLegend);
  parent.append(shareWrap);

  group(parent, "Where the latest request's savings went");
  const breakdown = el("div", "fb-breakdown");
  parent.append(breakdown);

  group(parent, "Recent requests");
  const bars = el("div", "fb-bars");
  const barsNote = el("div", "fb-note");
  parent.append(bars, barsNote);

  group(parent, "Across this project (cumulative input saved)");
  const totalsLine = el("div", "fb-inline");
  parent.append(totalsLine);
  const sessionsHost = el("div", "fb-table-wrap");
  parent.append(sessionsHost);

  const actions = addActions(parent);
  const refresh = addButton(actions, "Refresh ledger", "secondary", () => {
    void withBusy(refresh, async () => {
      const refreshed = await refreshPluginStatus();
      toast(
        "info",
        refreshed
          ? "Ledger refreshed."
          : pluginStatus
            ? "The ledger was not refreshed; the next poll will try again."
            : "No ledger yet — the plugin writes it after the first request.",
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
      `Read this Fox Box pruning ledger. Name the three biggest context hogs and say what to drop, compact, or avoid re-reading next. Do not run tools. Keep it under 150 words.\n\n${report}`,
      "Asked the agent about the context.",
    );
  });

  const details = el("details", "fb-details");
  details.append(
    el("summary", "", "How these numbers are measured"),
    el(
      "div",
      "fb-note",
      "Pruning is measured exactly, in characters, by counting the outgoing message text, tool results, and tool arguments before and after Fox Box edits the request. Headline numbers describe the latest guarded request. A chat re-sends its history every turn, so the same text can be pruned again on the next request; the across-requests total sums those per-request savings and represents input saved over time, not unique characters removed. Tokens are estimated from the latest request's measured context tokens divided by the characters Fox Box kept for it, which gives this model's average tokens per character; when OpenChamber's context meter has no measurement yet, Fox Box falls back to four characters per token. The meter counts the whole request, including the system prompt and tool definitions, so a very small context can read slightly high. Totals begin when OpenCode starts and reset on restart.",
    ),
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
      live.textContent =
        "Context Keeper is off, so nothing is pruned and the ledger stays empty. Turn it on in Context Keeper.";
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
      live.textContent = `Updated ${fmtAge(entry.lastAt)} · exact characters, tokens ${
        estimate.measured ? `at ${estimate.perChar.toFixed(2)} per character measured` : "at 4 chars/token fallback"
      }.`;
    }

    pruned.value.textContent = `${fmt(lastSaved)} chars`;
    pruned.sub.textContent =
      lastSaved > 0 ? `≈${fmtCompact(tokensForChars(lastSaved, estimate))} tokens` : "nothing pruned in the latest request";
    rate.value.textContent = lastTotal > 0 ? fmtPercent(lastRate) : "—";
    rate.sub.textContent = lastTotal > 0 ? "of the latest request" : "waiting for data";
    requests.value.textContent = String(runs);
    requests.sub.textContent = runs > 0 ? `updated ${fmtAge(entry?.lastAt)}` : "none yet";
    repeats.value.textContent = String(lastCollapsed);
    repeats.sub.textContent = lastCollapsed > 0 ? `${fmtCompact(lastCollapsedChars)} chars saved` : "none in the latest request";

    totalsNote.textContent =
      runs > 0
        ? `Across ${fmt(runs)} guarded request${runs === 1 ? "" : "s"}: ${fmt(totalSaved)} chars pruned (≈${fmt(
            tokensForChars(totalSaved, estimate),
          )} tokens). This is cumulative input saved; the same context is re-sent each turn, so it is not a unique-character count.`
        : "";

    if (lastTotal > 0) {
      const share = percentOf(lastSaved, lastTotal);
      shareWrap.hidden = false;
      shareValue.textContent = `${fmtPercent(share)} pruned`;
      shareFill.style.width = `${share}%`;
      shareBar.title = `${fmt(lastSaved)} of ${fmt(lastTotal)} characters pruned in the last request (≈${fmt(tokensForChars(lastSaved, estimate))} tokens).`;
      shareLegend.replaceChildren(
        el("span", "", `${fmt(lastSaved)} chars pruned`),
        el("span", "", `${fmt(lastKept)} chars kept`),
        el("span", "", `≈${fmt(tokensForChars(lastSaved, estimate))} tokens pruned`),
      );
    } else {
      shareWrap.hidden = true;
    }

    breakdown.replaceChildren();
    if (entry && runs > 0 && lastTotal > 0) {
      const oldChars = latestRequestNumber("lastOld", "oldChars");
      const freshChars = latestRequestNumber("lastFresh", "freshChars");
      const latestCollapsedChars = latestRequestNumber("lastCollapsedChars", "collapsedChars");
      const other =
        latestRequestNumber("lastOther", "otherChars") ||
        Math.max(0, lastSaved - oldChars - freshChars - latestCollapsedChars);
      const total = Math.max(lastSaved, oldChars + freshChars + latestCollapsedChars + other);
      breakdown.append(
        breakdownRow("Aged results", oldChars, total),
        breakdownRow("Fresh / kept reads", freshChars, total),
        breakdownRow("Duplicate calls", latestCollapsedChars, total),
      );
      if (other > 0) breakdown.append(breakdownRow("Other", other, total));
      breakdown.append(breakdownRow("Total", total, total, true));
      const toolResults = latestRequestNumber("lastToolResults", "toolResults");
      const trimmedResults = latestRequestNumber("lastTrimmedResults", "trimmedResults");
      if (toolResults > 0) {
        breakdown.append(
          el(
            "div",
            "fb-note",
            `Trimmed ${trimmedResults} of ${toolResults} tool result${toolResults === 1 ? "" : "s"} by size in the latest request; repeats are counted separately.`,
          ),
        );
      }
    } else if (entry && runs > 0) {
      breakdown.append(el("div", "fb-empty", "No latest-request breakdown yet."));
    } else {
      breakdown.append(el("div", "fb-empty", "No guarded request in this chat yet."));
    }

    bars.replaceChildren();
    const history = Array.isArray(entry?.history) ? entry.history.slice(-16) : [];
    if (history.length) {
      const points = history.map((point) => ({ saved: amount(point.saved), kept: amount(point.kept) }));
      const peak = Math.max(1, ...points.map((point) => point.saved));
      for (const point of points) {
        const bar = el("span", "fb-bar");
        const height = point.saved > 0 ? Math.max(6, Math.round((point.saved / peak) * 42)) : 3;
        bar.style.height = `${height}px`;
        bar.dataset.empty = point.saved > 0 ? "false" : "true";
        const requestTotal = point.saved + point.kept;
        bar.title = `${fmt(point.saved)} chars pruned (≈${fmt(tokensForChars(point.saved, estimate))} tokens)${
          requestTotal > 0 ? ` · ${fmtPercent(percentOf(point.saved, requestTotal))} of the request` : ""
        }`;
        bars.append(bar);
      }
      barsNote.textContent = `Last ${history.length} guarded request${
        history.length === 1 ? "" : "s"
      } in this chat. Taller bars pruned more.`;
    } else {
      barsNote.textContent = "No request history yet.";
    }

    totalsLine.replaceChildren();
    if (totals && amount(totals.context) > 0) {
      const prunedChip = el("span", "fb-chip", `${fmtCompact(amount(totals.prunedChars))} chars pruned`);
      prunedChip.dataset.tone = "primary";
      const chatCount = Object.keys(pluginStatus?.sessions ?? {}).length;
      totalsLine.append(
        el("span", "fb-chip", `${fmt(amount(totals.context))} requests`),
        prunedChip,
        el("span", "fb-chip", `${fmt(amount(totals.collapsed))} repeats`),
        el("span", "fb-chip", `${chatCount} chat${chatCount === 1 ? "" : "s"}`),
      );
    } else {
      totalsLine.append(el("span", "fb-chip", "No requests yet"));
    }

    sessionsHost.replaceChildren();
    const sessions = Object.entries(pluginStatus?.sessions ?? {})
      .sort((a, b) => amount(b[1].lastAt) - amount(a[1].lastAt))
      .slice(0, 5);
    if (!sessions.length) {
      sessionsHost.append(el("div", "fb-empty", "No session ledger yet."));
    } else {
      const table = el("table", "fb-table");
      const head = el("thead");
      const headRow = el("tr");
      headRow.append(
        el("th", "", "Chat"),
        el("th", "fb-num", "Guarded"),
        el("th", "fb-num", "Cum. pruned"),
        el("th", "fb-num", "Last"),
      );
      head.append(headRow);
      const body = el("tbody");
      for (const [id, session] of sessions) {
        const row = el("tr");
        if (id === sessionId()) row.dataset.current = "true";
        const name = el("td");
        name.textContent = id === sessionId() ? "this chat" : shortSessionId(id);
        name.title = id;
        row.append(
          name,
          el("td", "fb-num", String(amount(session.runs))),
          el("td", "fb-num", fmtCompact(amount(session.prunedChars))),
          el("td", "fb-num", fmtAge(session.lastAt)),
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

/* ------------------------------------------------------------------ */
/*  Power card scaffolding                                            */
/* ------------------------------------------------------------------ */

type PowerSpec = {
  id: string;
  icon: string;
  title: string;
  tag: string;
  tab: string;
  build: (body: HTMLElement) => void;
  status: () => { label: string; tone: Tone };
};

const specs: PowerSpec[] = [
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
    },
  },
  {
    id: "handoff",
    icon: "passport",
    title: "Handoff Passport",
    tag: "Move a session’s brain into a clean context",
    tab: "context",
    build: buildHandoff,
    status: () =>
      handoffState.messages?.length
        ? { label: "Loaded", tone: "success" }
        : { label: "On demand", tone: "neutral" },
  },
  {
    id: "slice",
    icon: "layers",
    title: "Slice Forge",
    tag: "Goal → tiny verifiable steps, acceptance checks, first prompt",
    tab: "build",
    build: buildSliceForge,
    status: () => (powerResults["slice"] ? { label: "Ready", tone: "success" } : { label: "On demand", tone: "neutral" }),
  },
  {
    id: "bug",
    icon: "bug",
    title: "Bug Hunter",
    tag: "Repro first, ranked causes, verification, regression guard",
    tab: "build",
    build: buildBugHunter,
    status: () => (powerResults["bug"] ? { label: "Ready", tone: "success" } : { label: "On demand", tone: "neutral" }),
  },
  {
    id: "red-pen",
    icon: "pen",
    title: "Red Pen",
    tag: "Correctness, edge cases, security, tests — on a selection",
    tab: "build",
    build: buildRedPen,
    status: () =>
      redState.code.trim() ? { label: "Loaded", tone: "success" } : { label: "On demand", tone: "neutral" },
  },
  {
    id: "game",
    icon: "gamepad",
    title: "Game Feel Lab",
    tag: "Juice pass, tuning matrix, playtest kit",
    tab: "build",
    build: buildGameFeel,
    status: () => (powerResults["game"] ? { label: "Ready", tone: "success" } : { label: "On demand", tone: "neutral" }),
  },
  {
    id: "character",
    icon: "user",
    title: "Character Forge",
    tag: "Want, need, wound, contradiction, voice — a playable person",
    tab: "studio",
    build: buildCharacterForge,
    status: () =>
      characters.length
        ? { label: `${characters.length} saved`, tone: "primary" }
        : { label: "On demand", tone: "neutral" },
  },
  {
    id: "prose",
    icon: "quill",
    title: "Prose Atelier",
    tag: "Line polish, scene diagnosis, voice matching",
    tab: "studio",
    build: buildProse,
    status: () => (powerResults["prose"] ? { label: "Ready", tone: "success" } : { label: "On demand", tone: "neutral" }),
  },
  {
    id: "idea",
    icon: "bulb",
    title: "Idea Distiller",
    tag: "Score sparks, blend two, promote the winner",
    tab: "studio",
    build: buildIdeaDistiller,
    status: () =>
      sparks.length ? { label: `${sparks.length} sparks`, tone: "primary" } : { label: "On demand", tone: "neutral" },
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
    },
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
      return lastSaved > 0
        ? { label: `${fmtCompact(lastSaved)} pruned now`, tone: "success" }
        : { label: "Watching", tone: "primary" };
    },
  },
];

const TAB_DEFS: Array<{ id: string; label: string }> = [
  { id: "context", label: "Context" },
  { id: "build", label: "Build" },
  { id: "studio", label: "Studio" },
  { id: "tune", label: "Tune" },
  { id: "metrics", label: "Metrics" },
];

const TABS = TAB_DEFS.map((tab) => ({
  ...tab,
  count: specs.filter((spec) => spec.tab === tab.id).length,
}));

const TAB_PANES: Record<string, HTMLElement> = {};

function buildPowerCard(spec: PowerSpec, pane: HTMLElement): void {
  const card = el("section", "fb-power");
  card.dataset.open = "false";
  const head = el("button", "fb-power-head");
  head.type = "button";
  head.setAttribute("aria-expanded", "false");
  const iconTile = el("span", "fb-power-ico");
  iconTile.append(icon(spec.icon));
  const text = el("span");
  text.append(el("span", "fb-power-name", spec.title), el("span", "fb-power-tag", spec.tag));
  text.style.display = "flex";
  text.style.flexDirection = "column";
  text.style.minWidth = "0";
  const badgeHost = el("span", "fb-badge-host");
  const badge = mountBadge(badgeHost, spec.status());
  const chevron = el("span", "fb-power-chev");
  chevron.append(icon("chevron"));
  head.append(iconTile, text, badgeHost, chevron);

  const body = el("div", "fb-power-body");
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
      body.append(el("div", "fb-note", describeError(error)));
    }
  };

  const setOpen = (open: boolean) => {
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
      // A disposed badge is harmless.
    }
  };

  powerCards.set(spec.id, { open: () => setOpen(true), close: () => setOpen(false), refresh, element: card });
  if (spec.id === "context-keeper") setOpen(true);
}

function buildShell(): void {
  /* A rebuild (Reload rules) replaces every card: drop the old tab listener and per-build
     registries first, or stale handles keep updating detached nodes after the swap. */
  try {
    tabsHandle?.dispose();
  } catch {
    // A disposed tabs track is harmless.
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
    // The progress control may already be detached.
  }
  sessionProgress = null;
  activePower = null;
  try {
    bannerHandle?.dispose();
  } catch {
    // A stale banner must not block a rebuild.
  }
  bannerHandle = null;
  root!.replaceChildren();
  const shell = el("div", "fb-shell");

  const head = el("header", "fb-head");
  const mark = el("div", "fb-mark-tile");
  mark.append(icon("fox"));
  const headText = el("div", "fb-head-text");
  headText.append(
    el("h1", "fb-title", "Fox Box"),
    el("p", "fb-subtitle", "Ten sharp little powers. A ledger for what they save."),
  );
  head.append(mark, headText, el("span", "fb-version", `v${VERSION}`));

  shell.append(head, buildBannerHost(), buildSessionStrip());

  const tabsHost = el("div", "fb-tabs-host");
  shell.append(tabsHost);

  const panes = el("div");
  for (const tab of TABS) {
    const pane = el("div", "fb-tabpane");
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
    },
  });

  for (const spec of specs) {
    buildPowerCard(spec, TAB_PANES[spec.tab] ?? TAB_PANES["context"]!);
  }

  shell.append(buildFooter());
  root!.append(shell);
}

/* ------------------------------------------------------------------ */
/*  Focus and refresh                                                 */
/* ------------------------------------------------------------------ */

function focusPower(id: string): void {
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

function refreshAll(): void {
  try {
    updateSessionUI();
  } catch {
    // A transient DOM state must not break the rest of the panel.
  }
  for (const card of powerCards.values()) card.refresh();
  for (const update of Object.values(powerUpdaters)) {
    try {
      update();
    } catch {
      // A hidden/not-yet-built card can throw; it is harmless.
    }
  }
  if (footerPlugin) {
    try {
      footerPlugin.replaceChildren();
      const plugin = pluginLabel();
      const chip = el("span", "fb-chip", plugin.text);
      chip.dataset.tone = plugin.tone;
      footerPlugin.append(chip);
    } catch {
      // A stale footer must not break the panel.
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Actions and item capture                                          */
/* ------------------------------------------------------------------ */

function captureSelection(text: string, target: "red-pen" | "bug" | "prose"): void {
  if (target === "red-pen") {
    redState.code = text.slice(0, 20000);
    redState.label = "Selected text";
    /* A selection replaces a captured file: drop its path and range instead of leaving stale ones. */
    redState.path = "";
    redState.range = "";
    redState.result = "";
    clearPowerResult("red-pen");
    handles["red-code"]?.update({ value: redState.code });
    handles["red-capture"]?.update({ value: redState.label });
  } else if (target === "bug") {
    bugState.symptom = text.slice(0, 8000);
    bugState.result = "";
    clearPowerResult("bug");
    handles["bug-symptom"]?.update({ value: bugState.symptom });
  } else {
    proseState.text = text.slice(0, 16000);
    proseState.source = "Selected text";
    proseState.result = "";
    clearPowerResult("prose");
    handles["prose-text"]?.update({ value: proseState.text });
  }
  focusPower(target);
  toast("info", "Selection loaded.");
}

async function captureFile(path: string, range?: { start: number; end: number }): Promise<void> {
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

function handleItem(item: any): void {
  if (!item) return;
  try {
    handleItemUnsafe(item);
  } catch (error) {
    notifyError(error, "Loading the item");
  }
}

function handleItemUnsafe(item: any): void {
  actionItem = item;
  const data =
    item.data && typeof item.data === "object"
      ? item.data
      : typeof item.data === "string"
        ? (() => {
            try {
              return JSON.parse(item.data);
            } catch {
              return null;
            }
          })()
        : null;
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
    const captured = Array.isArray(item.messages)
      ? item.messages
          .filter((message: any) => message && typeof message === "object")
          .map((message: any) => ({
            role: message.role === "assistant" ? "assistant" : "user",
            text: String(message.text ?? ""),
          }))
      : [];
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

/* ------------------------------------------------------------------ */
/*  Sessions and project                                              */
/* ------------------------------------------------------------------ */

function stopSessions(): void {
  sessionsToken += 1;
  try {
    sessionsStop?.();
  } catch {
    // A subscription that already failed must not break teardown.
  }
  sessionsStop = null;
  currentSessionRecord = null;
}

async function subscribeSessions(): Promise<void> {
  stopSessions();
  const id = projectId;
  if (!id) return;
  const token = sessionsToken;
  try {
    const stop = await host.onSessions(id, (snapshot: any) => {
      if (token !== sessionsToken || id !== projectId) return;
      const list = Array.isArray(snapshot?.sessions) ? snapshot.sessions : [];
      currentSessionRecord = list.find((session: any) => session.id === sessionId()) ?? null;
      refreshAll();
    });
    if (token !== sessionsToken || id !== projectId) {
      try {
        stop();
      } catch {
        // A stale subscription that cannot be removed is harmless.
      }
      return;
    }
    sessionsStop = stop;
  } catch {
    if (token === sessionsToken) currentSessionRecord = null;
  }
}

async function syncProject(): Promise<void> {
  const seq = ++syncSeq;
  const directory = ready?.directory;
  const nextStatusKey = statusFileKey(directory);
  if (nextStatusKey !== statusKey) {
    statusKey = nextStatusKey;
    pluginStatus = null;
  }
  /* Match the plugin's key exactly. It normalizes ctx.location.directory and keeps "" when
     there is none; an arbitrary "global" key here would save a brief the plugin never reads. */
  const fallbackKey = normalizeDir(directory);
  projectKey = fallbackKey;
  projectScan = null;
  handles["context-brief"]?.update({ value: currentBrief(), disabled: true });
  if (!directory) {
    projectId = null;
    handles["context-brief"]?.update({ value: currentBrief(), disabled: false });
    stopSessions();
    refreshAll();
    return;
  }
  try {
    const projects = await host.listProjects();
    if (seq !== syncSeq) return;
    const match = (projects.projects ?? []).find(
      (project: any) => normalizeDir(project.directory) === normalizeDir(directory),
    );
    projectId = match?.id ?? null;
    projectKey = normalizeDir(match?.directory) || fallbackKey;
  } catch {
    if (seq !== syncSeq) return;
    projectId = null;
  }
  if (seq !== syncSeq) return;
  handles["context-brief"]?.update({ value: currentBrief(), disabled: false });
  await subscribeSessions();
  if (seq !== syncSeq) return;
  refreshAll();
}

/* ------------------------------------------------------------------ */
/*  Plugin status polling                                             */
/* ------------------------------------------------------------------ */

async function refreshPluginStatus(): Promise<boolean> {
  if (document.hidden || statusBusy) return false;
  statusBusy = true;
  let read = false;
  const key = statusFileKey(ready?.directory);
  if (key !== statusKey) {
    /* A project switch must not leave the previous project's ledger on screen. */
    statusKey = key;
    pluginStatus = null;
  }
  try {
    let content: string | null = null;
    for (const path of [projectStatusPath(), LEGACY_STATUS_PATH]) {
      try {
        const result = await host.readFile(path);
        content = result.content;
        break;
      } catch (error) {
        if (errorCode(error) !== "NOT_FOUND") throw error;
      }
    }
    if (content) {
      const parsed = JSON.parse(content.replace(/^\uFEFF/, "")) as PluginStatus;
      if (parsed && typeof parsed === "object") {
        pluginStatus = parsed;
        read = true;
      }
    } else {
      pluginStatus = null;
    }
  } catch (error) {
    /* A half-written or unreadable status is ignored; the next poll picks it up. */
  } finally {
    statusBusy = false;
  }
  try {
    refreshAll();
  } catch {
    // The next poll gets another chance.
  }
  return read;
}

/* ------------------------------------------------------------------ */
/*  Boot                                                              */
/* ------------------------------------------------------------------ */

function isCharacter(value: unknown): value is Character {
  const id = (value as Character | null)?.id;
  return Boolean(value) && typeof value === "object" && typeof id === "string" && id.length > 0 && id.length <= 100;
}

function isSpark(value: unknown): value is Spark {
  const id = (value as Spark | null)?.id;
  return Boolean(value) && typeof value === "object" && typeof id === "string" && id.length > 0 && id.length <= 100;
}

function normalizeCharacter(value: Character): Character {
  const short = (input: unknown, max = 600) => String(input ?? "").slice(0, max);
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
    updatedAt: Number(value.updatedAt) || Date.now(),
  };
}

function normalizeSpark(value: Spark): Spark {
  const scores = value.scores;
  return {
    id: value.id,
    title: String(value.title ?? "").slice(0, 160),
    note: String(value.note ?? "").slice(0, NOTE_MAX),
    createdAt: Number(value.createdAt) || Date.now(),
    scores:
      scores && typeof scores === "object"
        ? {
            novelty: clampInt(scores.novelty, 1, 5, 3),
            usefulness: clampInt(scores.usefulness, 1, 5, 3),
            fit: clampInt(scores.fit, 1, 5, 3),
            effort: clampInt(scores.effort, 1, 5, 3),
          }
        : undefined,
  };
}

async function loadStorage(): Promise<void> {
  characters = [];
  sparks = [];
  let legacyCharacters = false;
  let legacySparks = false;
  try {
    const index = await host.storage.get(CHARACTER_INDEX_KEY);
    if (Array.isArray(index)) {
      const ids = index.filter((id): id is string => typeof id === "string").slice(0, 40);
      const loaded = await Promise.all(
        ids.map((id) => host.storage.get(characterKey(id)).catch(() => undefined)),
      );
      characters = loaded.filter(isCharacter).map(normalizeCharacter).slice(0, 40);
      selectedCharacterId = characters[0]?.id ?? null;
    } else {
      const legacy = await host.storage.get("characters");
      if (Array.isArray(legacy)) {
        legacyCharacters = true;
        characters = legacy.filter(isCharacter).map(normalizeCharacter).slice(0, 40);
        selectedCharacterId = characters[0]?.id ?? null;
        if (characters.length) persistCharacters();
      }
    }
  } catch {
    characters = [];
  }
  try {
    const index = await host.storage.get(SPARK_INDEX_KEY);
    if (Array.isArray(index)) {
      const ids = index.filter((id): id is string => typeof id === "string").slice(0, 60);
      const loaded = await Promise.all(
        ids.map((id) => host.storage.get(sparkKey(id)).catch(() => undefined)),
      );
      sparks = loaded.filter(isSpark).map(normalizeSpark).slice(0, 60);
    } else {
      const legacy = await host.storage.get("sparks");
      if (Array.isArray(legacy)) {
        legacySparks = true;
        sparks = legacy.filter(isSpark).map(normalizeSpark).slice(0, 60);
        if (sparks.length) persistSparks();
      }
    }
  } catch {
    sparks = [];
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

async function boot(ctx: any): Promise<void> {
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
        "This config file was written by a newer Fox Box version. Update the extension before saving; changes stay in memory for now.",
      );
      configSaveWarned = true;
    } else if (!configLoaded) {
      showBanner(
        "warning",
        "Rules are not saved",
        "Fox Box could not load its config file, so changes stay in memory only. Fix or remove ~/.config/openchamber/fox-box/config.json, or approve Fox Box's file access, then reopen the panel.",
      );
      configSaveWarned = true;
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
    if (statusTimer !== undefined) window.clearInterval(statusTimer);
    statusTimer = window.setInterval(() => {
      if (!document.hidden) void refreshPluginStatus();
    }, 4000);
  } catch (error) {
    booting = false;
    booted = false;
    stopSessions();
    if (statusTimer !== undefined) {
      window.clearInterval(statusTimer);
      statusTimer = undefined;
    }
    root!.replaceChildren();
    const box = el("div", "fb-empty");
    box.textContent = `Fox Box could not start. ${describeError(error)}`;
    root!.append(box);
  }
}

host.onReady((ctx: any) => {
  if (!ctx || typeof ctx !== "object") return;
  ready = ctx;
  try {
    applyHostReady(ctx, document.documentElement);
  } catch {
    // Theme application is cosmetic; keep the panel usable.
  }
  document.body.dataset.theme = ctx.theme?.mode ?? "dark";
  document.body.dataset.surface = ctx.surface ?? "panel";
  if (!booted) {
    void boot(ctx);
    return;
  }
  refreshAll();
  void syncProjectIfNeeded(ctx).catch(() => {
    // A project sync failure leaves the previous project view in place.
  });
});

async function syncProjectIfNeeded(ctx: any): Promise<void> {
  const directory = normalizeDir(ctx.directory);
  if (directory !== lastDirectory) {
    lastDirectory = directory;
    await syncProject();
  }
}

host.onDirectory((directory: string | null) => {
  if (!ready) return;
  ready.directory = directory;
  lastDirectory = normalizeDir(directory);
  void syncProject().catch(() => {
    // A project sync failure leaves the previous project view in place.
  });
});

host.onSession((session: any) => {
  if (!ready) return;
  if (ready.session?.id !== session?.id) currentSessionRecord = null;
  ready.session = session;
  refreshAll();
});

host.onAction((item: any) => {
  if (!booted) {
    pendingAction = item;
    return;
  }
  handleItem(item);
});

host.onItem((item: any) => {
  if (!item) return;
  if (!booted) {
    pendingAction = item;
    return;
  }
  handleItem(item);
});

window.addEventListener("pagehide", () => {
  stopSessions();
  if (statusTimer !== undefined) {
    window.clearInterval(statusTimer);
    statusTimer = undefined;
  }
  if (configTimer !== undefined) {
    window.clearTimeout(configTimer);
    configTimer = undefined;
    /* Send the pending write before dispose; the host processes messages in order. */
    void saveConfigNow();
  }
  if (charactersTouched) saveCharactersNow();
  if (sparksTouched) saveSparksNow();
  try {
    bannerHandle?.dispose();
  } catch {
    // The frame is going away.
  }
  try {
    host.dispose();
  } catch {
    // The frame is going away; a dispose error is not actionable.
  }
});
