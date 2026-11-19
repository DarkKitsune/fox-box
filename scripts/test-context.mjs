import assert from "node:assert/strict";

import {
  CONTEXT_RULE_DEFAULTS,
  codeSkeleton,
  compactCsv,
  compactDiff,
  compactHtml,
  compactJson,
  compactSearchResults,
  compactStackTrace,
  compactTestLog,
  buildRelevance,
  isSkillPath,
  measureRequest,
  normalizeContextRules,
  pruneContext,
  trimText,
} from "../plugin/context.js";

const projectKey = "c:/work/demo";

function rules(overrides = {}) {
  return normalizeContextRules({
    keepRecent: 2,
    protectedReads: 0,
    trimToolOutput: false,
    collapseDuplicates: false,
    pathSupersession: true,
    staleReads: true,
    mergeReadRanges: true,
    editReceipts: false,
    smartCompaction: false,
    budgetTokens: 0,
    ...overrides,
  });
}

function toolCall(id, name, input) {
  return { role: "assistant", content: [{ type: "tool-call", id, name, input }] };
}

function toolResult(id, name, value, type = "text") {
  return {
    role: "tool",
    content: [
      {
        type: "tool-result",
        id,
        name,
        result: type === "text" ? { type: "text", value } : { type, value },
      },
    ],
  };
}

function textMessage(role, text) {
  return { role, content: [{ type: "text", text }] };
}

function run(messages, overrides = {}, extra = {}) {
  const event = {
    messages,
    system: extra.system || [],
    tools: extra.tools || {},
  };
  const outcome = pruneContext(event, { rules: rules(overrides), projectKey });
  return { event, outcome };
}

function conversationChars(measure) {
  return measure.chars - measure.system - measure.toolDefinitions;
}

function categorySum(outcome) {
  return (
    outcome.old +
    outcome.fresh +
    outcome.collapsedChars +
    outcome.supersededChars +
    outcome.staleChars +
    outcome.compactedChars +
    outcome.receiptChars +
    outcome.budgetChars
  );
}

function numbered(count, prefix = "line", extra = "") {
  return Array.from(
    { length: count },
    (_, index) => `${index + 1}\t${prefix} ${index + 1} ${extra}${"x".repeat(24)}`,
  ).join("\n");
}

function assertNoExpansion(outcome) {
  assert.equal(outcome.errors, 0, `a pruning stage threw: ${outcome.lastError || "unknown error"}`);
  const before = conversationChars(outcome.before);
  const after = conversationChars(outcome.after);
  assert.ok(after <= before, `pruning expanded the conversation (${before} -> ${after})`);
  assert.equal(
    before - after,
    categorySum(outcome),
    "every removed character is attributed to exactly one pruning category",
  );
}

/* ------------------------------------------------------------------ */
/*  Measurement                                                       */
/* ------------------------------------------------------------------ */

{
  const messages = [
    {
      role: "assistant",
      content: [
        { type: "text", text: "hello text" },
        { type: "reasoning", text: "thinking hard" },
        { type: "tool-call", id: "a", name: "read", input: { filePath: "src/a.ts" } },
      ],
    },
    toolResult("a", "read", "read output"),
    {
      role: "user",
      content: [
        { type: "text", text: "look" },
        { type: "image", data: "b".repeat(120) },
      ],
    },
    { role: "assistant", content: "plain string content" },
    null,
    { role: "tool", content: [null, "orphan"] },
  ];
  const system = [
    { type: "text", text: "system prompt" },
    { type: "text", text: "second system part" },
  ];
  const tools = {
    read: { description: "Read a file", input: {} },
    bash: { description: "Run a command", input: { type: "object" } },
  };
  const measure = measureRequest(messages, system, tools, { tokensPerChar: 0.25 });
  assert.ok(measure.system > 20, "system text measured");
  assert.ok(measure.toolDefinitions > 20, "tool definitions measured");
  assert.ok(measure.text > 0, "text measured");
  assert.ok(measure.reasoning > 0, "reasoning measured");
  assert.ok(measure.media >= 120, "media measured");
  assert.ok(measure.toolInputs > 0, "tool-call input measured");
  assert.ok(measure.toolResults > 0, "tool result measured");
  assert.equal(measure.toolCalls, 1, "tool calls counted");
  assert.equal(measure.toolResultParts, 1, "tool result parts counted");
  assert.equal(measure.reasoningParts, 1, "reasoning parts counted");
  assert.equal(measure.mediaParts, 1, "media parts counted");
  assert.equal(measure.toolDefinitionCount, 2, "tool definitions counted");
  assert.equal(
    measure.chars,
    measure.system +
      measure.toolDefinitions +
      measure.text +
      measure.reasoning +
      measure.media +
      measure.toolInputs +
      measure.toolResults +
      measure.other,
    "measurement categories add up to the total",
  );
  assert.equal(
    measure.estimatedTokens,
    Math.round((measure.chars - measure.media) * 0.25),
    "token estimate excludes media bytes",
  );
  assert.ok(measure.largestToolDefinitions.length === 2, "largest tool definitions reported");
}

{
  /* The current message schema wraps media in `media.source`; bytes are not strings. */
  const messages = [
    {
      role: "user",
      content: [
        {
          type: "media",
          media: { source: { type: "base64", data: "b".repeat(120), mediaType: "image/png" } },
        },
      ],
    },
    {
      role: "user",
      content: [
        {
          type: "media",
          media: { source: { type: "bytes", data: new Uint8Array(64), mediaType: "image/png" } },
        },
      ],
    },
  ];
  const measure = measureRequest(messages, [], {});
  assert.equal(measure.media, 184, "current media parts measure base64 and byte payloads");
  assert.equal(measure.mediaParts, 2, "both media parts counted");
}

/* ------------------------------------------------------------------ */
/*  Path-level supersession, stale reads, overlap merging             */
/* ------------------------------------------------------------------ */

{
  const file = numbered(100);
  const messages = [
    toolCall("old", "read", { filePath: "src/a.ts" }),
    toolResult("old", "read", file),
    toolCall("new", "read", { filePath: "src/a.ts" }),
    toolResult("new", "read", file),
  ];
  const { outcome } = run(messages);
  assert.match(messages[1].content[0].result.value, /^\[Fox Box: superseded read of src\/a\.ts/);
  assert.equal(messages[3].content[0].result.value, file, "newest read stays whole");
  assert.equal(outcome.superseded, 1, "older read superseded");
  assert.ok(outcome.supersededChars > 0, "supersession chars recorded");
  assertNoExpansion(outcome);
}

{
  const oldFile = numbered(120);
  const messages = [
    toolCall("old", "read", { filePath: "src/full.ts", offset: 1, limit: 120 }),
    toolResult("old", "read", oldFile),
    toolCall("part-a", "read", { filePath: "src/full.ts", offset: 1, limit: 60 }),
    toolResult("part-a", "read", numbered(60).split("\n").slice(0, 60).join("\n")),
    toolCall("part-b", "read", { filePath: "src/full.ts", offset: 61, limit: 60 }),
    toolResult("part-b", "read", numbered(120).split("\n").slice(60).join("\n")),
  ];
  /* Two newer ranges together cover the old one, even though neither does alone. */
  const { outcome } = run(messages, { keepRecent: 10 });
  assert.match(messages[1].content[0].result.value, /^\[Fox Box: superseded/);
  assert.equal(outcome.superseded, 1, "union coverage supersedes the older read");
  assertNoExpansion(outcome);
}

{
  const oldFile = numbered(100);
  const messages = [
    toolCall("old", "read", { filePath: "src/partial.ts", offset: 1, limit: 100 }),
    toolResult("old", "read", oldFile),
    toolCall("new", "read", { filePath: "src/partial.ts", offset: 1, limit: 40 }),
    toolResult("new", "read", numbered(40)),
  ];
  const { outcome } = run(messages, { keepRecent: 10 });
  const value = messages[1].content[0].result.value;
  assert.doesNotMatch(value, /^\[Fox Box: superseded/);
  assert.match(value, /lines 1–40 already shown by a newer read/, "overlap is replaced by a marker");
  assert.match(value, /41\tline 41/, "non-overlapping lines survive");
  assert.match(value, /100\tline 100/, "the tail survives");
  assert.equal(outcome.merged, 1, "partial overlap merged");
  assert.ok(outcome.supersededChars > 0, "merge chars recorded");
  assertNoExpansion(outcome);
}

{
  const messages = [
    toolCall("a", "read", { filePath: "src/disjoint.ts", offset: 1, limit: 20 }),
    toolResult("a", "read", numbered(20)),
    toolCall("b", "read", { filePath: "src/disjoint.ts", offset: 30, limit: 20 }),
    toolResult("b", "read", numbered(20, "line", "second ")),
  ];
  const { outcome } = run(messages, { keepRecent: 10 });
  assert.equal(outcome.superseded, 0, "disjoint ranges are not superseded");
  assert.equal(outcome.merged, 0, "disjoint ranges are not merged");
  assert.equal(messages[1].content[0].result.value, numbered(20), "disjoint earlier read untouched");
}

{
  const read = numbered(20);
  const messages = [
    toolCall("read", "read", { filePath: "src/stale.ts" }),
    toolResult("read", "read", read),
    toolCall("edit", "edit", { filePath: "src/stale.ts", oldString: "a", newString: "b" }),
    toolResult("edit", "edit", "edited"),
  ];
  const { outcome } = run(messages);
  assert.match(messages[1].content[0].result.value, /^\[Fox Box: stale read of src\/stale\.ts/);
  assert.equal(outcome.stale, 1, "read before an edit is stale");
  assertNoExpansion(outcome);
}

{
  const read = numbered(20);
  const messages = [
    toolCall("read", "read", { filePath: "src/failed.ts" }),
    toolResult("read", "read", read),
    toolCall("edit", "edit", { filePath: "src/failed.ts", oldString: "a", newString: "b" }),
    toolResult("edit", "edit", "permission denied", "error"),
  ];
  const { outcome } = run(messages);
  assert.equal(messages[1].content[0].result.value, read, "a failed edit does not invalidate a read");
  assert.equal(outcome.stale, 0, "failed edits are ignored");
}

{
  const read = numbered(20);
  const messages = [
    toolCall("edit", "write", { filePath: "src/after.ts", content: "new" }),
    toolResult("edit", "write", "written"),
    toolCall("read", "read", { filePath: "src/after.ts" }),
    toolResult("read", "read", read),
  ];
  const { outcome } = run(messages);
  assert.equal(messages[3].content[0].result.value, read, "a read after the edit is current");
  assert.equal(outcome.stale, 0);
}

{
  /* A real directory named b/ must not be mistaken for a diff prefix. */
  const read = numbered(20);
  const messages = [
    toolCall("read", "read", { filePath: "b/local.ts" }),
    toolResult("read", "read", read),
    toolCall("edit", "write", { filePath: "b/local.ts", content: "x" }),
    toolResult("edit", "write", "ok"),
  ];
  const { outcome } = run(messages);
  assert.equal(outcome.stale, 1, "a b/ directory path is normalized consistently");
}

{
  const read = numbered(20);
  const messages = [
    toolCall("read", "read", { filePath: "src\\case\\Path.ts" }),
    toolResult("read", "read", read),
    toolCall("edit", "write", { filePath: "SRC/CASE/PATH.TS", content: "x" }),
    toolResult("edit", "write", "ok"),
  ];
  const { outcome } = run(messages);
  if (process.platform === "win32" || process.platform === "darwin") {
    assert.equal(outcome.stale, 1, "path comparison is case-insensitive on Windows/macOS");
  }
}

{
  /* Content arrays are joined with newlines when read; the ledger must use the same count. */
  const parts = Array.from({ length: 40 }, (_, index) => ({ type: "text", text: `part-${index}: ${"x".repeat(120)}` }));
  const messages = [
    toolCall("content-array", "read", { filePath: "src/content.txt" }),
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          id: "content-array",
          name: "read",
          result: { type: "content", value: parts },
        },
      ],
    },
  ];
  const { outcome } = run(messages, { trimToolOutput: true, maxToolOutput: 2000, keepRecent: 2 });
  assert.ok(outcome.fresh > 0, "content-array text was trimmed");
  assertNoExpansion(outcome);
}

/* ------------------------------------------------------------------ */
/*  Write/edit receipts                                               */
/* ------------------------------------------------------------------ */

{
  const oldContent = "line\n".repeat(1600);
  const newContent = "other\n".repeat(1400);
  const messages = [
    toolCall("edit-old", "write", { filePath: "src/one.ts", content: oldContent }),
    toolResult("edit-old", "write", "written"),
    toolCall("edit-new", "edit", { filePath: "src/one.ts", oldString: "a", newString: "b" }),
    toolResult("edit-new", "edit", "edited"),
    toolCall("edit-other", "write", { filePath: "src/two.ts", content: oldContent }),
    toolResult("edit-other", "write", "written"),
  ];
  const { outcome } = run(messages, { editReceipts: true, receiptMinChars: 200 });
  const receipt = messages[0].content[0].input;
  assert.equal(typeof receipt, "object");
  assert.equal(receipt.foxBoxReceipt, "historical edit input compacted before sending");
  assert.equal(receipt.path, "src/one.ts");
  assert.match(receipt.change, /^\+\d+ -\d+$/);
  assert.ok(receipt.hash);
  assert.equal(receipt.hunks, 1);
  assert.equal(messages[2].content[0].input.newString, "b", "latest edit for a path stays whole");
  assert.equal(messages[4].content[0].input.content, oldContent, "latest edit for another path stays whole");
  assert.equal(outcome.receipts, 1, "only the superseded edit becomes a receipt");
  assert.ok(outcome.receiptChars > 0, "receipt savings counted");
  assertNoExpansion(outcome);
}

{
  const oldContent = "line\n".repeat(1000);
  const messages = [
    toolCall("bad-edit", "apply_patch", { filePath: "src/patch.ts", patch: oldContent }),
    toolResult("bad-edit", "apply_patch", "ok"),
    toolCall("new-edit", "write", { filePath: "src/patch.ts", content: "new" }),
    toolResult("new-edit", "write", "ok"),
  ];
  const { outcome } = run(messages, { editReceipts: true, receiptMinChars: 200 });
  assert.equal(outcome.receipts, 1);
  assert.equal(messages[0].content[0].input.path, "src/patch.ts", "malformed patch still yields a safe receipt");
}

{
  const messages = [
    toolCall("read-big", "read", { filePath: "src/a.ts" }),
    toolResult("read-big", "read", "x".repeat(5000)),
    toolCall("edit", "edit", { filePath: "src/a.ts", oldString: "a", newString: "b" }),
    toolResult("edit", "edit", "ok"),
  ];
  const original = structuredClone(messages[0].content[0].input);
  const { outcome } = run(messages, { editReceipts: true, receiptMinChars: 200 });
  assert.equal(outcome.receipts, 0, "read calls are never turned into receipts");
  assert.deepEqual(messages[0].content[0].input, original);
}

/* ------------------------------------------------------------------ */
/*  Type-aware compactors                                             */
/* ------------------------------------------------------------------ */

{
  const log = [
    "> npm test",
    "PASS src/alpha.test.ts",
    ...Array.from({ length: 40 }, (_, index) => `  ✓ passes case ${index + 1}`),
    "FAIL src/beta.test.ts",
    "  ● beta › adds numbers",
    "    Expected: 4",
    "    Received: 5",
    "  at src/beta.test.ts:12:3",
    ...Array.from({ length: 40 }, (_, index) => `  ✓ passes later ${index + 1}`),
    "Tests:       2 failed, 80 passed, 82 total",
    "Time:        2.31 s",
  ].join("\n");
  const compacted = compactTestLog(log);
  assert.ok(compacted, "test log compacted");
  assert.match(compacted, /FAIL src\/beta\.test\.ts/);
  assert.match(compacted, /Expected: 4/);
  assert.match(compacted, /Tests:       2 failed/);
  assert.doesNotMatch(compacted, /✓ passes case 10\b/);
  assert.match(compacted, /passing log line/);
  assert.ok(compacted.length < log.length * 0.5, "log compactor removes most passing lines");
}

{
  const passing = ["> npm test", ...Array.from({ length: 80 }, (_, index) => `  ✓ pass ${index + 1}`), "Tests: 80 passed", "Time: 1s"].join(
    "\n",
  );
  const compacted = compactTestLog(passing);
  assert.ok(compacted);
  assert.match(compacted, /passing log line/);
  assert.match(compacted, /Tests: 80 passed/);
}

{
  const stack = [
    "Error: boom",
    "    at run (C:\\Work\\Demo\\src\\core.ts:12:3)",
    ...Array.from({ length: 30 }, (_, index) => `    at library (C:\\Work\\Demo\\node_modules\\pkg\\index.js:${index + 1}:2)`),
    "    at load (C:\\Work\\Demo\\src\\loader.ts:40:1)",
    "    at main (C:\\Work\\Demo\\src\\main.ts:9:7)",
  ].join("\n");
  const compacted = compactStackTrace(stack);
  assert.ok(compacted);
  assert.match(compacted, /Error: boom/);
  assert.match(compacted, /src\\core\.ts:12:3/);
  assert.match(compacted, /src\\loader\.ts:40:1/);
  assert.match(compacted, /library frame/);
  assert.ok(compacted.length < stack.length * 0.6);
}

{
  const diff = [
    "diff --git a/src/a.ts b/src/a.ts",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1,8 +1,9 @@",
    " context one",
    " context two",
    ...Array.from({ length: 40 }, (_, index) => ` context filler ${index + 1} ${"c".repeat(20)}`),
    "-old line",
    "+new line",
    "+added line",
    " context three",
    " context four",
    "@@ -20,3 +21,3 @@",
    " keep",
    "-removed",
    "+replaced",
  ].join("\n");
  const compacted = compactDiff(diff);
  assert.ok(compacted);
  assert.match(compacted, /^@@ -1,8 \+1,9 @@/m);
  assert.match(compacted, /^\+new line$/m);
  assert.match(compacted, /^-old line$/m);
  assert.doesNotMatch(compacted, /^ context one$/m);
  assert.match(compacted, /diff context line/);
}

{
  const grep = Array.from({ length: 5 }, (_, file) =>
    Array.from({ length: 8 }, (_, line) => `src/file-${file}.ts:${line + 1}:const value${file}_${line} = ${line};`),
  )
    .flat()
    .join("\n");
  const compacted = compactSearchResults(grep, "search");
  assert.ok(compacted);
  assert.match(compacted, /src\/file-0\.ts \(8 matches\)/);
  assert.match(compacted, /more in this file/);
  assert.match(compacted, /src\/file-4\.ts \(8 matches\)/);
  assert.match(compacted, /src\/file-4\.ts:1:const value4_0 = 0;/);
}

{
  const glob = Array.from({ length: 40 }, (_, index) => `src/group-${index % 4}/file-${index}.ts`).join("\n");
  const compacted = compactSearchResults(glob, "search");
  assert.ok(compacted);
  assert.match(compacted, /src\/group-0\/ \(10 files\)/);
  assert.match(compacted, /path\(s\) not shown/);
}

{
  const value = {
    users: Array.from({ length: 200 }, (_, index) => ({ id: index, name: `user-${index}`, active: index % 2 === 0 })),
    total: 200,
  };
  const text = JSON.stringify(value);
  const compacted = compactJson(text);
  assert.ok(compacted);
  assert.match(compacted, /"items":200/);
  assert.match(compacted, /"shape":"object"/);
  assert.ok(compacted.length < text.length * 0.5);
  assert.equal(compactJson("{not json"), null, "malformed JSON is left alone");
  assert.equal(compactJson("[1,2,3]"), null, "small JSON is not worth compacting");
}

{
  const csv = ["id,name,score", ...Array.from({ length: 60 }, (_, index) => `${index},user-${index},${index * 2}`)].join("\n");
  const compacted = compactCsv(csv);
  assert.ok(compacted);
  assert.match(compacted, /id,name,score/);
  assert.match(compacted, /CSV row\(s\) omitted/);
  assert.match(compacted, /59,user-59,118/);
  assert.equal(compactCsv("a,b\n1,2\n3"), null, "inconsistent CSV is left alone");
}

{
  const html = [
    "<!doctype html><html><head><title>Fox Notes</title><style>.x{color:red}</style></head>",
    "<body><nav>menu menu menu</nav>",
    "<h1>Main heading</h1><p>This is the first useful paragraph with enough text to survive.</p>",
    "<h2>Second heading</h2><p>This is the second useful paragraph with enough text to survive.</p>",
    `<script>${"alert('x');".repeat(200)}</script>`,
    `<footer>${"footer ".repeat(200)}</footer></body></html>`,
  ].join("\n");
  const compacted = compactHtml(html, "web");
  assert.ok(compacted);
  assert.match(compacted, /Title: Fox Notes/);
  assert.match(compacted, /# Main heading/);
  assert.match(compacted, /first useful paragraph/);
  assert.doesNotMatch(compacted, /alert\('x'\)/);
  assert.doesNotMatch(compacted, /menu menu menu/);
}

{
  /* A read of markup or a doc table is source, not a fetched page or a CSV export. */
  const html = [
    "<!doctype html><html><body>",
    ...Array.from({ length: 60 }, (_, index) => `<div class="row-${index}"><p>Item ${index}</p></div>`),
    "</body></html>",
  ].join("\n");
  assert.equal(compactHtml(html, "read", "src/page.html"), null, "an HTML source read is not web-compacted");
  assert.ok(compactHtml(html, "web"), "a fetched page is still compacted");

  const table = [
    "| Name | Value | Note |",
    "| --- | --- | --- |",
    ...Array.from({ length: 40 }, (_, index) => `| row${index} | ${index} | note ${index} |`),
  ].join("\n");
  assert.equal(compactCsv(table, "read", "docs/table.md"), null, "a markdown table read is not CSV");
  assert.ok(compactCsv(table.replaceAll("|", ","), "read", "data/table.csv"), "a real CSV read is compacted");
}

{
  const source = [
    "// file header",
    "import { thing } from './thing';",
    "import { other } from './other';",
    "export interface Shape {",
    "  id: string;",
    "}",
    ...Array.from({ length: 60 }, (_, index) => {
      const body = Array.from({ length: 20 }, (_, line) => `  const bodyLine${line} = ${line};`).join("\n");
      return `export function fn${index}(value: number) {\n${body}\n  return value + ${index};\n}`;
    }),
  ].join("\n");
  const compacted = codeSkeleton(source, "src/big.ts");
  assert.ok(compacted);
  assert.match(compacted, /import \{ thing \}/);
  assert.match(compacted, /export interface Shape/);
  assert.match(compacted, /export function fn59/);
  assert.match(compacted, /code body line/);
  assert.ok(compacted.length < source.length * 0.5);
  assert.equal(codeSkeleton("const x = 1;", "src/tiny.ts"), null, "small code is left alone");
  assert.equal(codeSkeleton(source, "src/notes.md"), null, "non-code paths are left alone");
}

{
  /* The pipeline applies compactors only to old results and accounts exactly. */
  const log = [
    "> npm test",
    ...Array.from({ length: 30 }, (_, index) => `  ✓ pass ${index + 1} ${"x".repeat(16)}`),
    "FAIL src/beta.test.ts",
    "  Expected 4",
    "  Received 5",
    ...Array.from({ length: 30 }, (_, index) => `  ✓ later ${index + 1} ${"x".repeat(16)}`),
    "Tests: 1 failed, 60 passed",
  ].join("\n");
  const json = JSON.stringify({ users: Array.from({ length: 100 }, (_, index) => ({ id: index, name: `u${index}` })) });
  const messages = [
    toolCall("log", "bash", { command: "npm test" }),
    toolResult("log", "bash", log),
    toolCall("json", "read", { filePath: "src/data.json" }),
    toolResult("json", "read", json),
    textMessage("assistant", "Done."),
    textMessage("user", "Continue."),
  ];
  const { outcome } = run(messages, {
    keepRecent: 2,
    trimToolOutput: false,
    collapseDuplicates: false,
    pathSupersession: false,
    staleReads: false,
    editReceipts: false,
    smartCompaction: true,
    skeletonCodeReads: false,
  });
  assert.equal(outcome.compacted, 2, "the old log and JSON were compacted");
  assert.ok(outcome.compactedChars > 0);
  assert.match(messages[1].content[0].result.value, /test-log compaction/);
  assert.match(messages[1].content[0].result.value, /FAIL src\/beta\.test\.ts/);
  assert.match(messages[3].content[0].result.value, /JSON compaction/);
  assertNoExpansion(outcome);
}

/* ------------------------------------------------------------------ */
/*  Idempotency and malformed input                                   */
/* ------------------------------------------------------------------ */

{
  const log = [
    "> npm test",
    ...Array.from({ length: 60 }, (_, index) => `  ✓ pass ${index + 1} ${"x".repeat(20)}`),
    "Tests: 60 passed",
  ].join("\n");
  const once = compactTestLog(log);
  assert.ok(once);
  assert.equal(compactTestLog(once), null, "an already compacted log is not compacted again");
}

{
  const messages = [
    toolCall("cycle", "read", { filePath: "src/cycle.ts" }),
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          id: "cycle",
          name: "read",
          result: { type: "json", value: null },
        },
      ],
    },
  ];
  const cycle = { name: "cycle" };
  cycle.self = cycle;
  messages[1].content[0].result.value = cycle;
  assert.doesNotThrow(() => run(messages, { smartCompaction: true, trimToolOutput: true }));
}

{
  const weird = [
    null,
    { role: "user", content: null },
    { role: "assistant", content: [null, 12, "raw string"] },
    { role: "tool", content: [{ type: "tool-result" }] },
    { role: "tool", content: [{ type: "tool-result", id: 42, result: { type: "text" } }] },
    { role: "tool", content: [{ type: "tool-result", id: "x", name: "read", result: { type: "content", value: null } }] },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          id: "y",
          name: "edit",
          result: { type: "text", value: { nested: "not a string" } },
        },
      ],
    },
    toolCall("z", "read", "src/string-input.ts"),
    toolResult("z", "read", "small"),
  ];
  assert.doesNotThrow(() =>
    run(weird, {
      smartCompaction: true,
      trimToolOutput: true,
      collapseDuplicates: true,
      editReceipts: true,
      budgetTokens: 1000,
    }),
  );
}

{
  /* A frozen message must not make the whole request fail or lose protection. */
  const messages = Object.freeze([
    Object.freeze({ role: "user", content: Object.freeze([{ type: "text", text: "keep me" }]) }),
  ]);
  const event = { messages, system: [], tools: {} };
  assert.doesNotThrow(() => pruneContext(event, { rules: rules({ trimToolOutput: true }) }));
  assert.equal(messages[0].content[0].text, "keep me");
}

/* ------------------------------------------------------------------ */
/*  Skill protection                                                  */
/* ------------------------------------------------------------------ */

{
  /* Every path that carries skill behavior is protected, not just SKILL.md. */
  for (const path of [
    "SKILL.md",
    "skills/foo/SKILL.md",
    "skills/foo/config.json",
    "skills/foo/schema.json",
    "skill/foo/config.json",
    "skillfiles/foo/config.json",
    "my-skill-data/foo/schema.json",
    ".opencode/skills/foo/manifest.json",
    "C:\\Work\\Demo\\skills\\foo\\config.json",
    "skill.json",
    "skills.json",
    "skill-config.json",
    "my-skill.json",
  ]) {
    assert.equal(isSkillPath(path), true, `${path} is a skill path`);
  }
  for (const path of ["src/skill-parser.ts", "src/config.json", "docs/skill.md"]) {
    if (path === "docs/skill.md") {
      assert.equal(isSkillPath(path), true, "a SKILL.md basename is protected anywhere");
    } else {
      assert.equal(isSkillPath(path), false, `${path} is not a skill path`);
    }
  }
}

{
  /* Mentioning a skill file in a normal document must not make the whole read immortal. */
  const value = `# Notes\nSee SKILL.md for conventions.\n${"x".repeat(20000)}`;
  const messages = [
    textMessage("user", "go"),
    toolCall("notes", "read", { filePath: "docs/notes.md" }),
    toolResult("notes", "read", value),
  ];
  const { outcome } = run(messages, { trimToolOutput: true, maxToolOutput: 2000 });
  assert.ok(messages[2].content[0].result.value.length <= 2000, "a doc mentioning SKILL.md is still capped");
  assert.ok(outcome.fresh > 0, "the trim is accounted for");
}

{
  /* A skill JSON file large enough for the JSON compactor must stay whole. */
  const payload = JSON.stringify({
    name: "fox-rules",
    description: "Keep the fox canonical",
    instructions: "x".repeat(5000),
    allowed_tools: Array.from({ length: 50 }, (_, index) => `tool-${index}`),
  });
  const messages = [
    toolCall("skill-json", "read", { filePath: "skills/fox/rules.json" }),
    toolResult("skill-json", "read", payload),
    textMessage("assistant", "Loaded the rules."),
    textMessage("user", "Continue."),
  ];
  const { outcome } = run(messages, {
    keepRecent: 2,
    trimToolOutput: true,
    smartCompaction: true,
    budgetTokens: 500,
  });
  assert.equal(messages[1].content[0].result.value, payload, "skill JSON is never compacted");
  assert.equal(outcome.compacted, 0, "no compactor touched the skill JSON");
  assert.equal(outcome.budgetEvicted, 0, "the budget cannot evict the only skill copy");
  assert.equal(outcome.budgetOver > 0 || outcome.after.chars <= 2000, true);
}

{
  /* A root-level skill manifest is protected too. */
  const payload = JSON.stringify({ skill: "fox", description: "rules", body: "y".repeat(4000) });
  const messages = [
    toolCall("root-skill", "read", { filePath: "skill.json" }),
    toolResult("root-skill", "read", payload),
  ];
  const { outcome } = run(messages, { trimToolOutput: true, smartCompaction: true });
  assert.equal(messages[1].content[0].result.value, payload, "root skill.json stays whole");
  assert.equal(outcome.compacted, 0);
}

{
  /* A short skill file is still a copy: the budget must not evict it. */
  const tiny = JSON.stringify({ name: "fox", rules: ["be kind"] });
  const messages = [
    toolCall("tiny-skill", "read", { filePath: "skills/fox/rules.json" }),
    toolResult("tiny-skill", "read", tiny),
    toolCall("big-old", "bash", { command: "echo big" }),
    toolResult("big-old", "bash", "b".repeat(5000)),
    textMessage("assistant", "Done."),
    textMessage("user", "Continue."),
  ];
  const { outcome } = run(messages, { budgetTokens: 300, charsPerToken: 4, keepRecent: 2 });
  assert.equal(messages[1].content[0].result.value, tiny, "a short skill copy is never evicted");
  assert.ok(outcome.budgetEvicted > 0, "the budget evicted unrelated output instead");
  assertNoExpansion(outcome);
}

{
  /* A skill tool result is protected even when it carries no file path. */
  const payload = JSON.stringify({ skill: "fox", description: "rules", body: "z".repeat(5000) });
  const messages = [
    toolCall("skill-tool", "skill", { name: "fox" }),
    toolResult("skill-tool", "skill", payload),
    textMessage("assistant", "Loaded."),
    textMessage("user", "Continue."),
  ];
  const { outcome } = run(messages, { keepRecent: 2, trimToolOutput: true, maxToolOutput: 2000 });
  assert.equal(messages[1].content[0].result.value, payload, "skill tool output is never capped");
  assert.equal(outcome.fresh, 0);
}

{
  /* A loader without a skill-named tool still identifies a manifest result. */
  const payload = JSON.stringify({
    skill: "fox",
    name: "Fox",
    description: "rules",
    instructions: "z".repeat(5000),
  });
  const messages = [
    toolCall("manifest", "mcp_loader", { name: "fox" }),
    toolResult("manifest", "mcp_loader", payload),
    textMessage("assistant", "Loaded."),
    textMessage("user", "Continue."),
  ];
  const { outcome } = run(messages, { keepRecent: 2, trimToolOutput: true, maxToolOutput: 2000 });
  assert.equal(messages[1].content[0].result.value, payload, "manifest-shaped result is protected");
  assert.equal(outcome.fresh, 0);
}

{
  /* Re-reading a skill may prune the older copy, but the newest copy stays whole. */
  const first = JSON.stringify({ version: 1, body: "a".repeat(4000) });
  const second = JSON.stringify({ version: 2, body: "b".repeat(4000) });
  const messages = [
    toolCall("skill-old", "read", { filePath: "skills/fox/rules.json" }),
    toolResult("skill-old", "read", first),
    toolCall("skill-new", "read", { filePath: "skills/fox/rules.json" }),
    toolResult("skill-new", "read", second),
    textMessage("assistant", "Updated."),
    textMessage("user", "Continue."),
  ];
  const { outcome } = run(messages, { keepRecent: 2, collapseDuplicates: true, trimToolOutput: true });
  assert.match(messages[1].content[0].result.value, /^\[Fox Box: duplicate read of skills\/fox\/rules\.json collapsed/);
  assert.equal(messages[3].content[0].result.value, second, "newest skill copy stays whole");
  assert.equal(outcome.collapsed, 1);
}

{
  /* Two partial re-reads may cover a full skill file together, but they are not
     one whole copy; keep the original full read as well. */
  const full = numbered(100);
  const messages = [
    toolCall("full", "read", { filePath: "skills/fox/SKILL.md", offset: 1, limit: 100 }),
    toolResult("full", "read", full),
    toolCall("part-a", "read", { filePath: "skills/fox/SKILL.md", offset: 1, limit: 50 }),
    toolResult("part-a", "read", numbered(50)),
    toolCall("part-b", "read", { filePath: "skills/fox/SKILL.md", offset: 51, limit: 50 }),
    toolResult("part-b", "read", numbered(50, "line", "second ")),
  ];
  const { outcome } = run(messages, { keepRecent: 10 });
  assert.equal(messages[1].content[0].result.value, full, "union coverage does not remove the only whole skill copy");
  assert.equal(outcome.superseded, 0, "no protected read is stubbed without a single covering read");
}

{
  /* If a skill is edited and never re-read, do not leave the model with no copy. */
  const payload = JSON.stringify({ name: "fox", body: "c".repeat(3000) });
  const messages = [
    toolCall("skill-read", "read", { filePath: "skills/fox/SKILL.md" }),
    toolResult("skill-read", "read", payload),
    toolCall("skill-edit", "write", { filePath: "skills/fox/SKILL.md", content: "updated" }),
    toolResult("skill-edit", "write", "written"),
  ];
  const { outcome } = run(messages, { keepRecent: 2, staleReads: true });
  assert.equal(messages[1].content[0].result.value, payload, "last skill copy survives even after an edit");
  assert.equal(outcome.stale, 0, "the only skill copy is not stubbed");
}

{
  /* When a newer read exists after the edit, the stale older copy can go. */
  const oldPayload = JSON.stringify({ name: "fox", body: "d".repeat(3000) });
  const newPayload = JSON.stringify({ name: "fox", body: "e".repeat(3000) });
  const messages = [
    toolCall("old", "read", { filePath: "skills/fox/SKILL.md" }),
    toolResult("old", "read", oldPayload),
    toolCall("edit", "write", { filePath: "skills/fox/SKILL.md", content: "updated" }),
    toolResult("edit", "write", "written"),
    toolCall("new", "read", { filePath: "skills/fox/SKILL.md" }),
    toolResult("new", "read", newPayload),
  ];
  const { outcome } = run(messages, { keepRecent: 10, staleReads: true });
  assert.match(messages[1].content[0].result.value, /^\[Fox Box: stale read/);
  assert.equal(messages[5].content[0].result.value, newPayload, "newest skill copy survives");
  assert.equal(outcome.stale, 1);
}

/* ------------------------------------------------------------------ */
/*  Budget and relevance                                              */
/* ------------------------------------------------------------------ */

{
  const relevance = buildRelevance(
    [
      textMessage("user", "Look at src/alpha.ts and the failure in src/beta.test.ts."),
      textMessage("assistant", "I will inspect src/gamma.ts after that."),
    ],
    "c:/work/demo",
  );
  assert.equal(relevance.paths.has("c:/work/demo/src/alpha.ts"), true, "user paths are normalized");
  assert.equal(relevance.paths.has("c:/work/demo/src/beta.test.ts"), true, "test paths are normalized");
  assert.equal(relevance.paths.has("c:/work/demo/src/gamma.ts"), true, "recent assistant paths are included");
  assert.ok(relevance.terms.has("alpha"), "symbol terms are extracted");
}

{
  const messages = [
    textMessage("user", "Please inspect src/keep.ts and the failing test in src/slow.test.ts."),
    toolCall("shell-1", "bash", { command: "npm test" }),
    toolResult("shell-1", "bash", Array.from({ length: 50 }, (_, index) => `PASS line ${index}`).join("\n")),
    toolCall("search-1", "grep", { pattern: "needle" }),
    toolResult("search-1", "grep", Array.from({ length: 200 }, (_, index) => `src/a.ts:${index + 1}:needle ${"x".repeat(40)}`).join("\n")),
    toolCall("keep", "read", { filePath: "src/keep.ts" }),
    toolResult("keep", "read", numbered(200, "keep")),
    toolCall("other", "read", { filePath: "src/other.ts" }),
    toolResult("other", "read", numbered(200, "other")),
    toolCall("err", "bash", { command: "false" }),
    toolResult("err", "bash", "Error: still unresolved", "error"),
    textMessage("assistant", "I will keep reading."),
    textMessage("user", "Continue."),
  ];
  const before = measureRequest(messages, [], {}, { tokensPerChar: 0.25 });
  const { outcome } = run(
    messages,
    {
      keepRecent: 2,
      trimToolOutput: false,
      smartCompaction: false,
      budgetTokens: 3000,
      charsPerToken: 4,
      relevanceScoring: true,
    },
    { system: [{ type: "text", text: "system" }] },
  );
  assert.ok(outcome.budgetEvicted > 0, "budget evicts results");
  assert.ok(outcome.budgetChars > 0, "budget savings recorded");
  const after = measureRequest(messages, [{ type: "text", text: "system" }], {}, { tokensPerChar: 0.25 });
  const budgetChars = 3000 * 4;
  assert.ok(
    after.chars <= budgetChars || outcome.budgetOver > 0,
    "the request fits the budget unless only protected content remains",
  );
  assert.match(messages[4].content[0].result.value, /^\[Fox Box: budget|^\[Fox Box: (?:search|path-list)/, "search result evicted first");
  assert.match(messages[8].content[0].result.value, /^\[Fox Box: budget/, "less relevant read evicted");
  assert.doesNotMatch(messages[6].content[0].result.value, /^\[Fox Box: budget/, "relevant read kept ahead of the unrelated read");
  assert.equal(messages[10].content[0].result.value, "Error: still unresolved", "unresolved errors are protected");
  assertNoExpansion(outcome);
  assert.ok(before.chars > after.chars);
}

{
  /* A long error is trimmed by size, but never replaced by a stub. */
  const messages = [
    textMessage("user", "go"),
    toolCall("err", "bash", { command: "false" }),
    toolResult("err", "bash", `Error: ${"x".repeat(20000)}`, "error"),
  ];
  const { outcome } = run(messages, { trimToolOutput: true, maxToolOutput: 2000 });
  assert.ok(messages[2].content[0].result.value.length <= 2000, "an oversized error is capped");
  assert.equal(messages[2].content[0].result.type, "error", "the error type is preserved");
  assert.ok(outcome.fresh > 0, "the error trim is accounted for");
}

{
  /* Grep output that merely starts with a path named error.ts is not an error report. */
  const messages = [
    textMessage("user", "go"),
    toolCall("grep", "grep", { pattern: "needle" }),
    toolResult("grep", "grep", `error.ts:12:${"x".repeat(4000)}`),
  ];
  const { outcome } = run(messages, { trimToolOutput: true, maxToolOutput: 2000 });
  assert.ok(messages[2].content[0].result.value.length <= 2000, "a normal grep hit is trimmed");
  assert.ok(outcome.fresh > 0, "the grep trim is accounted for");
}

{
  /* File text that begins with an error word is content, not a failed read. */
  const messages = [
    textMessage("user", "go"),
    toolCall("notes", "read", { filePath: "docs/errors.md" }),
    toolResult("notes", "read", `Error handling notes ${"x".repeat(4000)}`),
  ];
  const { outcome } = run(messages, { trimToolOutput: true, maxToolOutput: 2000 });
  assert.ok(messages[2].content[0].result.value.length <= 2000, "a read is trimmed even when it starts with 'Error'");
  assert.ok(outcome.fresh > 0, "the read trim is accounted for");
}

{
  /* JSON results are capped too, becoming text because truncated JSON is invalid. */
  const messages = [
    textMessage("user", "go"),
    toolCall("lookup", "mcp_lookup", { query: "x" }),
    { role: "tool", content: [{ type: "tool-result", id: "lookup", name: "mcp_lookup", result: { type: "json", value: { blob: "y".repeat(20000) } } }] },
  ];
  const { outcome } = run(messages, { trimToolOutput: true, maxToolOutput: 2000 });
  assert.equal(messages[2].content[0].result.type, "text", "oversized JSON becomes text");
  assert.ok(messages[2].content[0].result.value.length <= 2000, "JSON is capped by the fresh limit");
  assert.ok(outcome.fresh > 0, "the JSON trim is accounted for");
}

{
  /* A result whose line count no longer matches its read range is trimmed without line claims. */
  const text = Array.from({ length: 100 }, (_, index) => `line ${index} ${"x".repeat(20)}`).join("\n");
  const generic = trimText(text, 300, "old", { tool: "read", input: { filePath: "src/a.ts" }, lineAware: false });
  assert.doesNotMatch(generic.text, /kept lines/, "a compacted read does not claim line ranges");
  assert.ok(generic.text.length <= 300);
}

{
  /* Collapsing an older content result must keep its attached file parts. */
  const page = (id, label) => ({
    role: "tool",
    content: [
      {
        type: "tool-result",
        id,
        name: "webfetch",
        result: {
          type: "content",
          value: [
            { type: "text", text: `${label} ${"p".repeat(1200)}` },
            { type: "file", uri: `https://example.test/${label}.png`, mime: "image/png" },
          ],
        },
      },
    ],
  });
  const messages = [
    textMessage("user", "go"),
    toolCall("old", "webfetch", { url: "https://example.test/page" }),
    page("old", "old"),
    toolCall("new", "webfetch", { url: "https://example.test/page" }),
    page("new", "new"),
  ];
  const { outcome } = run(messages, { collapseDuplicates: true });
  assert.equal(outcome.collapsed, 1, "the older fetch is collapsed");
  const value = messages[2].content[0].result.value;
  assert.equal(value[0].type, "text", "the collapsed result carries the stub text");
  assert.equal(value.some((part) => part.type === "file"), true, "the collapsed result keeps its file part");
}

{
  const messages = [
    textMessage("user", "short"),
    toolCall("small", "bash", { command: "echo" }),
    toolResult("small", "bash", "tiny output"),
  ];
  const { outcome } = run(messages, { budgetTokens: 100000 });
  assert.equal(outcome.budgetEvicted, 0, "a request under budget is untouched");
  assert.equal(outcome.budgetChars, 0);
}

{
  const messages = [
    textMessage("user", "keep the last two messages"),
    toolCall("a", "bash", { command: "echo a" }),
    toolResult("a", "bash", "a".repeat(2000)),
    toolCall("b", "bash", { command: "echo b" }),
    toolResult("b", "bash", "b".repeat(2000)),
  ];
  const { outcome } = run(messages, { budgetTokens: 500, charsPerToken: 4 });
  assert.ok(outcome.budgetEvicted > 0);
  assert.equal(messages[4].content[0].result.value, "b".repeat(2000), "the newest messages are not evicted");
}

/* ------------------------------------------------------------------ */
/*  Normalization                                                     */
/* ------------------------------------------------------------------ */

{
  const defaults = normalizeContextRules({});
  assert.equal(defaults.pathSupersession, true);
  assert.equal(defaults.editReceipts, true);
  assert.equal(defaults.smartCompaction, true);
  assert.equal(defaults.budgetTokens, 0);
  assert.equal(defaults.charsPerToken, 4);
  assert.equal(CONTEXT_RULE_DEFAULTS.pathSupersession, true);
  const clamped = normalizeContextRules({
    keepRecent: 999,
    protectedReads: -4,
    maxToolOutput: 1,
    maxOldToolOutput: 999999,
    receiptMinChars: -10,
    budgetTokens: 99999999,
    charsPerToken: 0,
  });
  assert.equal(clamped.keepRecent, 40);
  assert.equal(clamped.protectedReads, 0);
  assert.equal(clamped.maxToolOutput, 2000);
  assert.equal(clamped.maxOldToolOutput, 64000);
  assert.equal(clamped.receiptMinChars, 200);
  assert.equal(clamped.budgetTokens, 2000000);
  assert.equal(clamped.charsPerToken, 1);
}

/* ------------------------------------------------------------------ */
/*  Random malformed messages                                         */
/* ------------------------------------------------------------------ */

function randomValue(depth = 0) {
  const pick = Math.floor(Math.random() * 7);
  if (depth > 3 || pick === 0) return Math.random() < 0.5 ? null : Math.floor(Math.random() * 100);
  if (pick === 1) return "x".repeat(Math.floor(Math.random() * 300));
  if (pick === 2) return Math.random() < 0.5;
  if (pick === 3) return Array.from({ length: Math.floor(Math.random() * 5) }, () => randomValue(depth + 1));
  if (pick === 4) return { [randomValue(4)?.toString?.() || "k"]: randomValue(depth + 1) };
  if (pick === 5) return "line\n".repeat(Math.floor(Math.random() * 40));
  return `@@ -1,2 +1,2 @@\n-old\n+new`;
}

for (let iteration = 0; iteration < 80; iteration += 1) {
  const messages = [];
  const count = 1 + Math.floor(Math.random() * 8);
  for (let index = 0; index < count; index += 1) {
    const role = ["user", "assistant", "tool"][Math.floor(Math.random() * 3)];
    const content = [];
    const parts = 1 + Math.floor(Math.random() * 3);
    for (let part = 0; part < parts; part += 1) {
      const kind = Math.floor(Math.random() * 6);
      if (kind === 0) content.push({ type: "text", text: randomValue() });
      else if (kind === 1) content.push({ type: "reasoning", text: randomValue() });
      else if (kind === 2) content.push({ type: "tool-call", id: `id-${index}-${part}`, name: "edit", input: randomValue() });
      else if (kind === 3)
        content.push({
          type: "tool-result",
          id: `id-${index - 1}-${part}`,
          name: randomValue()?.toString?.() || "read",
          result: { type: "text", value: randomValue() },
        });
      else if (kind === 4) content.push({ type: "image", data: "z".repeat(30) });
      else content.push({ type: randomValue()?.toString?.() || "unknown", value: randomValue() });
    }
    messages.push({ role, content });
  }
  const event = { messages, system: randomValue(), tools: randomValue() };
  let outcome;
  assert.doesNotThrow(() => {
    outcome = pruneContext(event, {
      rules: normalizeContextRules({
        keepRecent: 2,
        trimToolOutput: true,
        collapseDuplicates: true,
        pathSupersession: true,
        staleReads: true,
        editReceipts: true,
        smartCompaction: true,
        budgetTokens: 500,
        charsPerToken: 4,
        relevanceScoring: true,
      }),
      projectKey,
    });
  }, `iteration ${iteration}`);
  if (outcome) assertNoExpansion(outcome);
}

console.log(
  "Context tests OK: measurement (legacy and current media), path supersession, stale reads, overlap merging, edit receipts, typed compactors, media/source guards, error/JSON caps, budget, relevance, malformed input, fuzz.",
);
