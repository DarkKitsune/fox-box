
import {
  CODE_EXTENSIONS,
  READ_TOOL_NAMES,
  RECEIPT_KEY,
  SOURCE_TEXT_EXTENSIONS,
  STOP_WORDS,
  budgetStub,
  buildEntries,
  buildResults,
  buildToolCalls,
  collapseDuplicateEntries,
  countLines,
  coverageLineNumbers,
  duplicateStub,
  firstInputPath,
  fullyCovered,
  inputPaths,
  invalidateStaleReads,
  isErrorResult,
  keptReadIndexes,
  latestProtectedEntries,
  latestReadEntries,
  measureRequest,
  normalizeContextRules,
  normalizePathKey,
  oneLine,
  orderKey,
  overlaps,
  replaceWithStub,
  resultText,
  resultTextLength,
  safeStringify,
  setResultObject,
  setResultText,
  setToolInput,
  splitLines,
  stableInputLength,
  staleStub,
  successfulEditCalls,
  supersededStub,
  toolKind,
} from "./context-core.js";

/* ------------------------------------------------------------------ */
/*  Type-aware compactors                                             */
/* ------------------------------------------------------------------ */

function alreadyCompacted(text) {
  return /^\[Fox Box: (?:test-log|stack-trace|diff|search|path-list|JSON|CSV|web|code skeleton)/.test(
    String(text || "").trimStart(),
  );
}

function finishCompaction(original, body, method, detail) {
  if (alreadyCompacted(original)) return null;
  if (typeof body !== "string" || !body.trim()) return null;
  const marker = `[Fox Box: ${method} compaction — ${detail}. Re-run or narrow the call if you need the full content.]`;
  const output = `${marker}\n${body}`;
  if (output.length >= original.length - 120) return null;
  if (output.length > original.length * 0.92) return null;
  return output;
}

function omittedLabel(count, what) {
  return `… [Fox Box: ${count} ${what}${count === 1 ? "" : "s"} omitted] …`;
}

const LOG_PASS =
  /(^|\s)(PASS|PASSED|ok\s+\d+|ok$|✓|✔|√|success|succeeded|green)(\s|$)|^\s*(?:PASS|✓|✔|√)\b/i;
const LOG_FAIL =
  /(^|\s)(FAIL|FAILED|FAILURE|ERROR|ERR!|PANIC|FATAL|EXCEPTION|ASSERTION|ASSERT|TRACEBACK|VALUEERROR|TYPEERROR|KEYERROR|RUNTIMEERROR|REFERENCEERROR|SYNTAXERROR|failing|✗|✖|×|✘)(\s|$|:)|^\s*(?:FAIL|✗|✖|×)\b/i;
const LOG_WARN = /(^|\s)(WARN|WARNING|DEPRECATED|deprecation)(\s|$|:)/i;
const LOG_SIGNAL =
  /^(?:PASS|FAIL|ok\s+\d+|not ok|--- FAIL|=== RUN|npm ERR!|BUILD |Tests?:|Test Suites?:|Ran \d+ tests?|\d+ passing|\d+ failing|\[build\]|Compiled|Successfully built|error\[|warning\[)/im;

function compactTestLog(text) {
  if (typeof text !== "string" || text.length < 800) return null;
  const lines = splitLines(text);
  if (lines.length < 12) return null;
  const visible = (line) => String(line || "").replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
  if (
    !LOG_SIGNAL.test(visible(text)) &&
    lines.filter((line) => LOG_PASS.test(visible(line)) || LOG_FAIL.test(visible(line))).length < 4
  ) {
    return null;
  }
  const keep = new Set();
  const total = lines.length;
  const add = (index) => {
    if (index >= 0 && index < total) keep.add(index);
  };
  for (let index = 0; index < Math.min(3, total); index += 1) add(index);
  let failures = 0;
  let warnings = 0;
  for (let index = 0; index < total; index += 1) {
    const line = visible(lines[index]);
    if (LOG_FAIL.test(line)) {
      failures += 1;
      for (let around = index - 2; around <= index + 2; around += 1) add(around);
    } else if (LOG_WARN.test(line)) {
      warnings += 1;
      for (let around = index - 1; around <= index + 1; around += 1) add(around);
    }
  }
  /* Summary lines are short and usually carry the real test counts. */
  for (let index = Math.max(0, total - 20); index < total; index += 1) {
    const line = visible(lines[index]);
    if (/\b(tests?|suites?|passed|failed|skipped|duration|time|warnings?|errors?|summary)\b/i.test(line)) {
      add(index);
    }
  }
  if (!failures && !warnings) {
    for (let index = Math.max(0, total - 10); index < total; index += 1) add(index);
  }
  if (keep.size >= total - 2) return null;
  const output = [];
  let omitted = 0;
  const flush = () => {
    if (omitted > 0) {
      output.push(omittedLabel(omitted, "passing log line"));
      omitted = 0;
    }
  };
  for (let index = 0; index < total; index += 1) {
    if (keep.has(index)) {
      flush();
      output.push(lines[index]);
    } else {
      omitted += 1;
    }
  }
  flush();
  const detail = `kept ${failures} failure line${failures === 1 ? "" : "s"}, ${warnings} warning line${
    warnings === 1 ? "" : "s"
  }, and the summary`;
  return finishCompaction(text, output.join("\n"), "test-log", detail);
}

const STACK_FRAME = /^\s*(?:at\s+.+?(?:\(.+?\))?|File\s+".+?",\s+line\s+\d+|#\d+\s+0x[0-9a-f]+|frame\s+#\d+)/i;
const LIBRARY_FRAME =
  /(?:node_modules|site-packages|dist-packages|\/usr\/lib|\/usr\/local\/lib|\\lib\\python|\.cargo\/registry|\/pkg\/mod\/|vendor\/|internal\/|(?:^|[\\/])runtime[\\/]|(?:^|[\\/])stdlib[\\/]|<anonymous>|bun:wrap|node:internal)/i;

function compactStackTrace(text) {
  if (typeof text !== "string" || text.length < 700) return null;
  const lines = splitLines(text);
  if (lines.length < 6) return null;
  const frameIndexes = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (STACK_FRAME.test(lines[index])) frameIndexes.push(index);
  }
  if (frameIndexes.length < 2) return null;
  const projectFrames = frameIndexes.filter((index) => !LIBRARY_FRAME.test(lines[index]));
  const nonFrames = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!STACK_FRAME.test(lines[index]) && lines[index].trim()) nonFrames.push(index);
  }
  const keep = new Set();
  const total = lines.length;
  const add = (index) => {
    if (index >= 0 && index < total) keep.add(index);
  };
  /* Exception type, message, "caused by", and the final lines explain the failure. */
  for (const index of nonFrames.slice(-8)) add(index);
  for (const index of nonFrames.slice(0, 3)) add(index);
  for (const index of nonFrames) {
    if (/\b(?:error|exception|panic|fatal|caused by|assert(?:ion)?)\b/i.test(lines[index])) add(index);
  }
  if (projectFrames.length) {
    for (const index of projectFrames) add(index);
  } else {
    for (const index of frameIndexes.slice(0, 6)) add(index);
    for (const index of frameIndexes.slice(-6)) add(index);
  }
  if (keep.size >= total - 2) return null;
  const output = [];
  let libraryRun = 0;
  const flush = () => {
    if (libraryRun > 0) {
      output.push(omittedLabel(libraryRun, "library frame"));
      libraryRun = 0;
    }
  };
  for (let index = 0; index < total; index += 1) {
    if (keep.has(index)) {
      flush();
      output.push(lines[index]);
    } else if (STACK_FRAME.test(lines[index]) && LIBRARY_FRAME.test(lines[index])) {
      libraryRun += 1;
    } else {
      flush();
    }
  }
  flush();
  const hidden = frameIndexes.length - projectFrames.length;
  const detail = `kept ${projectFrames.length} project frame${projectFrames.length === 1 ? "" : "s"} and collapsed ${
    hidden > 0 ? hidden : "the library"
  } library frame${hidden === 1 ? "" : "s"}`;
  return finishCompaction(text, output.join("\n"), "stack-trace", detail);
}

function compactDiff(text) {
  if (typeof text !== "string" || text.length < 700) return null;
  if (!/^@@ .* @@/m.test(text)) return null;
  const lines = splitLines(text);
  if (lines.length < 12) return null;
  const output = [];
  let contextRun = 0;
  let changed = 0;
  let hunks = 0;
  const flush = () => {
    if (contextRun > 0) {
      output.push(omittedLabel(contextRun, "diff context line"));
      contextRun = 0;
    }
  };
  for (const line of lines) {
    if (/^(?:diff --git|index |new file mode|deleted file mode|--- |\+\+\+ |@@ |\\ No newline)/.test(line)) {
      flush();
      output.push(line);
      if (line.startsWith("@@")) hunks += 1;
      continue;
    }
    if (line.startsWith("+") || line.startsWith("-")) {
      flush();
      output.push(line);
      changed += 1;
      continue;
    }
    if (line.startsWith(" ") || line === "") {
      contextRun += 1;
      continue;
    }
    flush();
    output.push(line);
  }
  flush();
  if (!changed || output.length >= lines.length - 2) return null;
  return finishCompaction(
    text,
    output.join("\n"),
    "diff",
    `kept ${changed} changed line${changed === 1 ? "" : "s"} and ${hunks} hunk header${hunks === 1 ? "" : "s"}`,
  );
}

function compactSearchResults(text, kind, path = "") {
  if (typeof text !== "string" || text.length < 700) return null;
  if (kind === "read" && (CODE_EXTENSIONS.test(String(path || "")) || SOURCE_TEXT_EXTENSIONS.test(String(path || "")))) {
    return null;
  }
  const lines = splitLines(text).filter((line, index, all) => line.trim() || index < all.length - 1);
  if (lines.length < 6) return null;
  const grepLines = lines.filter((line) => /^[^\n:]{1,320}:\d+(?::\d+)?[: -]/.test(line));
  if (grepLines.length >= 6) {
    const groups = new Map();
    for (const line of grepLines) {
      const match = /^([^\n:]{1,320}):(\d+)(?::\d+)?[: -]/.exec(line);
      if (!match) continue;
      const file = match[1];
      const list = groups.get(file) || [];
      list.push(line);
      groups.set(file, list);
    }
    if (groups.size) {
      const output = [];
      let shown = 0;
      let totalMatches = 0;
      const files = Array.from(groups.entries()).slice(0, 12);
      for (const [file, matches] of files) {
        totalMatches += matches.length;
        output.push(`${file} (${matches.length} match${matches.length === 1 ? "" : "es"})`);
        for (const line of matches.slice(0, 3)) {
          output.push(line);
          shown += 1;
        }
        if (matches.length > 3) output.push(`  … ${matches.length - 3} more in this file`);
      }
      if (grepLines.length > shown) {
        output.push(`… [Fox Box: ${grepLines.length - shown} matching line(s) not shown] …`);
      }
      return finishCompaction(
        text,
        output.join("\n"),
        "search",
        `${grepLines.length} match${grepLines.length === 1 ? "" : "es"} in ${groups.size} file${
          groups.size === 1 ? "" : "s"
        }, grouped with representative lines`,
      );
    }
  }
  const pathLines = lines.filter(
    (line) => line.trim().length > 1 && line.length < 320 && /[\\/]/.test(line) && !/^[A-Za-z]:$/.test(line),
  );
  if (kind === "search" && pathLines.length >= 10) {
    const groups = new Map();
    for (const line of pathLines) {
      const clean = line.trim().replace(/\\/g, "/");
      const slash = clean.lastIndexOf("/");
      const dir = slash > 0 ? clean.slice(0, slash) : ".";
      const list = groups.get(dir) || [];
      list.push(clean);
      groups.set(dir, list);
    }
    const output = [];
    let shown = 0;
    const groupsList = Array.from(groups.entries()).slice(0, 14);
    for (const [dir, paths] of groupsList) {
      output.push(`${dir}/ (${paths.length} file${paths.length === 1 ? "" : "s"})`);
      for (const path of paths.slice(0, 2)) {
        output.push(`  ${path}`);
        shown += 1;
      }
      if (paths.length > 2) output.push(`  … ${paths.length - 2} more`);
    }
    if (pathLines.length > shown) {
      output.push(`… [Fox Box: ${pathLines.length - shown} path(s) not shown] …`);
    }
    return finishCompaction(
      text,
      output.join("\n"),
      "path-list",
      `${pathLines.length} paths grouped into ${groups.size} director${groups.size === 1 ? "y" : "ies"}`,
    );
  }
  return null;
}

function jsonBrief(value, depth = 0) {
  if (value === null) return null;
  if (typeof value === "string") return value.length > 160 ? `${value.slice(0, 160)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 3) return Array.isArray(value) ? `[${value.length} items]` : "{…}";
  if (Array.isArray(value)) {
    return {
      items: value.length,
      first: value.length ? jsonBrief(value[0], depth + 1) : null,
      last: value.length > 1 ? jsonBrief(value[value.length - 1], depth + 1) : undefined,
    };
  }
  if (typeof value === "object") {
    const keys = Object.keys(value).slice(0, 24);
    const sample = {};
    for (const key of keys) sample[key] = jsonBrief(value[key], depth + 1);
    return { keys: Object.keys(value).length, sample };
  }
  return String(value);
}

function parseJson(value, text) {
  if (value !== undefined && value !== null) {
    if (typeof value === "string") {
      try {
        return { ok: true, value: JSON.parse(value) };
      } catch {
        return { ok: false };
      }
    }
    return { ok: true, value };
  }
  const trimmed = String(text || "").replace(/^\uFEFF/, "").trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    return { ok: false };
  }
}

function compactJson(text, value) {
  if (typeof text !== "string" || text.length < 900) return null;
  const parsed = parseJson(value, text);
  if (!parsed.ok) return null;
  let brief;
  try {
    brief = jsonBrief(parsed.value, 0);
  } catch {
    return null;
  }
  const summary = {
    __foxBox: "JSON compacted for an older tool result",
    originalChars: text.length,
    shape: Array.isArray(parsed.value) ? "array" : parsed.value === null ? "null" : typeof parsed.value,
    summary: brief,
  };
  const output = safeStringify(summary);
  if (output.length > 6000) return null;
  return finishCompaction(text, output, "JSON", "kept the shape, counts, keys, and first/last items");
}

function compactCsv(text, kind = "", path = "") {
  if (typeof text !== "string" || text.length < 700) return null;
  /* A source, doc or markup read can contain separators on every line; do not mistake it for a table. */
  if (kind === "read" && (CODE_EXTENSIONS.test(String(path || "")) || SOURCE_TEXT_EXTENSIONS.test(String(path || "")))) {
    return null;
  }
  const lines = splitLines(text).filter((line) => line.trim());
  if (lines.length < 6) return null;
  let delimiter = ",";
  let best = 0;
  for (const candidate of [",", "\t", ";", "|"]) {
    const count = (lines[0].match(new RegExp(candidate === "|" ? "\\|" : candidate, "g")) || []).length;
    if (count > best) {
      best = count;
      delimiter = candidate;
    }
  }
  if (best < 1) return null;
  const split = (line) =>
    line
      .split(delimiter)
      .map((cell) => cell.trim().replace(/^"|"$/g, ""))
      .slice(0, 80);
  const header = split(lines[0]);
  if (header.length < 2) return null;
  const body = lines.slice(1);
  const matching = body.filter((line) => split(line).length === header.length).length;
  if (matching < Math.max(4, Math.ceil(body.length * 0.6))) return null;
  const keep = [lines[0]];
  for (const line of body.slice(0, 3)) keep.push(line);
  if (body.length > 6) {
    keep.push(`… [Fox Box: ${body.length - 5} CSV row(s) omitted] …`);
    for (const line of body.slice(-2)) keep.push(line);
  } else {
    for (const line of body.slice(3)) keep.push(line);
  }
  return finishCompaction(
    text,
    keep.join("\n"),
    "CSV",
    `${lines.length} rows × ${header.length} columns; kept the header, first and last rows`,
  );
}

function decodeEntities(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d{1,6});/g, (match, code) => {
      const number = Number(code);
      return Number.isFinite(number) && number > 0 && number < 0x110000 ? String.fromCodePoint(number) : match;
    });
}

function stripTags(html) {
  return decodeEntities(
    String(html || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|li|tr|h[1-6]|section|article)>/gi, "\n")
      .replace(/<[^>]{0,500}>/g, " "),
  )
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function compactHtml(text, kind, path = "") {
  if (typeof text !== "string" || text.length < 900) return null;
  /*
   * A read of markup or prose is source, not a fetched page to strip. Only an
   * actual web tool result (or a shell result with page structure) is compacted.
   */
  if (
    kind === "read" &&
    (CODE_EXTENSIONS.test(String(path || "")) || SOURCE_TEXT_EXTENSIONS.test(String(path || "")))
  ) {
    return null;
  }
  const looksHtml = /<(?:html|body|div|p|h[1-6]|article|main|section|table)\b/i.test(text);
  if (!looksHtml) return null;
  if (kind !== "web" && !/<\/?(?:html|body|div|p|article|main|section)\b/i.test(text)) return null;
  const source = text.length > 700000 ? text.slice(0, 700000) : text;
  const titleMatch = /<title[^>]*>([\s\S]{0,400}?)<\/title>/i.exec(source);
  const headings = [];
  const blocks = [];
  const headingPattern = /<h([1-3])[^>]*>([\s\S]{0,800}?)<\/h\1>/gi;
  let match;
  let guard = 0;
  while ((match = headingPattern.exec(source)) && guard < 60) {
    guard += 1;
    const heading = stripTags(match[2]);
    if (heading) headings.push(`${"#".repeat(Number(match[1]))} ${heading.slice(0, 240)}`);
  }
  const blockPattern = /<(?:p|li|td|blockquote|pre|code)[^>]*>([\s\S]{0,1600}?)<\/(?:p|li|td|blockquote|pre|code)>/gi;
  guard = 0;
  while ((match = blockPattern.exec(source)) && guard < 140) {
    guard += 1;
    const block = stripTags(match[1]);
    if (block.length >= 40) blocks.push(block.slice(0, 500));
  }
  const cleaned = source
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|canvas|nav|footer|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(script|style|noscript|svg|canvas|nav|footer|form)\b[^>]*>/gi, " ");
  let body = "";
  if (headings.length || blocks.length) {
    body = [...headings, ...blocks].join("\n\n");
  }
  if (!body.trim()) body = stripTags(cleaned);
  if (!body.trim()) return null;
  if (body.length > 7000) body = `${body.slice(0, 7000)}\n… [Fox Box: remaining page text omitted] …`;
  const prefix = titleMatch ? `Title: ${stripTags(titleMatch[1]).slice(0, 300)}\n\n` : "";
  return finishCompaction(
    text,
    `${prefix}${body}`,
    "web",
    `kept ${titleMatch ? "the title, " : ""}${headings.length} heading(s), and ${blocks.length} text block(s); removed markup and navigation`,
  );
}

function codeLangFromPath(path) {
  const extension = String(path || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return extension ? extension[1] : "";
}

function codeSkeleton(text, path) {
  if (typeof text !== "string" || text.length < 6000) return null;
  if (!CODE_EXTENSIONS.test(String(path || ""))) return null;
  const lines = splitLines(text);
  if (lines.length < 70) return null;
  const keep = new Set();
  const total = lines.length;
  const add = (index) => {
    if (index >= 0 && index < total) keep.add(index);
  };
  for (let index = 0; index < Math.min(10, total); index += 1) add(index);
  const importPattern =
    /^\s*(?:import\b|from\s+\S+\s+import\b|export\s+.*\sfrom\b|use\b|using\b|require\s*\(|package\b|namespace\b|module\b|#include\b|@import\b)/;
  const declarationPattern =
    /^\s*(?:export\s+)?(?:default\s+)?(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:fn|def|class|struct|enum|interface|type|trait|impl|func|function|record|object|protocol|macro_rules!|mod|module|namespace|package|const|let|var|static|final|public|private|protected|internal|abstract|sealed|readonly|data\s+\w+\s*=|val\s+\w+|@[A-Za-z_]\w*)/;
  let declarations = 0;
  for (let index = 0; index < total; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    const withoutNumber = line.replace(/^\s*\d{1,9}[\t:| ]/, "");
    const trimmed = withoutNumber.trim();
    const indent = (withoutNumber.match(/^\s*/) || [""])[0].length;
    if (importPattern.test(trimmed)) {
      add(index);
      continue;
    }
    if (declarationPattern.test(trimmed)) {
      const isBodyLocal = /^(?:const|let|var|static|return|if|for|while|switch|case|break|continue|throw|await|yield)\b/.test(
        trimmed,
      );
      /* Local `const`/`let`/`var` lines are bodies, not API surface. Keep only a
         top-level one; class fields and methods with access modifiers still count. */
      if (!isBodyLocal || indent === 0) {
        add(index);
        declarations += 1;
        /* Keep a doc comment or attribute directly above the declaration. */
        for (let above = index - 1; above >= Math.max(0, index - 2); above -= 1) {
          if (/^\s*(?:\/\/|\/\*|\*|#|--|"""|''')/.test(lines[above])) add(above);
        }
      }
    }
  }
  if (declarations < 3 || keep.size < 8 || keep.size >= total - 3) return null;
  const output = [];
  let omitted = 0;
  const flush = () => {
    if (omitted > 0) {
      output.push(omittedLabel(omitted, "code body line"));
      omitted = 0;
    }
  };
  for (let index = 0; index < total; index += 1) {
    if (keep.has(index)) {
      flush();
      output.push(lines[index]);
    } else {
      omitted += 1;
    }
  }
  flush();
  return finishCompaction(
    text,
    output.join("\n"),
    `code skeleton (${codeLangFromPath(path) || "source"})`,
    `kept imports, top-level declarations, and ${declarations} signature(s); elided function bodies`,
  );
}

/* ------------------------------------------------------------------ */
/*  Read overlap merging                                              */
/* ------------------------------------------------------------------ */

function mergeCoveredLines(entry, intervals) {
  if (!entry.readRange) return 0;
  const text = resultText(entry.part.result);
  if (!text || !text.includes("\n")) return 0;
  const numbers = coverageLineNumbers(text, entry.readRange.start);
  const lines = splitLines(text);
  if (lines.length !== numbers.length) return 0;
  const output = [];
  let removed = 0;
  let runStart = 0;
  let runEnd = 0;
  const flush = () => {
    if (!runStart) return;
    const label =
      runStart === runEnd
        ? `… [Fox Box: line ${runStart} already shown by a newer read] …`
        : `… [Fox Box: lines ${runStart}–${runEnd} already shown by a newer read] …`;
    output.push(label);
    runStart = 0;
    runEnd = 0;
  };
  for (let index = 0; index < lines.length; index += 1) {
    const number = numbers[index];
    const covered = intervals.some((interval) => number >= interval.start && number <= interval.end);
    if (covered) {
      removed += 1;
      if (!runStart) runStart = number;
      runEnd = number;
      continue;
    }
    flush();
    output.push(lines[index]);
  }
  flush();
  if (!removed || removed === lines.length) return 0;
  const merged = output.join("\n");
  if (merged.length >= text.length - 80) return 0;
  if (!setResultText(entry.part, merged)) return 0;
  const saved = text.length - merged.length;
  entry.text = merged;
  entry.length = merged.length;
  entry.merged = true;
  entry.superseded = true;
  return saved;
}

function supersedeReads(entries, context) {
  if (!context.rules.pathSupersession) return { superseded: 0, merged: 0, chars: 0 };
  const keep = context.rules.keepRecent;
  const cutoff = Math.max(0, context.messages.length - keep);
  const protectedLatest = latestProtectedEntries(entries);
  const reliable = (entry) => {
    if (entry.stub || entry.error || entry.kind !== "read" || !entry.readRange) return false;
    if (protectedLatest.get(entry.key) === entry) return true;
    if (entry.messageIndex < cutoff) return false;
    return entry.length <= context.rules.maxToolOutput;
  };
  const ordered = entries
    .filter((entry) => entry.kind === "read" && entry.readRange && !entry.stub && !entry.error)
    .sort((a, b) => b.resultOrder - a.resultOrder);
  const coverage = new Map();
  let superseded = 0;
  let merged = 0;
  let chars = 0;
  for (const entry of ordered) {
    const range = entry.readRange;
    const intervals = coverage.get(range.pathKey) || [];
    const singleCover =
      entry.protected &&
      intervals.some((interval) => interval.start <= range.start && interval.end >= range.end);
    if (fullyCovered(intervals, range.start, range.end) && (!entry.protected || singleCover)) {
      const saved = replaceWithStub(entry, supersededStub(entry));
      if (saved > 0) {
        entry.superseded = true;
        superseded += 1;
        chars += saved;
        continue;
      }
    } else if (context.rules.mergeReadRanges && !entry.protected) {
      /* A protected skill/pinned copy is all-or-nothing: partial overlap keeps it
         whole so a five-line re-read cannot erase the rest of the file. */
      const hit = overlaps(intervals, range.start, range.end);
      if (hit.length) {
        const saved = mergeCoveredLines(entry, hit);
        if (saved > 0) {
          merged += 1;
          chars += saved;
        }
      }
    }
    if (reliable(entry)) {
      const list = coverage.get(range.pathKey) || [];
      list.push({ start: range.start, end: range.end });
      coverage.set(range.pathKey, list);
    }
  }
  return { superseded, merged, chars };
}

/* ------------------------------------------------------------------ */
/*  Relevance scoring                                                 */
/* ------------------------------------------------------------------ */

function messageText(message) {
  if (!message || typeof message !== "object") return "";
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  const chunks = [];
  for (const part of message.content) {
    if (!part || typeof part !== "object") continue;
    if (part.type === "text" && typeof part.text === "string") chunks.push(part.text);
    else if (part.type === "tool-call" && part.input !== undefined) {
      const text = typeof part.input === "string" ? part.input : safeStringify(part.input);
      if (text.length < 4000) chunks.push(text);
    }
  }
  return chunks.join("\n");
}

export function buildRelevance(messages, projectKey = "") {
  const paths = new Set();
  const terms = new Set();
  const errors = new Set();
  if (!Array.isArray(messages)) return { paths, terms, errors };
  const texts = [];
  let userIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index] && messages[index].role === "user") {
      userIndex = index;
      break;
    }
  }
  if (userIndex >= 0) texts.push(messageText(messages[userIndex]));
  let assistantSeen = 0;
  for (let index = messages.length - 1; index >= 0 && assistantSeen < 4; index -= 1) {
    if (!messages[index] || messages[index].role !== "assistant") continue;
    texts.push(messageText(messages[index]));
    assistantSeen += 1;
  }
  const all = texts.join("\n").slice(0, 40000);
  const pathPattern = /(?:[A-Za-z]:)?[A-Za-z0-9_@./\\-]{1,300}\.[A-Za-z0-9]{1,10}\b/g;
  let match;
  let guard = 0;
  while ((match = pathPattern.exec(all)) && guard < 200) {
    guard += 1;
    const value = match[0].replace(/\\/g, "/");
    if (value.length >= 3) paths.add(normalizePathKey(value, projectKey));
  }
  const wordPattern = /[A-Za-z_][A-Za-z0-9_]{2,}/g;
  guard = 0;
  while ((match = wordPattern.exec(all)) && guard < 250) {
    guard += 1;
    const word = match[0].toLowerCase();
    if (!STOP_WORDS.has(word) && word.length >= 3) terms.add(word);
  }
  const errorPattern = /(?:error|exception|failed|failure|panic|cannot|undefined|not found)[^\n]{0,140}/gi;
  guard = 0;
  while ((match = errorPattern.exec(all)) && guard < 60) {
    guard += 1;
    errors.add(match[0].toLowerCase().slice(0, 180));
  }
  return { paths, terms, errors };
}

function scoreEntry(entry, relevance, cutoff) {
  let score = 0;
  if (entry.messageIndex >= cutoff) score += 2;
  if (entry.error) score += 4;
  if (entry.kind === "read") score += 1;
  if (entry.pathKey) {
    if (relevance.paths.has(entry.pathKey)) score += 10;
    else {
      const base = entry.pathKey.split("/").pop();
      if (base && Array.from(relevance.paths).some((path) => path === base || path.endsWith(`/${base}`))) {
        score += 5;
      }
    }
  }
  const text = (entry.text || "").slice(0, 12000).toLowerCase();
  if (text) {
    let hits = 0;
    for (const term of relevance.terms) {
      if (hits >= 8) break;
      if (text.includes(term)) hits += 1;
    }
    score += hits * 0.75;
    for (const error of relevance.errors) {
      if (error && text.includes(error.slice(0, 60))) {
        score += 3;
        break;
      }
    }
  }
  return score;
}

/* ------------------------------------------------------------------ */
/*  Size trimming                                                     */
/* ------------------------------------------------------------------ */

function trimReadText(text, max, reason, meta) {
  const totalLines = countLines(text);
  if (totalLines < 3) return null;
  const rawOffset = Number(
    (meta && meta.range && meta.range.start) ??
      (meta && meta.input && (meta.input.offset ?? meta.input.startLine ?? meta.input.start)),
  );
  const startLine = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.round(rawOffset) : 1;
  const rangeEnd = Number(meta && meta.range && meta.range.end);
  const endLine =
    Number.isFinite(rangeEnd) && rangeEnd >= startLine ? Math.round(rangeEnd) : startLine + totalLines - 1;
  const path = firstInputPath(meta && meta.input);
  const where = path ? ` from ${oneLine(path, 120)}` : "";
  const kind =
    reason === "old"
      ? "older read"
      : reason === "kept"
        ? "latest read"
        : reason === "budget"
          ? "budget-trimmed read"
          : "fresh result";
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
    const headLines = countLines(text.slice(0, headCut));
    const tailLines = countLines(text.slice(tailStart));
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
  return attempt(0.62, 0.24) ?? attempt(0.56, 0.2) ?? null;
}

export function trimText(text, max, reason, meta) {
  if (typeof text !== "string" || text.length <= max) return { text, saved: 0 };
  if (meta && meta.lineAware !== false && READ_TOOL_NAMES.has(String(meta.tool || "").toLowerCase())) {
    const readTrimmed = trimReadText(text, max, reason, meta);
    if (readTrimmed) return readTrimmed;
  }
  const kind =
    reason === "fresh"
      ? "fresh result"
      : reason === "kept"
        ? "latest read"
        : reason === "budget"
          ? "budget-trimmed result"
          : "old result";
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
    const kind =
      reason === "fresh"
        ? "fresh result"
        : reason === "kept"
          ? "latest read"
          : reason === "budget"
            ? "budget-trimmed result"
            : "old result";
    const marker = `[Fox Box: later text in this ${kind} was trimmed]`;
    let budget = Math.max(0, max - marker.length);
    let dropped = false;
    const value = [];
    for (const part of result.value) {
      if (!part || part.type !== "text" || typeof part.text !== "string") {
        value.push(part);
        continue;
      }
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
    const replacement = { ...result, value };
    /* Measure through the same reader the ledger uses: content text parts are
       joined with newlines, so summing part lengths alone can misstate the delta. */
    const saved = Math.max(0, resultTextLength(result) - resultTextLength(replacement));
    if (saved > 0) return { result: replacement, saved };
  }
  if (result.type === "json") {
    /*
     * Structured results are common from MCP and lookup tools. They cannot be
     * cut into valid JSON, so an oversized one becomes trimmed text.
     */
    const text = resultText(result);
    const trimmed = trimText(text, max, reason, meta ? { ...meta, lineAware: false } : meta);
    if (trimmed.saved > 0) return { result: { type: "text", value: trimmed.text }, saved: trimmed.saved };
    return { result, saved: 0 };
  }
  if (result.type === "error") {
    /* Keep the error type and its leading lines; only shorten an oversized one. */
    const text = resultText(result);
    const trimmed = trimText(text, max, reason, meta ? { ...meta, lineAware: false } : meta);
    if (trimmed.saved > 0) return { result: { ...result, value: trimmed.text }, saved: trimmed.saved };
    return { result, saved: 0 };
  }
  return { result, saved: 0 };
}

/* ------------------------------------------------------------------ */
/*  Historical write/edit receipts                                    */
/* ------------------------------------------------------------------ */

function fnv1a(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function countAddedRemoved(input) {
  let added = 0;
  let removed = 0;
  let hunks = 0;
  const seen = new WeakSet();
  const visit = (value) => {
    if (value && typeof value === "object") {
      if (seen.has(value)) return;
      seen.add(value);
    }
    if (typeof value === "string") {
      if (!value) return;
      if (/^@@ .* @@/m.test(value)) {
        hunks += (value.match(/^@@ .* @@/gm) || []).length;
        for (const line of value.split(/\r?\n/)) {
          if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
          else if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
        }
        return;
      }
      added += countLines(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const key of ["content", "newString", "newText", "new_string", "text", "after", "replacement", "insert"]) {
      if (typeof value[key] === "string" && value[key]) {
        added += countLines(value[key]);
        hunks += 1;
      }
    }
    for (const key of ["patch", "diff", "patchText", "diffText"]) {
      if (typeof value[key] === "string" && value[key]) visit(value[key]);
    }
    for (const key of ["oldString", "oldText", "old_string", "before", "removed", "delete"]) {
      if (typeof value[key] === "string" && value[key]) {
        removed += countLines(value[key]);
      }
    }
    for (const key of ["edits", "changes"]) {
      if (Array.isArray(value[key])) {
        for (const item of value[key]) visit(item);
      }
    }
    for (const key of ["hunks", "patches"]) {
      if (Array.isArray(value[key])) {
        hunks += value[key].length;
        for (const item of value[key]) visit(item);
      }
    }
  };
  visit(input);
  return { added, removed, hunks: Math.max(hunks, added || removed ? 1 : 0) };
}

function editReceipt(call, input, path) {
  const stats = countAddedRemoved(input);
  const hash = fnv1a(safeStringify(input));
  return {
    [RECEIPT_KEY]: "historical edit input compacted before sending",
    tool: oneLine(call.name || "edit", 40),
    path: path ? oneLine(path, 300) : undefined,
    change: `+${stats.added} -${stats.removed}`,
    hunks: stats.hunks,
    hash,
    note: "The full edit payload was removed from the outgoing request. The file on disk is the source of truth.",
  };
}

function applyEditReceipts(entries, calls, results, context) {
  if (!context.rules.editReceipts) return { receipts: 0, chars: 0 };
  const candidates = [];
  for (const call of calls.values()) {
    if (toolKind(call.name) !== "edit") continue;
    const result = call.id ? results.get(call.id) : null;
    if (!result) continue;
    if (isErrorResult(result.part.result)) continue;
    const paths = inputPaths(call.input);
    const path = paths.length ? paths[0] : "";
    if (!path) continue;
    candidates.push({
      call,
      path,
      pathKey: normalizePathKey(path, context.projectKey),
      order: orderKey(call.messageIndex, call.partIndex),
    });
  }
  if (!candidates.length) return { receipts: 0, chars: 0 };
  candidates.sort((a, b) => a.order - b.order);
  const latest = new Map();
  for (const candidate of candidates) latest.set(candidate.pathKey, candidate);
  let receipts = 0;
  let chars = 0;
  for (const candidate of candidates) {
    if (latest.get(candidate.pathKey) === candidate) continue;
    const before = stableInputLength(candidate.call.input);
    if (before < context.rules.receiptMinChars) continue;
    const receipt = editReceipt(candidate.call, candidate.call.input, candidate.path);
    const after = stableInputLength(receipt);
    if (after >= before - 100) continue;
    if (!setToolInput(candidate.call.part, receipt)) continue;
    receipts += 1;
    chars += before - after;
  }
  return { receipts, chars };
}

/* ------------------------------------------------------------------ */
/*  Whole-request budget                                              */
/* ------------------------------------------------------------------ */

function evictionPriority(entry, cutoff, protectedLatest, keptReads, relevance) {
  if (entry.stub || entry.error) return 999;
  if (protectedLatest.get(entry.key) === entry) return 999;
  if (entry.messageIndex >= cutoff) return 70;
  if (entry.kind === "shell" && !/fail|error|exception|panic|warning/i.test(entry.text.slice(-3000))) return 8;
  if (entry.kind === "search") return 12;
  if (entry.kind === "web") return 22;
  if (entry.kind === "structured") return 26;
  if (entry.kind === "read") {
    if (keptReads.has(entry.index)) return 44;
    return relevance.paths.has(entry.pathKey) ? 36 : 24;
  }
  return 32;
}

function applyBudget(entries, context, protectedLatest, keptReads) {
  const budgetTokens = context.rules.budgetTokens;
  if (!budgetTokens) return { evicted: 0, chars: 0, over: 0 };
  const budgetChars = Math.floor(budgetTokens * context.rules.charsPerToken);
  if (budgetChars < 1000) return { evicted: 0, chars: 0, over: 0 };
  const measure = safeMeasure(context.messages, context.system, context.tools, {
    tokensPerChar: 1 / context.rules.charsPerToken,
  });
  let deficit = measure.chars - budgetChars;
  if (deficit <= 0) return { evicted: 0, chars: 0, over: 0 };
  const relevance = context.rules.relevanceScoring
    ? buildRelevance(context.messages, context.projectKey)
    : { paths: new Set(), terms: new Set(), errors: new Set() };
  const candidates = entries
    .filter((entry) => !entry.stub && entry.length > 60)
    .filter((entry) => protectedLatest.get(entry.key) !== entry)
    .filter((entry) => entry.messageIndex < context.messages.length - 2)
    .map((entry) => ({
      entry,
      priority: evictionPriority(entry, context.cutoff, protectedLatest, keptReads, relevance),
      score: context.rules.relevanceScoring ? scoreEntry(entry, relevance, context.cutoff) : 0,
      age: -entry.resultOrder,
    }))
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      if (a.score !== b.score) return a.score - b.score;
      return a.age - b.age;
    });
  let evicted = 0;
  let chars = 0;
  for (const candidate of candidates) {
    if (deficit <= 0) break;
    const entry = candidate.entry;
    if (entry.stub) continue;
    const before = resultTextLength(entry.part.result);
    if (before <= 0) continue;
    const active = candidate.priority >= 40;
    let saved = 0;
    if (active) {
      const keepChars = candidate.priority >= 70 ? 1200 : 700;
      const trimmed = trimResult(entry.part.result, Math.min(before - 1, keepChars), "budget", {
        tool: entry.name,
        input: entry.input,
        range: entry.readRange,
        lineAware: !entry.compacted && !entry.merged,
      });
      if (trimmed.saved > 0 && setResultObject(entry.part, trimmed.result)) {
        entry.text = resultText(entry.part.result);
        entry.length = entry.text.length;
        saved = trimmed.saved;
      }
    }
    /*
     * An unresolved error is information the model may still need, so the
     * budget shortens a long one but never replaces it with a stub.
     */
    if (saved <= 0) {
      if (entry.error) continue;
      saved = replaceWithStub(entry, budgetStub(entry));
    }
    if (saved > 0) {
      entry.budget = true;
      evicted += 1;
      chars += saved;
      deficit -= saved;
    }
  }
  /*
   * If trimming the active copies was not enough, fall back to a short pointer.
   * The newest two messages and every protected copy remain off limits, so this
   * cannot remove the user's latest turn or the only skill file.
   */
  if (deficit > 0) {
    for (const candidate of candidates) {
      if (deficit <= 0) break;
      const entry = candidate.entry;
      if (entry.stub || entry.error) continue;
      if (entry.messageIndex >= context.messages.length - 2) continue;      const saved = replaceWithStub(entry, budgetStub(entry));
      if (saved > 0) {
        entry.budget = true;
        evicted += 1;
        chars += saved;
        deficit -= saved;
      }
    }
  }
  return { evicted, chars, over: Math.max(0, deficit) };
}

/* ------------------------------------------------------------------ */
/*  Pipeline                                                          */
/* ------------------------------------------------------------------ */

function zeroMeasure() {
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

function safeMeasure(messages, system, tools, options) {
  try {
    return measureRequest(messages, system, tools, options);
  } catch {
    return zeroMeasure();
  }
}

function emptyOutcome() {
  return {
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
}

export function pruneContext(event, options = {}) {
  const outcome = emptyOutcome();
  if (!event || !Array.isArray(event.messages)) return outcome;
  const context = {
    rules: normalizeContextRules(options.rules || options),
    projectKey: String(options.projectKey || ""),
    messages: event.messages,
    system: event.system,
    tools: event.tools,
    cutoff: 0,
  };
  context.protectSkills = context.rules.protectSkills;
  context.protectPaths = context.rules.protectPaths;
  const rules = context.rules;
  const before = safeMeasure(context.messages, context.system, context.tools, {
    tokensPerChar: 1 / rules.charsPerToken,
  });
  const runStage = (stage, fallback) => {
    try {
      return stage();
    } catch (error) {
      outcome.errors += 1;
      if (typeof process !== "undefined" && process.env && process.env.FOXBOX_DEBUG) {
        outcome.lastError = String((error && error.stack) || error);
      }
      return fallback;
    }
  };

  const allStagesOff =
    !rules.collapseDuplicates &&
    !rules.trimToolOutput &&
    !rules.pathSupersession &&
    !rules.staleReads &&
    !rules.editReceipts &&
    !rules.smartCompaction &&
    !rules.budgetTokens;
  if (allStagesOff) {
    return { ...outcome, before, after: before, noop: true };
  }

  const { calls, list } = runStage(() => buildToolCalls(context.messages), { calls: new Map(), list: [] });
  const results = runStage(() => buildResults(context.messages), new Map());
  const entries = runStage(() => buildEntries(context.messages, context), []);
  context.cutoff = Math.max(0, context.messages.length - rules.keepRecent);

  if (rules.collapseDuplicates) {
    const collapse = runStage(() => collapseDuplicateEntries(entries), { collapsed: 0, chars: 0 });
    outcome.collapsed = collapse.collapsed;
    outcome.collapsedChars = collapse.chars;
  }

  if (rules.staleReads) {
    const edits = runStage(() => successfulEditCalls(context.messages, context.projectKey), []);
    const stale = runStage(() => invalidateStaleReads(entries, edits), { stale: 0, chars: 0 });
    outcome.stale = stale.stale;
    outcome.staleChars = stale.chars;
  }

  if (rules.pathSupersession) {
    const supersede = runStage(() => supersedeReads(entries, context), { superseded: 0, merged: 0, chars: 0 });
    outcome.superseded = supersede.superseded;
    outcome.merged = supersede.merged;
    outcome.supersededChars = supersede.chars;
  }

  let protectedLatest = runStage(() => latestProtectedEntries(entries), new Map());
  let keptReads = runStage(() => keptReadIndexes(entries, context), new Set());

  if (rules.smartCompaction) {
    for (const entry of entries) {
      if (entry.stub || entry.error) continue;
      if (entry.messageIndex >= context.cutoff) continue;
      if (protectedLatest.get(entry.key) === entry) continue;
      if (keptReads.has(entry.index)) continue;
      if (entry.length < 900) continue;
      let output = null;
      const path = entry.pathKey || entry.displayPath;
      const codeRead = entry.kind === "read" && CODE_EXTENSIONS.test(String(path || ""));
      try {
        output =
          compactJson(entry.text, undefined) ||
          (!codeRead ? compactHtml(entry.text, entry.kind, path) : null) ||
          (!codeRead && (entry.kind === "search" || entry.kind === "shell")
            ? compactSearchResults(entry.text, entry.kind, path)
            : null) ||
          (!codeRead ? compactDiff(entry.text) : null) ||
          (!codeRead ? compactTestLog(entry.text) : null) ||
          (!codeRead ? compactStackTrace(entry.text) : null) ||
          (!codeRead ? compactCsv(entry.text, entry.kind, path) : null) ||
          (entry.kind === "read" && rules.skeletonCodeReads ? codeSkeleton(entry.text, path) : null);
      } catch {
        output = null;
        outcome.errors += 1;
      }
      if (!output || output.length >= entry.length - 100) continue;
      if (!setResultText(entry.part, output)) continue;
      const saved = entry.length - output.length;
      entry.text = output;
      entry.length = output.length;
      entry.compacted = true;
      outcome.compacted += 1;
      outcome.compactedChars += saved;
    }
    protectedLatest = runStage(() => latestProtectedEntries(entries), new Map());
  }

  if (rules.editReceipts) {
    const receipts = runStage(() => applyEditReceipts(entries, calls, results, context), { receipts: 0, chars: 0 });
    outcome.receipts = receipts.receipts;
    outcome.receiptChars = receipts.chars;
  }

  if (rules.trimToolOutput) {
    const oldMax = rules.maxOldToolOutput;
    const freshMax = rules.maxToolOutput;
    let oldSaved = 0;
    let freshSaved = 0;
    let trimmedResults = 0;
    for (const entry of entries) {
      if (entry.stub) continue;
      const isOld = entry.messageIndex < context.cutoff;
      if (entry.protected && protectedLatest.get(entry.key) === entry) continue;
      const isKeptRead = isOld && keptReads.has(entry.index);
      const max = isOld && !isKeptRead ? oldMax : freshMax;
      const reason = isOld && !isKeptRead ? "old" : isKeptRead ? "kept" : "fresh";
      const trimmed = runStage(
        () =>
          trimResult(entry.part.result, max, reason, {
            tool: entry.name,
            input: entry.input,
            range: entry.readRange,
            lineAware: !entry.compacted && !entry.merged,
          }),
        { result: entry.part.result, saved: 0 },
      );
      if (trimmed.saved > 0 && setResultObject(entry.part, trimmed.result)) {
        entry.text = resultText(entry.part.result);
        entry.length = entry.text.length;
        trimmedResults += 1;
        if (isOld && !isKeptRead) oldSaved += trimmed.saved;
        else freshSaved += trimmed.saved;
      }
    }
    outcome.old = oldSaved;
    outcome.fresh = freshSaved;
    outcome.trimmed = trimmedResults;
    outcome.protectedReads = keptReads.size;
  } else {
    outcome.protectedReads = keptReads.size;
  }

  const budget = runStage(() => applyBudget(entries, context, protectedLatest, keptReads), {
    evicted: 0,
    chars: 0,
    over: 0,
  });
  outcome.budgetEvicted = budget.evicted;
  outcome.budgetChars = budget.chars;
  outcome.budgetOver = budget.over;

  const after = safeMeasure(context.messages, context.system, context.tools, {
    tokensPerChar: 1 / rules.charsPerToken,
  });
  return { ...outcome, before, after, noop: false };
}

export { compactCsv, compactDiff, compactHtml, compactJson, compactSearchResults, compactStackTrace, compactTestLog, codeSkeleton };
export { CONTEXT_RULE_DEFAULTS, isSkillPath, measureRequest, normalizeContextRules } from "./context-core.js";
