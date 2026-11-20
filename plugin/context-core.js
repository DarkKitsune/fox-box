/*
 * Fox Box context engine: shared, defensive primitives.
 *
 * This module edits the outgoing model request only. Every helper here is
 * defensive by design: it runs on model-authored tool payloads, which are often
 * malformed JSON, XML, diffs, logs, or partially written code. A parser that
 * cannot understand a value must leave it alone, never throw, and never make a
 * result larger than it already was.
 */

export const DUPLICATE_PREFIX = "[Fox Box: duplicate ";
export const SUPERSEDED_PREFIX = "[Fox Box: superseded ";
export const STALE_PREFIX = "[Fox Box: stale read";
export const BUDGET_PREFIX = "[Fox Box: budget ";
export const RECEIPT_KEY = "foxBoxReceipt";

export const READ_TOOL_NAMES = new Set(["read", "read_file"]);
export const EDIT_TOOL_NAMES = new Set([
  "write",
  "write_file",
  "create",
  "create_file",
  "edit",
  "edit_file",
  "multiedit",
  "multi_edit",
  "apply_patch",
  "applypatch",
  "patch",
  "replace",
  "str_replace",
  "insert",
]);
export const SEARCH_TOOL_NAMES = new Set(["grep", "glob", "list", "find", "search", "ripgrep", "fd"]);
export const SHELL_TOOL_NAMES = new Set(["bash", "shell", "execute", "exec", "run", "powershell", "cmd"]);
export const WEB_TOOL_NAMES = new Set(["webfetch", "websearch", "fetch", "browse", "web_fetch", "web_search"]);
export const COLLAPSIBLE_TOOL_NAMES = new Set([
  "read",
  "read_file",
  "grep",
  "glob",
  "list",
  "find",
  "search",
  "webfetch",
  "websearch",
  "fetch",
  "browse",
  "bash",
  "shell",
  "skill",
]);

export const CODE_EXTENSIONS =
  /\.(?:ts|tsx|js|jsx|mjs|cjs|py|pyi|rs|go|java|kt|kts|cs|c|h|cc|cpp|cxx|hpp|rb|php|swift|scala|sh|bash|ps1|sql|lua|zig|dart|ex|exs|clj|fs|fsx|vb|r|jl|vue|svelte)$/i;

/*
 * Markup, prose and config files are source too. A read of one of these must not
 * be mistaken for a fetched web page or a CSV table by the type-aware compactors.
 */
export const SOURCE_TEXT_EXTENSIONS =
  /\.(?:html?|xhtml|xml|svg|css|scss|sass|less|md|markdown|mdx|rst|adoc|txt|ya?ml|toml|ini|cfg|conf|env|properties|gradle|cmake|makefile|dockerfile)$/i;

export const STOP_WORDS = new Set(
  (
    "the and for with that this from have has had was were are you your our are not but " +
    "can could should would will just use using used into then than when where which while " +
    "what why how all any some more most very much many like also only over under between " +
    "file files code line lines read write edit test tests run make get set add need please " +
    "there here they them their it its about after before again still even because if else " +
    "true false null undefined return function const let var new class import export from"
  ).split(/\s+/),
);

export const CONTEXT_RULE_DEFAULTS = Object.freeze({
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
});

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

export function normalizeContextRules(input = {}) {
  const rules = input && typeof input === "object" ? input : {};
  return {
    protectSkills: rules.protectSkills !== false,
    keepRecent: clampInt(rules.keepRecent ?? 8, 2, 40, 8),
    protectedReads: clampInt(rules.protectedReads ?? 6, 0, 12, 6),
    collapseDuplicates: rules.collapseDuplicates !== false,
    trimToolOutput: rules.trimToolOutput === true,
    maxToolOutput: clampInt(rules.maxToolOutput ?? 128000, 2000, 256000, 128000),
    maxOldToolOutput: clampInt(rules.maxOldToolOutput ?? 6000, 1000, 64000, 6000),
    protectPaths: typeof rules.protectPaths === "string" ? rules.protectPaths.slice(0, 4000) : "",
    pathSupersession: rules.pathSupersession !== false,
    staleReads: rules.staleReads !== false,
    mergeReadRanges: rules.mergeReadRanges !== false,
    editReceipts: rules.editReceipts !== false,
    receiptMinChars: clampInt(rules.receiptMinChars ?? 1200, 200, 20000, 1200),
    smartCompaction: rules.smartCompaction !== false,
    skeletonCodeReads: rules.skeletonCodeReads === true,
    budgetTokens: clampInt(rules.budgetTokens ?? 0, 0, 2_000_000, 0),
    charsPerToken: clampNumber(rules.charsPerToken ?? 4, 1, 20, 4),
    relevanceScoring: rules.relevanceScoring !== false,
  };
}

export function normalizePathKey(value, projectKey = "") {
  let text = String(value || "")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .trim();
  if (!text || text === "/dev/null") return "";
  while (text.startsWith("./")) text = text.slice(2);
  if (text && !text.startsWith("/") && !/^[a-z]:\//i.test(text) && projectKey) {
    text = `${projectKey}/${text}`;
  }
  const caseInsensitive =
    typeof process !== "undefined" && (process.platform === "win32" || process.platform === "darwin");
  return caseInsensitive ? text.toLowerCase() : text;
}

export function safeStringify(value, depth = 0, seen = null) {
  const marker = seen || new WeakSet();
  try {
    if (value === null) return "null";
    const kind = typeof value;
    if (kind === "string") return JSON.stringify(value);
    if (kind === "number") return Number.isFinite(value) ? String(value) : "null";
    if (kind === "boolean") return value ? "true" : "false";
    if (kind === "bigint") return JSON.stringify(String(value));
    if (kind === "undefined" || kind === "function" || kind === "symbol") return "null";
    if (depth >= 8) return JSON.stringify("…");
    if (marker.has(value)) return JSON.stringify("[circular]");
    marker.add(value);
    let output;
    if (Array.isArray(value)) {
      const items = [];
      const limit = Math.min(value.length, 120);
      for (let index = 0; index < limit; index += 1) {
        items.push(safeStringify(value[index], depth + 1, marker));
      }
      if (value.length > limit) items.push(JSON.stringify(`…${value.length - limit} more`));
      output = `[${items.join(",")}]`;
    } else {
      let keys;
      try {
        keys = Object.keys(value);
      } catch {
        keys = [];
      }
      keys = keys.slice(0, 120);
      output = `{${keys
        .map((key) => `${JSON.stringify(key)}:${safeStringify(value[key], depth + 1, marker)}`)
        .join(",")}}`;
    }
    marker.delete(value);
    return output;
  } catch {
    return JSON.stringify("[unreadable]");
  }
}

export function asObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  const text = value.replace(/^\uFEFF/, "").trim();
  if (!text || (text[0] !== "{" && text[0] !== "[")) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function firstString(object, keys) {
  if (!object || typeof object !== "object") return "";
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

export function firstInputPath(input) {
  if (typeof input === "string") {
    const parsed = asObject(input);
    if (parsed) return firstInputPath(parsed);
    let text = input.trim();
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
      text = text.slice(1, -1).trim();
    }
    return text && text.length <= 500 && !/[\r\n]/.test(text) ? text : "";
  }
  if (!input || typeof input !== "object") return "";
  return firstString(input, ["filePath", "file_path", "path", "file", "filename", "target"]);
}

export function pathsFromPatch(text) {
  const paths = [];
  if (typeof text !== "string" || !text) return paths;
  const patterns = [
    /^\*\*\*\s+(?:Update|Add|Delete) File:\s*(.+)$/gim,
    /^\+\+\+\s+(?:b\/)?(.+?)(?:\t|$)/gm,
    /^---\s+(?:a\/)?(.+?)(?:\t|$)/gm,
    /^diff --git\s+a\/.+?\s+b\/(.+)$/gm,
  ];
  for (const pattern of patterns) {
    let match;
    let count = 0;
    while ((match = pattern.exec(text)) && count < 40) {
      const value = String(match[1] || "").trim();
      if (value && value !== "/dev/null") paths.push(value);
      count += 1;
    }
  }
  return paths;
}

export function inputPaths(input, seen = new WeakSet()) {
  const paths = [];
  if (typeof input === "string") {
    const direct = firstInputPath(input);
    if (direct) paths.push(direct);
    for (const path of pathsFromPatch(input)) paths.push(path);
    return Array.from(new Set(paths));
  }
  if (!input || typeof input !== "object") return paths;
  if (seen.has(input)) return paths;
  seen.add(input);
  for (const key of ["path", "filePath", "file_path", "file", "filename", "target", "pattern", "glob", "include"]) {
    const value = input[key];
    if (typeof value === "string" && value) paths.push(value);
  }
  for (const key of ["patch", "diff", "patchText", "diffText"]) {
    const value = input[key];
    if (typeof value === "string") {
      for (const path of pathsFromPatch(value)) paths.push(path);
    }
  }
  for (const key of ["edits", "changes"]) {
    const value = input[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        for (const path of inputPaths(item, seen)) paths.push(path);
      }
    }
  }
  return Array.from(new Set(paths));
}

export function toolKind(name) {
  const tool = String(name || "").toLowerCase();
  if (READ_TOOL_NAMES.has(tool)) return "read";
  if (EDIT_TOOL_NAMES.has(tool)) return "edit";
  if (SEARCH_TOOL_NAMES.has(tool)) return "search";
  if (SHELL_TOOL_NAMES.has(tool)) return "shell";
  if (WEB_TOOL_NAMES.has(tool)) return "web";
  if (/json|csv|lookup|query|sql|database|mcp/.test(tool)) return "structured";
  return "other";
}

/*
 * A skill is more than one Markdown file: a skill folder can hold reference
 * Markdown, JSON schemas, manifests, prompt fragments, and scripts. All of them
 * shape model behavior, so the whole folder is protected from compaction and
 * budget eviction. The handful of root-level skill manifests are covered too.
 */
export function isSkillPath(value) {
  const text = String(value || "").replace(/\\/g, "/");
  if (!text) return false;
  if (/(^|\/)skills?\//i.test(text)) return true;
  if (/(^|\/)\.opencode\/(?:skills?|skill)\//i.test(text)) return true;
  const segments = text.split("/");
  /* Any folder whose name mentions "skill" carries skill material. */
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (/skill/i.test(segments[index])) return true;
  }
  const base = segments[segments.length - 1] || "";
  if (/^SKILL\.md$/i.test(base)) return true;
  if (/skill.*\.json$/i.test(base)) return true;
  return false;
}

export function isSkillCall(toolName, input) {
  if (/skill/i.test(String(toolName || ""))) return true;
  for (const path of inputPaths(input)) {
    if (isSkillPath(path)) return true;
  }
  return false;
}

export function looksLikeSkillResult(result) {
  if (!result || typeof result !== "object") return false;
  const text = resultText(result).slice(0, 12000).trim();
  if (!text) return false;
  /*
   * Only a parsed manifest, or a document whose heading names SKILL.md, counts.
   * A normal file that merely mentions "SKILL.md" or a "skills/" folder is
   * documentation or source, not a skill payload, and must stay prunable.
   */
  if (text.startsWith("{") || text.startsWith("[")) {
    const parsed = asObject(text);
    if (parsed && !Array.isArray(parsed)) {
      const hasSkill = "skill" in parsed || "skills" in parsed;
      const hasPrompt =
        typeof parsed.instructions === "string" ||
        typeof parsed.description === "string" ||
        (typeof parsed.name === "string" && hasSkill) ||
        Array.isArray(parsed.skills);
      if (hasSkill && hasPrompt) return true;
    }
  }
  return /^\s*#\s*SKILL\.md\b/im.test(text);
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

export function createProtectMatcher(protectPaths, projectKey = "") {
  if (!protectPaths || !String(protectPaths).trim()) return () => false;
  const patterns = String(protectPaths)
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
    const paths = inputPaths(input).map((path) => path.replace(/\\/g, "/"));
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

export function stableInputLength(input) {
  try {
    return safeStringify(input).length;
  } catch {
    return 0;
  }
}

export function resultText(result) {
  try {
    if (result === null || result === undefined) return "";
    if (typeof result === "string") return result;
    if (typeof result !== "object") return "";
    if (result.type === "text" && typeof result.value === "string") return result.value;
    if (result.type === "content" && Array.isArray(result.value)) {
      const chunks = [];
      for (const part of result.value) {
        if (part && part.type === "text" && typeof part.text === "string") chunks.push(part.text);
      }
      return chunks.join("\n");
    }
    if (result.type === "json") return safeStringify(result.value);
    if (result.type === "error") {
      return typeof result.value === "string" ? result.value : safeStringify(result.value);
    }
    if (typeof result.value === "string") return result.value;
    return "";
  } catch {
    return "";
  }
}

export function resultTextLength(result) {
  return resultText(result).length;
}

export function isErrorResult(result) {
  try {
    if (!result || typeof result !== "object") return false;
    if (result.type === "error") return true;
    if (result.isError === true || result.error === true) return true;
    /*
     * Only a line that reads as an error report counts: a keyword followed by a
     * colon, bracket, dash or the end of the line. A grep hit such as
     * "error.ts:12: …" or prose such as "Error handling notes" is normal output
     * and must stay eligible for trimming and compaction.
     */
    const text = resultText(result).trimStart();
    if (!text) return false;
    const firstLine = text.slice(0, 200).split(/\r?\n/, 1)[0].trim();
    return /^(?:error|failed|failure|exception|panic|fatal)\b\s*(?:[:(]|[-–—]\s|$)/i.test(firstLine);
  } catch {
    return false;
  }
}

export function isStubResult(result) {
  const text = resultText(result).trimStart();
  return (
    text.startsWith(DUPLICATE_PREFIX) ||
    text.startsWith(SUPERSEDED_PREFIX) ||
    text.startsWith(STALE_PREFIX) ||
    text.startsWith(BUDGET_PREFIX)
  );
}

export function setResultObject(part, result) {
  try {
    if (!part || typeof part !== "object") return false;
    part.result = result;
    return true;
  } catch {
    return false;
  }
}

export function setResultText(part, text) {
  try {
    if (!part || typeof part !== "object") return false;
    const result = part.result;
    if (!result || typeof result !== "object") return false;
    if (result.type === "error") return false;
    if (result.type === "content" && Array.isArray(result.value)) {
      /* Keep attached files (images, media) while replacing only the text. */
      const kept = result.value.filter((item) => !(item && item.type === "text"));
      part.result = { ...result, value: [{ type: "text", text }, ...kept] };
    } else {
      part.result = { ...result, type: "text", value: text };
    }
    return true;
  } catch {
    return false;
  }
}

export function setToolInput(part, input) {
  if (!part || typeof part !== "object" || part.type !== "tool-call") return false;
  try {
    part.input = input;
    return true;
  } catch {
    return false;
  }
}

export function oneLine(value, max) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").slice(0, max);
}

export function countLines(text) {
  if (typeof text !== "string" || !text) return 0;
  let count = 1;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) count += 1;
  }
  return count;
}

export function splitLines(text) {
  return String(text || "").split("\n");
}

export function positiveNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return Math.round(number);
  }
  return 0;
}

export function readRangeFor(input, text) {
  let source = asObject(input) || (input && typeof input === "object" ? input : null);
  if (!source && typeof input === "string" && input.trim()) source = {};
  if (!source) return null;
  const start = positiveNumber(source.offset, source.startLine, source.start, source.line, source.from) || 1;
  const limit = positiveNumber(source.limit, source.count, source.lines);
  const explicitEnd = positiveNumber(source.endLine, source.end, source.to);
  const actual = countLines(text);
  if (actual <= 0) return null;
  let end = explicitEnd || (limit ? start + limit - 1 : start + actual - 1);
  if (limit) end = Math.min(end, start + limit - 1);
  end = Math.max(start, Math.min(end, start + actual - 1));
  return { start, end, lineCount: actual };
}

export function lineNumberAt(text, start) {
  const lines = splitLines(text);
  const numbers = [];
  let matched = 0;
  let last = 0;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const match = /^\s*(\d{1,9})[\t:| ]/.exec(lines[lineIndex]);
    if (match) {
      const number = Number(match[1]);
      if (Number.isFinite(number) && number > 0) {
        numbers.push(number);
        last = number;
        matched += 1;
        continue;
      }
    }
    numbers.push(last > 0 ? last + 1 : start + lineIndex);
    last = numbers[numbers.length - 1];
  }
  if (matched < Math.max(3, Math.ceil(lines.length * 0.6))) return null;
  if (numbers.length && numbers[0] !== start) return null;
  for (let index = 1; index < numbers.length; index += 1) {
    if (numbers[index] <= numbers[index - 1]) return null;
  }
  return numbers;
}

/* ------------------------------------------------------------------ */
/*  Measurement                                                       */
/* ------------------------------------------------------------------ */

function emptyMeasure() {
  return {
    chars: 0,
    textChars: 0,
    estimatedTokens: 0,
    system: 0,
    toolDefinitions: 0,
    text: 0,
    reasoning: 0,
    media: 0,
    toolInputs: 0,
    toolResults: 0,
    other: 0,
    messages: 0,
    toolCalls: 0,
    toolResultParts: 0,
    toolDefinitionCount: 0,
    mediaParts: 0,
    reasoningParts: 0,
    largestToolDefinitions: [],
  };
}

function countTextish(value, depth = 0, seen = new WeakSet()) {
  if (typeof value === "string") return value.length;
  if (depth > 6) return 0;
  if (Array.isArray(value)) {
    if (seen.has(value)) return 0;
    seen.add(value);
    let total = 0;
    for (const item of value) total += countTextish(item, depth + 1, seen);
    seen.delete(value);
    return total;
  }
  if (value && typeof value === "object") {
    if (seen.has(value)) return 0;
    seen.add(value);
    let total = 0;
    for (const key of ["text", "content", "value", "reasoning", "thinking"]) {
      if (typeof value[key] === "string") total += value[key].length;
      else if (Array.isArray(value[key])) total += countTextish(value[key], depth + 1, seen);
    }
    seen.delete(value);
    return total;
  }
  return 0;
}

function mediaChars(value, depth = 0, seen = new WeakSet()) {
  if (typeof value === "string") return value.length;
  if (typeof value === "number" || typeof value === "boolean") return 0;
  if (typeof Uint8Array !== "undefined" && value instanceof Uint8Array) return value.byteLength;
  if (typeof ArrayBuffer !== "undefined" && value instanceof ArrayBuffer) return value.byteLength;
  if (depth > 4 || !value) return 0;
  if (typeof value === "object") {
    if (seen.has(value)) return 0;
    seen.add(value);
  }
  if (Array.isArray(value)) {
    let total = 0;
    for (const item of value) total += mediaChars(item, depth + 1, seen);
    seen.delete(value);
    return total;
  }
  if (typeof value === "object") {
    let total = 0;
    /* Current parts wrap the payload in `media`; older shapes put it at the top level. */
    for (const key of ["media", "data", "base64", "url", "source", "value", "image", "file"]) {
      total += mediaChars(value[key], depth + 1, seen);
    }
    seen.delete(value);
    return total;
  }
  return 0;
}

function partKind(part) {
  if (!part || typeof part !== "object") return "other";
  const type = String(part.type || "");
  if (type === "reasoning" || type === "thinking" || type === "reasoning-delta") return "reasoning";
  if (type === "image" || type === "file" || type === "media" || type === "attachment" || type === "image_url") {
    return "media";
  }
  return "other";
}

export function measureRequest(messages, system, tools, options = {}) {
  const measure = emptyMeasure();
  const ratio = clampNumber(options.tokensPerChar ?? 0.25, 0.01, 2, 0.25);

  const addSystem = (value) => {
    measure.system += countTextish(value);
  };
  if (typeof system === "string") addSystem(system);
  else if (Array.isArray(system)) {
    for (const part of system) addSystem(part);
  } else if (system && typeof system === "object") {
    addSystem(system);
  }

  const toolEntries = [];
  try {
    if (Array.isArray(tools)) {
      for (let index = 0; index < tools.length; index += 1) {
        const tool = tools[index];
        const name = (tool && (tool.name || tool.id)) || `tool-${index}`;
        toolEntries.push({ name: String(name), chars: safeStringify(tool).length });
      }
    } else if (tools && typeof tools === "object") {
      for (const [name, tool] of Object.entries(tools)) {
        toolEntries.push({ name, chars: safeStringify(tool).length + name.length });
      }
    }
  } catch {
    // A weird tools value contributes nothing; the request still gets measured.
  }
  measure.toolDefinitionCount = toolEntries.length;
  for (const entry of toolEntries) measure.toolDefinitions += entry.chars;
  measure.largestToolDefinitions = toolEntries
    .slice()
    .sort((a, b) => b.chars - a.chars)
    .slice(0, 5)
    .map((entry) => ({ name: entry.name.slice(0, 80), chars: entry.chars }));

  if (Array.isArray(messages)) {
    for (const message of messages) {
      if (!message || typeof message !== "object") continue;
      measure.messages += 1;
      const content = message.content;
      if (typeof content === "string") {
        measure.text += content.length;
        continue;
      }
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (!part || typeof part !== "object") {
          if (typeof part === "string") measure.text += part.length;
          continue;
        }
        if (part.type === "text") {
          const length = typeof part.text === "string" ? part.text.length : countTextish(part.text);
          measure.text += length;
        } else if (partKind(part) === "reasoning") {
          const length =
            (typeof part.text === "string" ? part.text.length : 0) +
            (typeof part.reasoning === "string" ? part.reasoning.length : 0) +
            (typeof part.thinking === "string" ? part.thinking.length : 0) +
            (typeof part.value === "string" ? part.value.length : 0);
          measure.reasoning += length;
          measure.reasoningParts += 1;
        } else if (part.type === "tool-call") {
          measure.toolCalls += 1;
          if (part.input !== undefined && part.input !== null) measure.toolInputs += stableInputLength(part.input);
        } else if (part.type === "tool-result") {
          measure.toolResultParts += 1;
          measure.toolResults += resultTextLength(part.result);
        } else if (partKind(part) === "media") {
          measure.media += mediaChars(part);
          measure.mediaParts += 1;
        } else if (typeof part.text === "string") {
          measure.text += part.text.length;
        } else if (part.type) {
          measure.other += safeStringify(part).length;
        }
      }
    }
  }

  measure.chars =
    measure.system +
    measure.toolDefinitions +
    measure.text +
    measure.reasoning +
    measure.media +
    measure.toolInputs +
    measure.toolResults +
    measure.other;
  measure.textChars = Math.max(0, measure.chars - measure.media);
  measure.estimatedTokens = Math.round(measure.textChars * ratio);
  return measure;
}

/* ------------------------------------------------------------------ */
/*  Key builders                                                      */
/* ------------------------------------------------------------------ */

export function stableToolKey(name, input) {
  const tool = String(name || "tool").toLowerCase();
  if (READ_TOOL_NAMES.has(tool)) {
    const path = normalizePathKey(firstInputPath(input));
    if (path) {
      const source = asObject(input) || (input && typeof input === "object" ? input : {});
      const start = positiveNumber(source.offset, source.startLine, source.start) || 0;
      const limit = positiveNumber(source.limit) || 0;
      const end = positiveNumber(source.endLine, source.end) || 0;
      return `read|${path}|${start}|${limit}|${end}`;
    }
  }
  const key = `${tool}|${safeStringify(input)}`;
  return key.length > 8000 ? `${key.slice(0, 7950)}…${key.length.toString(36)}` : key;
}

export function buildToolCalls(messages) {
  const calls = new Map();
  const list = [];
  if (!Array.isArray(messages)) return { calls, list };
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const message = messages[messageIndex];
    if (!message || !Array.isArray(message.content)) continue;
    for (let partIndex = 0; partIndex < message.content.length; partIndex += 1) {
      const part = message.content[partIndex];
      if (!part || typeof part !== "object" || part.type !== "tool-call") continue;
      list.push({
        id: typeof part.id === "string" ? part.id : "",
        name: String(part.name || ""),
        input: part.input,
        part,
        messageIndex,
        partIndex,
      });
    }
  }
  /*
   * Duplicate ids are malformed but real. Pairing a result with the wrong call
   * can collapse two different files, so only ids that occur once are mapped.
   */
  const idCounts = new Map();
  for (const record of list) {
    if (!record.id) continue;
    idCounts.set(record.id, (idCounts.get(record.id) || 0) + 1);
  }
  for (const record of list) {
    if (record.id && idCounts.get(record.id) === 1) calls.set(record.id, record);
  }
  return { calls, list };
}

export function buildResults(messages) {
  const results = new Map();
  const counts = new Map();
  const list = [];
  if (!Array.isArray(messages)) return results;
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const message = messages[messageIndex];
    if (!message || message.role !== "tool" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (!part || typeof part !== "object" || part.type !== "tool-result") continue;
      if (typeof part.id !== "string" || !part.id) continue;
      list.push({ id: part.id, part, messageIndex });
      counts.set(part.id, (counts.get(part.id) || 0) + 1);
    }
  }
  for (const record of list) {
    if (counts.get(record.id) === 1) results.set(record.id, { part: record.part, messageIndex: record.messageIndex });
  }
  return results;
}

export function orderKey(messageIndex, partIndex) {
  return messageIndex * 100000 + partIndex;
}

export function buildEntries(messages, context) {
  const { calls } = buildToolCalls(messages);
  const protect = createProtectMatcher(context.protectPaths, context.projectKey);
  const entries = [];
  if (!Array.isArray(messages)) return entries;
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const message = messages[messageIndex];
    if (!message || message.role !== "tool" || !Array.isArray(message.content)) continue;
    for (let partIndex = 0; partIndex < message.content.length; partIndex += 1) {
      const part = message.content[partIndex];
      if (!part || typeof part !== "object" || part.type !== "tool-result") continue;
      const call = typeof part.id === "string" ? calls.get(part.id) : null;
      const name = String(part.name || (call && call.name) || "");
      const input = call ? call.input : undefined;
      const kind = toolKind(name);
      const displayPath = firstInputPath(input);
      const text = resultText(part.result);
      /*
       * A read tool returns file text, so "Error: ..." at the top of a read is more
       * likely file content than a failed call. A real read failure is typed error.
       */
      const errorResult =
        isErrorResult(part.result) &&
        !(kind === "read" && part.result && part.result.type === "text");
      const protectedResult = Boolean(
        (context.protectSkills && isSkillCall(name, input)) ||
          (context.protectSkills && looksLikeSkillResult(part.result)) ||
          protect(input),
      );
      const pathKey = normalizePathKey(displayPath, context.projectKey);
      const collapsible = COLLAPSIBLE_TOOL_NAMES.has(name.toLowerCase());
      /* Without a unique call, include the result position so two results that
         share a malformed id are never treated as repeats of one another. */
      const fallbackKey = () =>
        `${name || "tool"}|id:${part.id || "?"}|at:${messageIndex}:${partIndex}`;
      const key = collapsible
        ? call
          ? stableToolKey(name, input)
          : fallbackKey()
        : protectedResult
          ? pathKey
            ? `protected|${name.toLowerCase() || "tool"}|${pathKey}`
            : fallbackKey()
          : "";
      const entry = {
        index: entries.length,
        messageIndex,
        partIndex,
        part,
        name,
        kind,
        input,
        displayPath,
        pathKey,
        key,
        protected: protectedResult,
        text,
        length: text.length,
        collapsed: false,
        stale: false,
        superseded: false,
        merged: false,
        compacted: false,
        budget: false,
        error: errorResult,
        stub: isStubResult(part.result),
        callOrder: call ? orderKey(call.messageIndex, call.partIndex) : orderKey(messageIndex, partIndex),
        resultOrder: orderKey(messageIndex, partIndex),
        readRange: kind === "read" && pathKey ? readRangeFor(input, text) : null,
      };
      entry.readRange = entry.readRange ? { ...entry.readRange, pathKey } : null;
      entries.push(entry);
    }
  }
  return entries;
}

/* ------------------------------------------------------------------ */
/*  Stubs, duplicate collapse, protected selection                    */
/* ------------------------------------------------------------------ */

export function duplicateStub(entry) {
  const isRead = READ_TOOL_NAMES.has(String(entry.name || "").toLowerCase());
  const label =
    isRead && entry.displayPath
      ? `read of ${oneLine(entry.displayPath, 180)}`
      : `${oneLine(entry.name || "tool", 80)} call`;
  return `${DUPLICATE_PREFIX}${label} collapsed. The newest result is later in this request; use it instead of repeating the call.]`;
}

export function staleStub(entry) {
  const where = entry.displayPath ? ` of ${oneLine(entry.displayPath, 180)}` : "";
  return `${STALE_PREFIX}${where} from before a later edit; the file changed since it was read. Reread it if the old contents still matter.]`;
}

export function supersededStub(entry) {
  const where = entry.displayPath ? `read of ${oneLine(entry.displayPath, 180)}` : "result";
  const range = entry.readRange ? ` (lines ${entry.readRange.start}–${entry.readRange.end})` : "";
  return `${SUPERSEDED_PREFIX}${where}${range}; a newer read covers this range. Use the newer read instead.]`;
}

export function budgetStub(entry) {
  const where = entry.displayPath ? `${oneLine(entry.displayPath, 160)}` : `${oneLine(entry.name || "tool", 60)}`;
  return `${BUDGET_PREFIX}removed an older ${where} result to fit the request budget. Re-run the call if it matters.]`;
}

export function replaceWithStub(entry, text) {
  if (!entry || entry.stub || entry.error) return 0;
  const before = resultTextLength(entry.part.result);
  if (text.length >= before) return 0;
  if (!setResultText(entry.part, text)) return 0;
  entry.text = text;
  entry.length = text.length;
  entry.stub = true;
  return before - text.length;
}

export function collapseDuplicateEntries(entries) {
  const groups = new Map();
  for (const entry of entries) {
    if (entry.stub || entry.error) continue;
    if (!COLLAPSIBLE_TOOL_NAMES.has(String(entry.name || "").toLowerCase())) continue;
    if (!entry.key) continue;
    const list = groups.get(entry.key);
    if (list) list.push(entry);
    else groups.set(entry.key, [entry]);
  }
  let collapsed = 0;
  let chars = 0;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const newest = list[list.length - 1];
    if (newest.error || newest.stub || newest.length < 16) continue;
    if (newest.protected && newest.length < 100) continue;
    for (const entry of list.slice(0, -1)) {
      if (entry.collapsed || entry.stub) continue;
      const saved = replaceWithStub(entry, duplicateStub(entry));
      if (saved > 0) {
        entry.collapsed = true;
        collapsed += 1;
        chars += saved;
      }
    }
  }
  return { collapsed, chars };
}

export function successfulEditCalls(messages, projectKey = "") {
  const { calls } = buildToolCalls(messages);
  const results = buildResults(messages);
  const edits = [];
  for (const call of calls.values()) {
    if (toolKind(call.name) !== "edit") continue;
    const paths = inputPaths(call.input)
      .map((path) => normalizePathKey(path, projectKey))
      .filter(Boolean);
    if (!paths.length) continue;
    const resultRecord = call.id ? results.get(call.id) : null;
    if (!resultRecord) continue;
    if (isErrorResult(resultRecord.part.result)) continue;
    for (const pathKey of Array.from(new Set(paths))) {
      edits.push({
        pathKey,
        order: orderKey(call.messageIndex, call.partIndex),
        name: call.name,
        input: call.input,
      });
    }
  }
  return edits;
}

export function invalidateStaleReads(entries, edits) {
  if (!edits.length) return { stale: 0, chars: 0 };
  const editsByPath = new Map();
  for (const edit of edits) {
    const list = editsByPath.get(edit.pathKey);
    if (list) list.push(edit.order);
    else editsByPath.set(edit.pathKey, [edit.order]);
  }
  const readsByPath = new Map();
  for (const entry of entries) {
    if (entry.kind !== "read" || entry.stub || entry.error || !entry.pathKey) continue;
    const orders = editsByPath.get(entry.pathKey);
    if (!orders) continue;
    const stale = orders.some((order) => order > entry.callOrder);
    const record = { entry, stale };
    const list = readsByPath.get(entry.pathKey);
    if (list) list.push(record);
    else readsByPath.set(entry.pathKey, [record]);
  }
  let staleCount = 0;
  let chars = 0;
  for (const [pathKey, records] of readsByPath) {
    const staleRecords = records.filter((record) => record.stale);
    if (!staleRecords.length) continue;
    const protectedStale = staleRecords.map((record) => record.entry).filter((entry) => entry.protected);
    /*
     * A skill or pinned read is the model's working copy. Keep the newest protected
     * copy unless a later read actually covers its whole range. A partial re-read
     * after an edit must not replace the only complete copy with five lines.
     */
    let keep = null;
    if (protectedStale.length) {
      const freshRanges = records
        .filter((record) => !record.stale)
        .map((record) => record.entry)
        .filter((entry) => !entry.stub && !entry.error && entry.readRange)
        .map((entry) => entry.readRange);
      const uncovered = protectedStale.filter((entry) => {
        if (!entry.readRange) return true;
        return !freshRanges.some(
          (range) =>
            range.pathKey === entry.readRange.pathKey &&
            range.start <= entry.readRange.start &&
            range.end >= entry.readRange.end,
        );
      });
      if (uncovered.length) {
        /* Prefer a full copy over a partial one, then the newest. */
        keep = uncovered.reduce((best, entry) => {
          const bestSpan = best.readRange ? best.readRange.end - best.readRange.start : -1;
          const entrySpan = entry.readRange ? entry.readRange.end - entry.readRange.start : -1;
          if (entrySpan !== bestSpan) return entrySpan > bestSpan ? entry : best;
          return entry.resultOrder > best.resultOrder ? entry : best;
        });
      }
    }
    for (const record of staleRecords) {
      const entry = record.entry;
      if (entry === keep) continue;
      const saved = replaceWithStub(entry, staleStub(entry));
      if (saved > 0) {
        entry.stale = true;
        staleCount += 1;
        chars += saved;
      }
    }
  }
  return { stale: staleCount, chars };
}

export function overlaps(intervals, start, end) {
  return intervals.filter((interval) => interval.start <= end && interval.end >= start);
}

export function fullyCovered(intervals, start, end) {
  if (!intervals.length) return false;
  let cursor = start;
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  for (const interval of sorted) {
    if (interval.end < cursor) continue;
    if (interval.start > cursor) return false;
    cursor = Math.max(cursor, interval.end + 1);
    if (cursor > end) return true;
  }
  return cursor > end;
}

export function coverageLineNumbers(text, start) {
  const explicit = lineNumberAt(text, start);
  if (explicit) return explicit;
  const lines = splitLines(text);
  return lines.map((_, index) => start + index);
}

export function latestProtectedEntries(entries) {
  const latest = new Map();
  for (const entry of entries) {
    if (entry.collapsed || entry.stub || !entry.protected || entry.error) continue;
    /* A short skill file is still the model's only copy; never require a size floor. */
    latest.set(entry.key, entry);
  }
  return latest;
}

export function latestReadEntries(entries) {
  const latest = new Map();
  const protectedPaths = new Set();
  for (const entry of entries) {
    if (entry.protected && entry.pathKey) protectedPaths.add(entry.pathKey);
  }
  for (const entry of entries) {
    if (entry.collapsed || entry.stub || entry.protected || entry.error) continue;
    if (!entry.pathKey || protectedPaths.has(entry.pathKey)) continue;
    if (entry.kind !== "read") continue;
    if (entry.length < 16) continue;
    latest.set(entry.pathKey, entry);
  }
  return latest;
}

export function keptReadIndexes(entries, context) {
  const keep = context.rules.keepRecent;
  const cutoff = Math.max(0, context.messages.length - keep);
  const latest = latestReadEntries(entries);
  const limit = context.rules.protectedReads;
  return new Set(
    Array.from(latest.values())
      .filter((entry) => entry.messageIndex < cutoff)
      .sort((a, b) => b.index - a.index)
      .slice(0, limit)
      .map((entry) => entry.index),
  );
}
