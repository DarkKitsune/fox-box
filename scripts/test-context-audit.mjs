/*
 * Independent adversarial audit of the Fox Box context engine.
 *
 * Run with: node scripts/test-context-audit.mjs
 *
 * Every check asserts the invariant the engine documents (never throw, never
 * expand, exact accounting, hard skill protection). A failing check is a bug
 * report with expected vs actual; the file keeps going so one run lists all
 * of them.
 */

import assert from "node:assert/strict";

import {
  compactCsv,
  compactDiff,
  compactHtml,
  compactJson,
  compactSearchResults,
  compactStackTrace,
  compactTestLog,
  codeSkeleton,
  isSkillPath,
  normalizeContextRules,
  pruneContext,
} from "../plugin/context.js";

const projectKey = "c:/work/demo";
const failures = [];
let checks = 0;

function check(name, fn) {
  checks += 1;
  try {
    fn();
  } catch (error) {
    failures.push({ name, error: String((error && error.message) || error) });
  }
}

/* ------------------------------------------------------------------ */
/*  Fixtures and helpers                                              */
/* ------------------------------------------------------------------ */

function rules(overrides = {}) {
  return normalizeContextRules({
    keepRecent: 2,
    protectedReads: 0,
    trimToolOutput: false,
    collapseDuplicates: false,
    pathSupersession: false,
    staleReads: false,
    mergeReadRanges: true,
    editReceipts: false,
    smartCompaction: false,
    budgetTokens: 0,
    ...overrides,
  });
}

function run(messages, overrides = {}, extra = {}) {
  const event = { messages, system: extra.system || [], tools: extra.tools || {} };
  const outcome = pruneContext(event, { rules: rules(overrides), projectKey });
  return { event, outcome };
}

function toolCall(id, name, input) {
  return { role: "assistant", content: [{ type: "tool-call", id, name, input }] };
}

function toolResult(id, name, value) {
  return {
    role: "tool",
    content: [{ type: "tool-result", id, name, result: { type: "text", value } }],
  };
}

function contentResult(id, name, parts) {
  return {
    role: "tool",
    content: [{ type: "tool-result", id, name, result: { type: "content", value: parts } }],
  };
}

function textMessage(role, text) {
  return { role, content: [{ type: "text", text }] };
}

function numbered(count, prefix = "line") {
  return Array.from(
    { length: count },
    (_, index) => `${index + 1}\t${prefix} ${index + 1} ${"x".repeat(30)}`,
  ).join("\n");
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

function assertNoExpansion(outcome) {
  assert.equal(outcome.errors, 0, `a stage reported an error: ${outcome.lastError || "unknown"}`);
  const before = conversationChars(outcome.before);
  const after = conversationChars(outcome.after);
  assert.ok(after <= before, `pruning expanded the conversation (${before} -> ${after})`);
  assert.equal(
    before - after,
    categorySum(outcome),
    `reported categories (${categorySum(outcome)}) must equal the exact character delta (${before - after})`,
  );
}

function skillPayload(version = 1) {
  return JSON.stringify({
    name: "fox-rules",
    description: "Keep the fox canonical",
    version,
    instructions: `${version}:`.padEnd(5000, "z"),
    allowed_tools: Array.from({ length: 40 }, (_, index) => `tool-${version}-${index}`),
  });
}

/* ------------------------------------------------------------------ */
/*  1. Malformed, model-authored content                              */
/* ------------------------------------------------------------------ */

check("malformed payloads never throw, expand, or break accounting", () => {
  const hugeLine = "y".repeat(120000);
  const messages = [
    { role: "user", content: "plain string content with a broken brace {" },
    {
      role: "assistant",
      content: [
        { type: "text", text: '{"broken": [1, 2,' },
        { type: "text", text: "<root><unclosed attr='x'>" },
        { type: "text", text: "@@ -1,2 +1,2 @@\n+only a plus" },
      ],
    },
    { role: "assistant", content: [{ type: "text", text: "crlf\r\nline\r\n".repeat(40) }] },
    toolResult("nul", "read", "\u0000\u0001 nul and emoji 🦊 \r\n".repeat(60)),
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          id: "not-a-string",
          name: "read",
          result: { type: "text", value: { nested: ["not", "a", "string"] } },
        },
      ],
    },
    {
      role: "tool",
      content: [{ type: "tool-result", id: "nil", name: "read", result: { type: "content", value: null } }],
    },
    { role: "tool", content: [{ type: "tool-result", id: 42, result: null }] },
    { role: "tool", content: [{ type: "tool-result", name: "read" }] },
    { role: "assistant", content: [{ type: "tool-call", name: "read", input: "src/string-input.ts" }] },
    toolCall("huge", "bash", { command: "cat big", blob: "h\r\n".repeat(3000) }),
    toolResult("huge", "bash", hugeLine),
    textMessage("assistant", "done"),
    textMessage("user", "continue"),
  ];
  const { outcome } = run(messages, {
    collapseDuplicates: true,
    trimToolOutput: true,
    pathSupersession: true,
    staleReads: true,
    mergeReadRanges: true,
    editReceipts: true,
    smartCompaction: true,
    budgetTokens: 400,
    maxToolOutput: 2000,
    maxOldToolOutput: 1000,
    receiptMinChars: 200,
  });
  assertNoExpansion(outcome);
});

check("frozen tool-result parts never throw and never lose content", () => {
  const frozenResult = Object.freeze({ type: "text", value: "z".repeat(6000) });
  const messages = [
    toolCall("frozen", "bash", { command: "echo big" }),
    Object.freeze({
      role: "tool",
      content: [Object.freeze({ type: "tool-result", id: "frozen", name: "bash", result: frozenResult })],
    }),
    textMessage("assistant", "pause"),
    textMessage("user", "continue"),
  ];
  assert.doesNotThrow(() =>
    run(messages, { trimToolOutput: true, maxToolOutput: 2000, maxOldToolOutput: 1000 }),
  );
  assert.equal(frozenResult.value.length, 6000, "a frozen result is unchanged");
});

check("circular text and system arrays do not crash measurement", () => {
  const cycle = [];
  cycle.push(cycle);
  const messages = [
    textMessage("user", "hi"),
    { role: "assistant", content: [{ type: "text", text: cycle }] },
  ];
  assert.doesNotThrow(() => run(messages, { trimToolOutput: true }));
  assert.doesNotThrow(() => run([textMessage("user", "hi")], {}, { system: [cycle] }));
});

check("circular edit inputs do not raise outcome.errors", () => {
  const input = { filePath: "src/cycle.ts", content: "line\n".repeat(300) };
  input.changes = [input];
  const messages = [
    toolCall("c1", "edit", input),
    toolResult("c1", "edit", "ok"),
    toolCall("c2", "write", { filePath: "src/cycle.ts", content: "new" }),
    toolResult("c2", "write", "ok"),
    textMessage("assistant", "pause"),
    textMessage("user", "continue"),
  ];
  const { outcome } = run(messages, { editReceipts: true, receiptMinChars: 200 });
  assert.equal(outcome.errors, 0, `expected 0 stage errors, got ${outcome.errors}`);
});

check("duplicate ids do not misattribute one result to another file", () => {
  const alpha = "ALPHA\n" + "a".repeat(1600);
  const beta = "BETA\n" + "b".repeat(1600);
  const messages = [
    toolCall("dup", "read", { filePath: "src/alpha.ts" }),
    toolResult("dup", "read", alpha),
    toolCall("dup", "read", { filePath: "src/beta.ts" }),
    toolResult("dup", "read", beta),
    textMessage("assistant", "pause"),
    textMessage("user", "continue"),
  ];
  const { outcome } = run(messages, { collapseDuplicates: true, keepRecent: 2 });
  assert.equal(messages[1].content[0].result.value, alpha, "the alpha result must not be replaced");
  assert.equal(outcome.collapsed, 0, "ambiguous duplicate ids must not be collapsed");
});

/* ------------------------------------------------------------------ */
/*  2. Path supersession, stale reads, overlap merge                  */
/* ------------------------------------------------------------------ */

check("a newer full read supersedes an older full read", () => {
  const file = numbered(100);
  const messages = [
    toolCall("old", "read", { filePath: "src/a.ts" }),
    toolResult("old", "read", file),
    toolCall("new", "read", { filePath: "src/a.ts" }),
    toolResult("new", "read", file),
  ];
  const { outcome } = run(messages, { pathSupersession: true, keepRecent: 10 });
  assert.match(messages[1].content[0].result.value, /^\[Fox Box: superseded read of src\/a\.ts/);
  assert.equal(messages[3].content[0].result.value, file, "the newest read stays whole");
  assert.equal(outcome.superseded, 1);
  assertNoExpansion(outcome);
});

check("two newer ranges together supersede an older range", () => {
  const full = numbered(120);
  const messages = [
    toolCall("old", "read", { filePath: "src/full.ts", offset: 1, limit: 120 }),
    toolResult("old", "read", full),
    toolCall("part-a", "read", { filePath: "src/full.ts", offset: 1, limit: 60 }),
    toolResult("part-a", "read", full.split("\n").slice(0, 60).join("\n")),
    toolCall("part-b", "read", { filePath: "src/full.ts", offset: 61, limit: 60 }),
    toolResult("part-b", "read", full.split("\n").slice(60).join("\n")),
  ];
  const { outcome } = run(messages, { pathSupersession: true, keepRecent: 10 });
  assert.match(messages[1].content[0].result.value, /^\[Fox Box: superseded/);
  assert.equal(outcome.superseded, 1);
  assertNoExpansion(outcome);
});

check("partial overlap merges only the covered lines", () => {
  const full = numbered(100);
  const messages = [
    toolCall("old", "read", { filePath: "src/partial.ts", offset: 1, limit: 100 }),
    toolResult("old", "read", full),
    toolCall("new", "read", { filePath: "src/partial.ts", offset: 1, limit: 40 }),
    toolResult("new", "read", numbered(40)),
  ];
  const { outcome } = run(messages, { pathSupersession: true, mergeReadRanges: true, keepRecent: 10 });
  const value = messages[1].content[0].result.value;
  assert.match(value, /lines 1–40 already shown by a newer read/);
  assert.match(value, /41\tline 41/);
  assert.match(value, /100\tline 100/);
  assert.equal(outcome.merged, 1);
  assertNoExpansion(outcome);
});

check("disjoint ranges are left alone", () => {
  const messages = [
    toolCall("a", "read", { filePath: "src/disjoint.ts", offset: 1, limit: 20 }),
    toolResult("a", "read", numbered(20)),
    toolCall("b", "read", { filePath: "src/disjoint.ts", offset: 30, limit: 20 }),
    toolResult("b", "read", numbered(20, "second")),
  ];
  const { outcome } = run(messages, { pathSupersession: true, mergeReadRanges: true, keepRecent: 10 });
  assert.equal(outcome.superseded, 0);
  assert.equal(outcome.merged, 0);
  assert.equal(messages[1].content[0].result.value, numbered(20));
});

check("a read range that lies about line count is clamped to the actual text", () => {
  const actual = numbered(20);
  const messages = [
    toolCall("old", "read", { filePath: "src/lie.ts", offset: 1, limit: 500 }),
    toolResult("old", "read", actual),
    toolCall("new", "read", { filePath: "src/lie.ts", offset: 1, limit: 20 }),
    toolResult("new", "read", actual),
    textMessage("assistant", "pause"),
    textMessage("user", "continue"),
  ];
  const { outcome } = run(messages, { pathSupersession: true, keepRecent: 10 });
  assert.match(messages[1].content[0].result.value, /^\[Fox Box: superseded/, "the whole lying range was re-read");
  assertNoExpansion(outcome);
});

check("a failed edit does not invalidate a read", () => {
  const read = numbered(20);
  const messages = [
    toolCall("read", "read", { filePath: "src/failed.ts" }),
    toolResult("read", "read", read),
    toolCall("edit", "edit", { filePath: "src/failed.ts", oldString: "a", newString: "b" }),
    {
      role: "tool",
      content: [
        { type: "tool-result", id: "edit", name: "edit", result: { type: "error", value: "permission denied" } },
      ],
    },
    textMessage("assistant", "pause"),
    textMessage("user", "continue"),
  ];
  const { outcome } = run(messages, { staleReads: true, keepRecent: 10 });
  assert.equal(messages[1].content[0].result.value, read);
  assert.equal(outcome.stale, 0);
});

check("a read after an edit is current, and a read before it is stale", () => {
  const read = numbered(20);
  const messages = [
    toolCall("before", "read", { filePath: "src/after.ts" }),
    toolResult("before", "read", read),
    toolCall("edit", "write", { filePath: "src/after.ts", content: "new" }),
    toolResult("edit", "write", "written"),
    toolCall("after", "read", { filePath: "src/after.ts" }),
    toolResult("after", "read", read),
  ];
  const { outcome } = run(messages, { staleReads: true, keepRecent: 10 });
  assert.match(messages[1].content[0].result.value, /^\[Fox Box: stale read/);
  assert.equal(messages[5].content[0].result.value, read);
  assert.equal(outcome.stale, 1);
});

check("backslash and case differences normalize to the same path", () => {
  if (process.platform !== "win32" && process.platform !== "darwin") return;
  const read = numbered(20);
  const messages = [
    toolCall("read", "read", { filePath: "src\\Case\\Path.ts" }),
    toolResult("read", "read", read),
    toolCall("edit", "write", { filePath: "SRC/CASE/PATH.TS", content: "x" }),
    toolResult("edit", "write", "ok"),
    textMessage("assistant", "pause"),
    textMessage("user", "continue"),
  ];
  const { outcome } = run(messages, { staleReads: true, keepRecent: 10 });
  assert.equal(outcome.stale, 1);
});

check("a leading a/ or b/ is not stripped from a real project path", () => {
  const alpha = numbered(40, "alpha");
  const beta = numbered(40, "beta");
  const messages = [
    toolCall("r1", "read", { filePath: "a/thing.ts" }),
    toolResult("r1", "read", alpha),
    toolCall("r2", "read", { filePath: "thing.ts" }),
    toolResult("r2", "read", beta),
    textMessage("assistant", "pause"),
    textMessage("user", "continue"),
  ];
  const { outcome } = run(messages, { pathSupersession: true, keepRecent: 10 });
  assert.equal(messages[1].content[0].result.value, alpha, "a/thing.ts and thing.ts are different files");
  assert.equal(outcome.superseded, 0);
});

/* ------------------------------------------------------------------ */
/*  3. Edit receipts                                                  */
/* ------------------------------------------------------------------ */

check("the latest edit per file is kept and older large inputs become receipts", () => {
  const oldContent = "line\n".repeat(400);
  const messages = [
    toolCall("edit-old", "write", { filePath: "src/one.ts", content: oldContent }),
    toolResult("edit-old", "write", "written"),
    toolCall("edit-new", "edit", {
      filePath: "src/one.ts",
      oldString: "a".repeat(300),
      newString: "b".repeat(900),
    }),
    toolResult("edit-new", "edit", "edited"),
    toolCall("edit-other", "write", { filePath: "src/two.ts", content: oldContent }),
    toolResult("edit-other", "write", "written"),
  ];
  const { outcome } = run(messages, { editReceipts: true, receiptMinChars: 200 });
  const receipt = messages[0].content[0].input;
  assert.equal(receipt.foxBoxReceipt, "historical edit input compacted before sending");
  assert.equal(receipt.path, "src/one.ts");
  assert.match(receipt.change, /^\+\d+ -\d+$/);
  assert.match(receipt.hash, /^[0-9a-f]{8}$/);
  assert.equal(messages[2].content[0].input.newString.length, 900, "the latest edit stays whole");
  assert.equal(messages[4].content[0].input.content, oldContent, "the latest edit for another file stays whole");
  assert.equal(outcome.receipts, 1);
  assertNoExpansion(outcome);
});

check("a string apply_patch input yields a path, change counts, and one hunk", () => {
  const patch = [
    "*** Begin Patch",
    "*** Update File: src/patch.ts",
    "@@ -1,20 +1,20 @@",
    ...Array.from({ length: 20 }, (_, index) => `-old line ${index}`),
    ...Array.from({ length: 20 }, (_, index) => `+new line ${index}`),
    "*** End Patch",
  ].join("\n");
  const padded = `${patch}\n${"context ".repeat(200)}`;
  const messages = [
    toolCall("patch-old", "apply_patch", padded),
    toolResult("patch-old", "apply_patch", "ok"),
    toolCall("patch-new", "write", { filePath: "src/patch.ts", content: "new" }),
    toolResult("patch-new", "write", "ok"),
    textMessage("assistant", "pause"),
    textMessage("user", "continue"),
  ];
  const { outcome } = run(messages, { editReceipts: true, receiptMinChars: 200 });
  const receipt = messages[0].content[0].input;
  assert.equal(receipt.path, "src/patch.ts");
  assert.equal(receipt.change, "+20 -20");
  assert.equal(receipt.hunks, 1);
  assert.equal(outcome.receipts, 1);
  assertNoExpansion(outcome);
});

check("a failed edit is never turned into a receipt", () => {
  const big = "line\n".repeat(400);
  const messages = [
    toolCall("bad", "write", { filePath: "src/bad.ts", content: big }),
    toolResult("bad", "write", "Error: denied"),
    toolCall("good", "write", { filePath: "src/bad.ts", content: "new" }),
    toolResult("good", "write", "ok"),
    textMessage("assistant", "pause"),
    textMessage("user", "continue"),
  ];
  const { outcome } = run(messages, { editReceipts: true, receiptMinChars: 200 });
  assert.equal(messages[0].content[0].input.content, big);
  assert.equal(outcome.receipts, 0);
});

check("an edits array of three edits reports three hunks, not six", () => {
  const big = "line\n".repeat(500);
  const input = {
    filePath: "src/hunks.ts",
    edits: [
      { oldString: "a".repeat(400), newString: big },
      { oldString: "c".repeat(400), newString: big },
      { oldString: "d".repeat(400), newString: big },
    ],
  };
  const messages = [
    toolCall("multi", "multiedit", input),
    toolResult("multi", "multiedit", "ok"),
    toolCall("new", "write", { filePath: "src/hunks.ts", content: "new" }),
    toolResult("new", "write", "ok"),
    textMessage("assistant", "pause"),
    textMessage("user", "continue"),
  ];
  const { outcome } = run(messages, { editReceipts: true, receiptMinChars: 200 });
  const receipt = messages[0].content[0].input;
  assert.equal(receipt.hunks, 3, `expected 3 hunks for 3 edits, got ${receipt.hunks}`);
  assertNoExpansion(outcome);
});

check("the receipt hash is deterministic and distinguishes payloads", () => {
  const build = (text) => [
    toolCall("e1", "write", { filePath: "src/hash.ts", content: text }),
    toolResult("e1", "write", "ok"),
    toolCall("e2", "write", { filePath: "src/hash.ts", content: "new" }),
    toolResult("e2", "write", "ok"),
    textMessage("assistant", "pause"),
    textMessage("user", "continue"),
  ];
  const content = "hashme\n".repeat(300);
  const first = run(build(content), { editReceipts: true, receiptMinChars: 200 }).event;
  const second = run(build(content), { editReceipts: true, receiptMinChars: 200 }).event;
  const other = run(build("different\n".repeat(300)), { editReceipts: true, receiptMinChars: 200 }).event;
  assert.equal(first.messages[0].content[0].input.hash, second.messages[0].content[0].input.hash);
  assert.notEqual(first.messages[0].content[0].input.hash, other.messages[0].content[0].input.hash);
});

/* ------------------------------------------------------------------ */
/*  4. Type compactors                                                */
/* ------------------------------------------------------------------ */

function assertCompaction(original, output, name) {
  assert.ok(typeof output === "string", `${name} should compact this input`);
  assert.ok(output.length < original.length, `${name} expanded the input (${original.length} -> ${output.length})`);
  return output;
}

check("test logs keep failures and the summary, drop passing noise", () => {
  const log = [
    "> npm test",
    "PASS src/alpha.test.ts",
    ...Array.from({ length: 50 }, (_, index) => `  ✓ passes case ${index + 1} ${"x".repeat(12)}`),
    "FAIL src/beta.test.ts",
    "  ● beta › adds numbers",
    "    Expected: 4",
    "    Received: 5",
    ...Array.from({ length: 30 }, (_, index) => `  ✓ passes later ${index + 1} ${"x".repeat(12)}`),
    "Tests:       1 failed, 80 passed, 81 total",
    "Time:        2.31 s",
  ].join("\n");
  const out = assertCompaction(log, compactTestLog(log), "test-log");
  assert.match(out, /FAIL src\/beta\.test\.ts/);
  assert.match(out, /Expected: 4/);
  assert.match(out, /Tests:       1 failed/);
  assert.match(out, /passing log line/);
  assert.equal(compactTestLog(out), null, "compaction is idempotent");
});

check("stack traces keep project frames and errors, collapse library frames", () => {
  const stack = [
    "Error: boom",
    "Caused by: inner failure",
    "    at run (C:\\Work\\Demo\\src\\core.ts:12:3)",
    ...Array.from(
      { length: 40 },
      (_, index) => `    at library (C:\\Work\\Demo\\node_modules\\pkg\\index.js:${index + 1}:2)`,
    ),
    "    at load (C:\\Work\\Demo\\src\\loader.ts:40:1)",
    "    at main (C:\\Work\\Demo\\src\\main.ts:9:7)",
  ].join("\n");
  const out = assertCompaction(stack, compactStackTrace(stack), "stack-trace");
  assert.match(out, /Error: boom/);
  assert.match(out, /Caused by: inner failure/);
  assert.match(out, /src\\core\.ts:12:3/);
  assert.match(out, /src\\loader\.ts:40:1/);
  assert.match(out, /library frame/);
});

check("diffs keep changed lines and hunks, drop context (including CRLF)", () => {
  const diff = [
    "diff --git a/src/a.ts b/src/a.ts",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1,8 +1,9 @@",
    ...Array.from({ length: 40 }, (_, index) => ` context filler ${index + 1} ${"c".repeat(20)}`),
    "-old line",
    "+new line",
    " context three",
    "@@ -20,3 +21,3 @@",
    " keep",
    "-removed",
    "+replaced",
  ].join("\r\n");
  const out = assertCompaction(diff, compactDiff(diff), "diff");
  assert.match(out, /^@@ -1,8 \+1,9 @@/m);
  assert.match(out, /^\+new line/m);
  assert.match(out, /^-old line/m);
  assert.match(out, /diff context line/);
  assert.equal(compactDiff("@@ broken without a closing marker"), null);
});

check("grep and glob output is grouped with representative lines", () => {
  const grep = Array.from({ length: 5 }, (_, file) =>
    Array.from(
      { length: 8 },
      (_, line) => `src/file-${file}.ts:${line + 1}:const value${file}_${line} = ${line};`,
    ),
  )
    .flat()
    .join("\n");
  const grouped = assertCompaction(grep, compactSearchResults(grep, "search"), "search");
  assert.match(grouped, /src\/file-0\.ts \(8 matches\)/);
  assert.match(grouped, /more in this file/);

  const glob = Array.from({ length: 40 }, (_, index) => `src/group-${index % 4}/file-${index}.ts`).join("\n");
  const paths = assertCompaction(glob, compactSearchResults(glob, "search"), "path-list");
  assert.match(paths, /src\/group-0\/ \(10 files\)/);
  assert.match(paths, /path\(s\) not shown/);
});

check("JSON and CSV compact to shape while malformed input is left alone", () => {
  const value = {
    users: Array.from({ length: 200 }, (_, index) => ({ id: index, name: `user-${index}` })),
    total: 200,
  };
  const text = JSON.stringify(value);
  const json = assertCompaction(text, compactJson(text), "JSON");
  assert.match(json, /"items":200/);
  assert.match(json, /"shape":"object"/);
  assert.equal(compactJson("{not json"), null);
  assert.equal(compactJson("[1,2,3]"), null);

  const csv = ["id,name,score", ...Array.from({ length: 60 }, (_, index) => `${index},user-${index},${index * 2}`)].join(
    "\n",
  );
  const table = assertCompaction(csv, compactCsv(csv), "CSV");
  assert.match(table, /id,name,score/);
  assert.match(table, /CSV row\(s\) omitted/);
  assert.match(table, /59,user-59,118/);
  assert.equal(compactCsv("a,b\n1,2\n3"), null);
});

check("HTML keeps title, headings and text while removing scripts and navigation", () => {
  const html = [
    "<!doctype html><html><head><title>Fox Notes</title><style>.x{color:red}</style></head>",
    "<body><nav>menu menu menu menu</nav>",
    "<h1>Main heading</h1><p>This is the first useful paragraph with enough text to survive the stripper.</p>",
    "<h2>Second heading</h2><p>This is the second useful paragraph with enough text to survive the stripper.</p>",
    `<script>${"alert('x');".repeat(200)}</script>`,
    `<footer>${"footer ".repeat(200)}</footer></body></html>`,
  ].join("\n");
  const out = assertCompaction(html, compactHtml(html, "web"), "web");
  assert.match(out, /Title: Fox Notes/);
  assert.match(out, /# Main heading/);
  assert.match(out, /first useful paragraph/);
  assert.doesNotMatch(out, /alert\('x'\)/);
  assert.doesNotMatch(out, /menu menu menu/);
});

check("code skeleton keeps imports and declarations and elides bodies", () => {
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
  const out = assertCompaction(source, codeSkeleton(source, "src/big.ts"), "code-skeleton");
  assert.match(out, /import \{ thing \}/);
  assert.match(out, /export interface Shape/);
  assert.match(out, /export function fn59/);
  assert.match(out, /code body line/);
  assert.equal(codeSkeleton("const x = 1;", "src/tiny.ts"), null);
  assert.equal(codeSkeleton(source, "src/notes.md"), null);
});

check("no compactor expands or throws on malformed input", () => {
  const inputs = [
    "",
    "   ",
    "{",
    "[",
    "<div",
    "@@",
    "\u0000\u0001🦊\r\n".repeat(500),
    "x".repeat(120000),
    Array.from({ length: 40 }, (_, index) => `${index}:`).join("\n"),
  ];
  const compactors = [
    (text) => compactTestLog(text),
    (text) => compactStackTrace(text),
    (text) => compactDiff(text),
    (text) => compactSearchResults(text, "search"),
    (text) => compactJson(text),
    (text) => compactCsv(text),
    (text) => compactHtml(text, "web"),
    (text) => codeSkeleton(text, "src/file.ts"),
  ];
  for (const input of inputs) {
    for (const compactor of compactors) {
      const output = compactor(input);
      if (output !== null) {
        assert.ok(output.length < input.length, "a compactor expanded malformed input");
      }
    }
  }
});

/* ------------------------------------------------------------------ */
/*  5. Skill protection (hard requirement)                            */
/* ------------------------------------------------------------------ */

check("every skill-bearing path is recognized", () => {
  for (const path of [
    "SKILL.md",
    "skills/foo/SKILL.md",
    "skills/foo/config.json",
    "skills/foo/schema.json",
    "skill/foo/notes.md",
    ".opencode/skills/foo/manifest.json",
    ".opencode/skill/foo/rules.md",
    "skill.json",
    "my-skill.json",
    "C:\\Work\\Demo\\skills\\fox\\SKILL.md",
  ]) {
    assert.equal(isSkillPath(path), true, `${path} must be protected`);
  }
  for (const path of ["src/skill-parser.ts", "src/config.json", "docs/readme.md"]) {
    assert.equal(isSkillPath(path), false, `${path} is not a skill path`);
  }
});

check("a skill JSON read survives compaction, caps, and a tight budget", () => {
  const payload = skillPayload(1);
  const messages = [
    textMessage("user", "Load the skill, then continue."),
    toolCall("skill", "read", { filePath: "skills/fox/SKILL.md" }),
    toolResult("skill", "read", payload),
    textMessage("assistant", "Loaded."),
    textMessage("user", "Continue."),
  ];
  const { outcome } = run(
    messages,
    {
      protectSkills: true,
      collapseDuplicates: true,
      trimToolOutput: true,
      maxToolOutput: 2000,
      smartCompaction: true,
      budgetTokens: 300,
    },
    { system: [{ type: "text", text: "S".repeat(20000) }] },
  );
  assert.equal(messages[2].content[0].result.value, payload, "the only skill copy must stay whole");
  assert.equal(outcome.compacted, 0);
  assert.equal(outcome.budgetEvicted, 0, "the budget cannot evict the only skill copy");
  assert.ok(outcome.budgetOver > 0, "the request is legitimately over budget with protected content left");
  assertNoExpansion(outcome);
});

check("root SKILL.md, singular skill/ folders, and .opencode skills are protected", () => {
  const cases = [
    ["SKILL.md", skillPayload(2)],
    ["skill/fox/notes.md", numbered(120, "skill-note")],
    [".opencode/skills/fox/manifest.json", JSON.stringify({ skill: "fox", body: "m".repeat(4000) })],
  ];
  for (const [filePath, payload] of cases) {
    const messages = [
      toolCall("s", "read", { filePath }),
      toolResult("s", "read", payload),
      textMessage("assistant", "Loaded."),
      textMessage("user", "Continue."),
    ];
    run(messages, {
      trimToolOutput: true,
      maxToolOutput: 1000,
      smartCompaction: true,
      budgetTokens: 300,
    });
    assert.equal(messages[1].content[0].result.value, payload, `${filePath} must stay whole`);
  }
});

check("re-reading a skill may prune the older copy but keeps the newest whole", () => {
  const first = skillPayload(1);
  const second = skillPayload(2);
  const messages = [
    toolCall("skill-old", "read", { filePath: "skills/fox/SKILL.md" }),
    toolResult("skill-old", "read", first),
    toolCall("skill-new", "read", { filePath: "skills/fox/SKILL.md" }),
    toolResult("skill-new", "read", second),
    textMessage("assistant", "Updated."),
    textMessage("user", "Continue."),
  ];
  const { outcome } = run(messages, {
    keepRecent: 2,
    collapseDuplicates: true,
    trimToolOutput: true,
  });
  assert.match(messages[1].content[0].result.value, /^\[Fox Box: duplicate read of skills\/fox\/SKILL\.md collapsed/);
  assert.equal(messages[3].content[0].result.value, second);
  assert.equal(outcome.collapsed, 1);
});

check("editing a skill without a re-read keeps the only copy", () => {
  const payload = skillPayload(3);
  const messages = [
    toolCall("skill-read", "read", { filePath: "skills/fox/SKILL.md" }),
    toolResult("skill-read", "read", payload),
    toolCall("skill-edit", "write", { filePath: "skills/fox/SKILL.md", content: "updated" }),
    toolResult("skill-edit", "write", "written"),
  ];
  const { outcome } = run(messages, { keepRecent: 2, staleReads: true });
  assert.equal(messages[1].content[0].result.value, payload);
  assert.equal(outcome.stale, 0);
});

check("a partial re-read of a skill does not leave the only full copy merged away", () => {
  const full = numbered(100, "skill");
  const partial = full.split("\n").slice(0, 5).join("\n");
  const messages = [
    toolCall("full", "read", { filePath: "skills/fox/SKILL.md" }),
    toolResult("full", "read", full),
    toolCall("partial", "read", { filePath: "skills/fox/SKILL.md", offset: 1, limit: 5 }),
    toolResult("partial", "read", partial),
    textMessage("assistant", "pause"),
    textMessage("user", "continue"),
  ];
  run(messages, { pathSupersession: true, mergeReadRanges: true, keepRecent: 10 });
  assert.equal(
    messages[1].content[0].result.value,
    full,
    "the only complete SKILL.md copy must not be partially merged away",
  );
  assert.equal(messages[3].content[0].result.value, partial);
});

check("a partial re-read after an edit does not stale-stub the only full skill copy", () => {
  const full = numbered(100, "skill");
  const partial = full.split("\n").slice(0, 5).join("\n");
  const messages = [
    toolCall("full", "read", { filePath: "skills/fox/SKILL.md" }),
    toolResult("full", "read", full),
    toolCall("edit", "edit", { filePath: "skills/fox/SKILL.md", oldString: "a", newString: "b" }),
    toolResult("edit", "edit", "ok"),
    toolCall("partial", "read", { filePath: "skills/fox/SKILL.md", offset: 1, limit: 5 }),
    toolResult("partial", "read", partial),
    textMessage("assistant", "pause"),
    textMessage("user", "continue"),
  ];
  const { outcome } = run(messages, { staleReads: true, keepRecent: 10 });
  assert.equal(
    messages[1].content[0].result.value,
    full,
    "the only complete SKILL.md copy must survive a partial re-read after an edit",
  );
  assert.equal(messages[5].content[0].result.value, partial);
  assert.equal(outcome.stale, 0);
});

/* ------------------------------------------------------------------ */
/*  6. Budget, errors, relevance                                      */
/* ------------------------------------------------------------------ */

check("the newest messages are never evicted", () => {
  const messages = [
    textMessage("user", "keep the last two messages"),
    toolCall("a", "bash", { command: "echo a" }),
    toolResult("a", "bash", "a".repeat(3000)),
    toolCall("b", "bash", { command: "echo b" }),
    toolResult("b", "bash", "b".repeat(3000)),
  ];
  const { outcome } = run(messages, { budgetTokens: 500 });
  assert.ok(outcome.budgetEvicted > 0);
  assert.equal(messages[4].content[0].result.value, "b".repeat(3000));
});

check("unresolved errors and the latest protected read survive budget pressure", () => {
  const protectedRead = numbered(100, "pinned");
  const otherRead = numbered(100, "other");
  const messages = [
    textMessage("user", "x".repeat(100)),
    toolCall("pinned", "read", { filePath: "src/pinned/core.ts" }),
    toolResult("pinned", "read", protectedRead),
    toolCall("other", "read", { filePath: "src/other.ts" }),
    toolResult("other", "read", otherRead),
    toolCall("err", "bash", { command: "false" }),
    toolResult("err", "bash", "Error: still unresolved"),
    textMessage("assistant", "pause"),
    textMessage("user", "continue"),
  ];
  const { outcome } = run(
    messages,
    { budgetTokens: 300, protectPaths: "src/pinned/**" },
    { system: [{ type: "text", text: "S".repeat(6000) }] },
  );
  assert.equal(messages[2].content[0].result.value, protectedRead, "the latest protected read stays whole");
  assert.equal(messages[6].content[0].result.value, "Error: still unresolved", "unresolved errors stay whole");
  assert.ok(outcome.budgetEvicted > 0);
  assertNoExpansion(outcome);
});

check("relevance evicts the unrelated read before the mentioned path", () => {
  const keep = numbered(150, "keep");
  const other = numbered(150, "other");
  const messages = [
    textMessage("user", "Please inspect src/keep.ts carefully."),
    toolCall("keep", "read", { filePath: "src/keep.ts" }),
    toolResult("keep", "read", keep),
    toolCall("other", "read", { filePath: "src/other.ts" }),
    toolResult("other", "read", other),
    textMessage("assistant", "I will keep reading."),
    textMessage("user", "Continue with src/keep.ts."),
    textMessage("assistant", "Working."),
  ];
  const { outcome } = run(messages, {
    keepRecent: 2,
    budgetTokens: 1800,
    charsPerToken: 4,
    relevanceScoring: true,
  });
  assert.ok(outcome.budgetEvicted > 0);
  assert.equal(messages[2].content[0].result.value, keep, "the mentioned path is kept ahead of the unrelated read");
  assert.notEqual(messages[4].content[0].result.value, other, "the unrelated read is evicted");
  assertNoExpansion(outcome);
});

check("a request under budget is untouched", () => {
  const messages = [
    textMessage("user", "short"),
    toolCall("small", "bash", { command: "echo" }),
    toolResult("small", "bash", "tiny output"),
  ];
  const { outcome } = run(messages, { budgetTokens: 100000 });
  assert.equal(outcome.budgetEvicted, 0);
  assert.equal(outcome.budgetChars, 0);
});

/* ------------------------------------------------------------------ */
/*  7. Exact accounting on a combined pipeline                        */
/* ------------------------------------------------------------------ */

check("a combined pipeline attributes every removed character exactly once", () => {
  const full = numbered(100);
  const testLog = [
    "> npm test",
    "PASS src/alpha.test.ts",
    ...Array.from({ length: 60 }, (_, index) => `  ✓ passes case ${index + 1} ${"x".repeat(15)}`),
    "FAIL src/beta.test.ts",
    "    Expected: 4",
    "    Received: 5",
    "Tests:       1 failed, 60 passed",
  ].join("\n");
  const oldWrite = "line\n".repeat(400);
  const messages = [
    textMessage("user", "Inspect src/keep.ts and the failing test in src/beta.test.ts. Error: boom"),
    toolCall("dup1", "read", { filePath: "src/dup.ts" }),
    toolResult("dup1", "read", full),
    toolCall("dup2", "read", { filePath: "src/dup.ts" }),
    toolResult("dup2", "read", full),
    toolCall("part-old", "read", { filePath: "src/partial.ts", offset: 1, limit: 100 }),
    toolResult("part-old", "read", full),
    toolCall("part-new", "read", { filePath: "src/partial.ts", offset: 1, limit: 40 }),
    toolResult("part-new", "read", numbered(40)),
    toolCall("stale", "read", { filePath: "src/stale.ts" }),
    toolResult("stale", "read", numbered(50, "stale")),
    toolCall("edit", "edit", { filePath: "src/stale.ts", oldString: "a", newString: "b" }),
    toolResult("edit", "edit", "ok"),
    toolCall("log", "bash", { command: "npm test" }),
    toolResult("log", "bash", testLog),
    toolCall("big-old", "write", { filePath: "src/big.ts", content: oldWrite }),
    toolResult("big-old", "write", "ok"),
    toolCall("big-new", "write", { filePath: "src/big.ts", content: "new" }),
    toolResult("big-new", "write", "ok"),
    toolCall("skill", "read", { filePath: "skills/fox/SKILL.md" }),
    toolResult("skill", "read", skillPayload(4)),
    toolCall("fresh", "read", { filePath: "src/fresh.ts" }),
    toolResult("fresh", "read", numbered(300, "fresh")),
    textMessage("assistant", "Working."),
    textMessage("user", "Continue."),
  ];
  const { outcome } = run(messages, {
    keepRecent: 2,
    protectedReads: 1,
    collapseDuplicates: true,
    trimToolOutput: true,
    pathSupersession: true,
    staleReads: true,
    mergeReadRanges: true,
    editReceipts: true,
    smartCompaction: true,
    budgetTokens: 600,
    maxToolOutput: 4000,
    maxOldToolOutput: 1000,
    receiptMinChars: 200,
    relevanceScoring: true,
  });
  assertNoExpansion(outcome);
  assert.ok(
    outcome.collapsed + outcome.superseded + outcome.stale + outcome.compacted + outcome.receipts + outcome.budgetEvicted > 0,
    "the combined fixture actually pruned something",
  );
});

/* ------------------------------------------------------------------ */
/*  Seeded fuzz: every input stays safe and exactly accounted          */
/* ------------------------------------------------------------------ */

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function randomValue(random, depth = 0) {
  const pick = Math.floor(random() * 8);
  if (depth > 3 || pick === 0) return random() < 0.5 ? null : Math.floor(random() * 100);
  if (pick === 1) return "x".repeat(Math.floor(random() * 300));
  if (pick === 2) return random() < 0.5;
  if (pick === 3) return Array.from({ length: Math.floor(random() * 4) }, () => randomValue(random, depth + 1));
  if (pick === 4) return { ["k" + Math.floor(random() * 5)]: randomValue(random, depth + 1) };
  if (pick === 5) return "line\n".repeat(Math.floor(random() * 40));
  if (pick === 6) return "@@ -1,2 +1,2 @@\n-old\n+new";
  return "\u0000🦊\r\n".repeat(Math.floor(random() * 30));
}

check("seeded fuzz never throws, errors, expands, or loses accounting", () => {
  const random = seeded(0xf0b0);
  for (let iteration = 0; iteration < 120; iteration += 1) {
    const messages = [];
    const count = 1 + Math.floor(random() * 8);
    for (let index = 0; index < count; index += 1) {
      const role = ["user", "assistant", "tool"][Math.floor(random() * 3)];
      const content = [];
      const parts = 1 + Math.floor(random() * 3);
      for (let part = 0; part < parts; part += 1) {
        const kind = Math.floor(random() * 7);
        if (kind === 0) content.push({ type: "text", text: randomValue(random) });
        else if (kind === 1) content.push({ type: "reasoning", text: randomValue(random) });
        else if (kind === 2) {
          content.push({
            type: "tool-call",
            id: `id-${index}-${part}`,
            name: ["read", "edit", "bash", "grep"][Math.floor(random() * 4)],
            input: randomValue(random),
          });
        } else if (kind === 3) {
          content.push({
            type: "tool-result",
            id: `id-${index - 1}-${part}`,
            name: ["read", "edit", "bash", "grep"][Math.floor(random() * 4)],
            result: { type: "text", value: randomValue(random) },
          });
        } else if (kind === 4) {
          content.push({
            type: "tool-result",
            id: `id-${index - 1}-${part}`,
            name: "read",
            result: {
              type: "content",
              value: Array.from({ length: 1 + Math.floor(random() * 8) }, (_, item) => ({
                type: "text",
                text: `part-${item}: ${"p".repeat(Math.floor(random() * 400))}`,
              })),
            },
          });
        } else if (kind === 5) content.push({ type: "image", data: "z".repeat(30) });
        else content.push({ type: "custom", value: randomValue(random, 2) });
      }
      messages.push({ role, content });
    }
    const event = { messages, system: randomValue(random), tools: randomValue(random) };
    let outcome;
    assert.doesNotThrow(() => {
      outcome = pruneContext(event, {
        rules: normalizeContextRules({
          keepRecent: 2,
          trimToolOutput: true,
          collapseDuplicates: true,
          pathSupersession: true,
          staleReads: true,
          mergeReadRanges: true,
          editReceipts: true,
          smartCompaction: true,
          budgetTokens: 500,
          charsPerToken: 4,
          relevanceScoring: true,
        }),
        projectKey,
      });
    }, `iteration ${iteration} threw`);
    assertNoExpansion(outcome);
  }
});

/* ------------------------------------------------------------------ */

if (failures.length) {
  console.error(`Context audit FAILED: ${failures.length} failing check(s) of ${checks}.`);
  for (const failure of failures) {
    console.error(`\nFAIL ${failure.name}\n  ${failure.error}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Context audit OK: ${checks} checks passed.`);
}
