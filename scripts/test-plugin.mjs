import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "foxbox-plugin-"));
process.env.FOXBOX_HOME = temp;
const PROJECT_DIRECTORY = "C:\\Work\\Demo";

/* Must match plugin/index.js statusFileName and the panel's statusFileKey. */
function statusFileName(directory) {
  const key = String(directory || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase() || "global";
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `status-${(hash >>> 0).toString(36)}.json`;
}

function statusPath(home) {
  return path.join(home, statusFileName(PROJECT_DIRECTORY));
}

const config = {
  version: 2,
  powers: {
    context: {
      enabled: true,
      protectSkills: true,
      keepRecent: 4,
      trimToolOutput: true,
      maxToolOutput: 2000,
      maxOldToolOutput: 1000,
      protectPaths: "src/pinned/**",
      briefs: {
        "c:/work/demo": "Keep the fox canonical and the core loop small.",
      },
    },
    model: {
      enabled: true,
      applyToQwenOnly: true,
      temperature: 0.7,
      topP: 0.8,
      topK: 20,
      presencePenalty: 1.5,
      frequencyPenalty: 0,
      maxOutputTokens: 2048,
      capOutput: true,
      reasoningEffort: "medium",
      contractEnabled: true,
      contract: "CONTRACT: work in small verified steps.",
      hideTools: ["task", "webfetch"],
    },
  },
};

await fs.writeFile(path.join(temp, "config.json"), JSON.stringify(config, null, 2));

const hooks = {
  context: null,
  tool: null,
  commands: [],
};
let compacted = null;

const ctx = {
  location: { directory: PROJECT_DIRECTORY },
  session: {
    hook: async (name, callback) => {
      hooks[name] = callback;
      return { dispose: async () => {} };
    },
    compact: async (input) => {
      compacted = input;
    },
  },
  tool: {
    hook: async (name, callback) => {
      hooks[name === "execute.after" ? "tool" : name] = callback;
      return { dispose: async () => {} };
    },
  },
  command: {
    transform: async (callback) => {
      const editor = {
        add: (command) => hooks.commands.push(command),
      };
      callback(editor);
      return { dispose: async () => {} };
    },
  },
};

const plugin = await import(pathToFileURL(path.join(root, "plugin", "index.js")).href);
assert.equal(plugin.default.id, "fox-box");
const cleanup = await plugin.default.setup(ctx);
assert.equal(typeof hooks.context, "function", "context hook registered");
assert.equal(hooks.tool, null, "tool results are trimmed on the request, not at execution");
assert.equal(hooks.commands.length, 1, "compaction command registered");

const big = (label) => `${label}:${"x".repeat(5000)}`;
const toolResult = (id, name, value) => ({
  role: "tool",
  content: [
    {
      type: "tool-result",
      id,
      name,
      result: { type: "text", value },
    },
  ],
});

const contentResult = (id, name, parts) => ({
  role: "tool",
  content: [
    {
      type: "tool-result",
      id,
      name,
      result: { type: "content", value: parts },
    },
  ],
});

/*
 * Independent character counter for the fixtures below. The plugin's counter is the
 * implementation under test, so the test must not reuse it. Every fixture input has
 * one key, which makes plain JSON stringify agree with the plugin's stable form.
 */
function contextChars(messages) {
  let total = 0;
  for (const message of messages) {
    if (!message || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (!part || typeof part !== "object") continue;
      if (part.type === "text" && typeof part.text === "string") {
        total += part.text.length;
      } else if (part.type === "tool-result") {
        if (part.result?.type === "text" && typeof part.result.value === "string") {
          total += part.result.value.length;
        } else if (part.result?.type === "content" && Array.isArray(part.result.value)) {
          for (const item of part.result.value) {
            if (item && item.type === "text" && typeof item.text === "string") total += item.text.length;
          }
        }
      } else if (part.type === "tool-call" && part.input !== undefined && part.input !== null) {
        total += JSON.stringify(part.input).length;
      }
    }
  }
  return total;
}

const messages = [
  {
    role: "assistant",
    content: [{ type: "tool-call", id: "skill", name: "read", input: { filePath: "skills/foo/SKILL.md" } }],
  },
  toolResult("skill", "read", big("skill")),
  {
    role: "assistant",
    content: [{ type: "tool-call", id: "bash", name: "bash", input: { command: "npm test" } }],
  },
  toolResult("bash", "bash", big("bash")),
  {
    role: "assistant",
    content: [{ type: "tool-call", id: "pinned", name: "read", input: { filePath: "src/pinned/core.ts" } }],
  },
  toolResult("pinned", "read", big("pinned")),
  { role: "assistant", content: [{ type: "text", text: "Checking." }] },
  toolResult("recent", "read", big("recent")),
  { role: "user", content: [{ type: "text", text: "Continue." }] },
  { role: "assistant", content: [{ type: "text", text: "Working." }] },
];

const event = {
  sessionID: "ses_test",
  model: { providerID: "strata", id: "unsloth-ud-iq4_xs-v31" },
  system: [],
  messages,
  tools: {
    task: { description: "subagents", input: {} },
    subagent: { description: "v2 subagents", input: {} },
    webfetch: { description: "web", input: {} },
    read: { description: "read", input: {} },
  },
  options: {},
};

const beforeMainMessages = structuredClone(messages);
const mainOriginalChars = contextChars(beforeMainMessages);

await hooks.context(event);
const mainKeptChars = contextChars(messages);
assert.ok(mainOriginalChars > mainKeptChars, "the main fixture actually shrank");

const systemText = event.system.map((part) => part.text).join("\n");
assert.match(systemText, /CONTRACT: work in small verified steps/, "contract injected");
assert.match(systemText, /Keep the fox canonical/, "project brief injected");
assert.equal(event.options.temperature, 0.7, "temperature applied");
assert.equal(event.options.topP, 0.8, "top_p applied");
assert.equal(event.options.topK, 20, "top_k applied");
assert.equal(event.options.presencePenalty, 1.5, "presence penalty applied");
assert.equal(event.options.maxTokens, 2048, "max output tokens applied");
assert.equal(event.options.reasoningEffort, "medium", "reasoning effort applied");
assert.equal(event.tools.task, undefined, "task tool hidden");
assert.equal(event.tools.subagent, undefined, "subagent alias hidden from an older config");
assert.equal(event.tools.webfetch, undefined, "webfetch hidden");
assert.ok(event.tools.read, "read tool kept");

assert.equal(messages[1].content[0].result.value.length, big("skill").length, "skill result untouched");
assert.equal(messages[5].content[0].result.value.length, big("pinned").length, "pinned result untouched");
assert.ok(messages[3].content[0].result.value.length < big("bash").length, "old bash result pruned");
assert.match(messages[3].content[0].result.value, /Fox Box trimmed/, "prune marker present");
assert.ok(messages[7].content[0].result.value.length < big("recent").length, "fresh result capped on the request");
assert.match(messages[7].content[0].result.value, /fresh result/, "fresh cap marker present");

const contextEvent = (sessionID, nextMessages) => ({
  sessionID,
  model: { providerID: "strata", id: "unsloth-ud-iq4_xs-v31" },
  system: [],
  messages: nextMessages,
  tools: {
    task: { description: "subagents", input: {} },
    subagent: { description: "v2 subagents", input: {} },
    webfetch: { description: "web", input: {} },
    read: { description: "read", input: {} },
  },
  options: {},
});

/* A written config must apply on the very next request; a malformed read must not reset rules. */
const updatedConfig = {
  ...config,
  powers: { ...config.powers, model: { ...config.powers.model, temperature: 0.33 } },
};
await fs.writeFile(path.join(temp, "config.json"), JSON.stringify(updatedConfig, null, 2));
const rereadEvent = contextEvent("ses_reread", [{ role: "user", content: [{ type: "text", text: "Continue." }] }]);
await hooks.context(rereadEvent);
assert.equal(rereadEvent.options.temperature, 0.33, "config changes apply on the next request");
const goodRaw = await fs.readFile(path.join(temp, "config.json"), "utf8");
await fs.writeFile(path.join(temp, "config.json"), "{not json");
const brokenConfigEvent = contextEvent("ses_broken_config", []);
await hooks.context(brokenConfigEvent);
assert.equal(brokenConfigEvent.options.temperature, 0.33, "last good config survives a malformed read");
assert.equal(brokenConfigEvent.options.maxTokens, 2048, "last good caps survive a malformed read");
await fs.writeFile(path.join(temp, "config.json"), goodRaw);

const freshMessages = [
  {
    role: "assistant",
    content: [{ type: "tool-call", id: "fresh", name: "bash", input: { command: "cat big" } }],
  },
  toolResult("fresh", "bash", big("fresh")),
];
await hooks.context(contextEvent("ses_fresh", freshMessages));
assert.ok(freshMessages[1].content[0].result.value.length < big("fresh").length, "fresh tool output capped");
assert.match(freshMessages[1].content[0].result.value, /fresh result/, "fresh marker present");

const skillFreshMessages = [
  {
    role: "assistant",
    content: [{ type: "tool-call", id: "skillfresh", name: "read", input: { filePath: "skills/foo/SKILL.md" } }],
  },
  toolResult("skillfresh", "read", big("skill-fresh")),
];
await hooks.context(contextEvent("ses_skill", skillFreshMessages));
assert.equal(
  skillFreshMessages[1].content[0].result.value.length,
  big("skill-fresh").length,
  "fresh skill output never capped",
);

const pinnedFreshMessages = [
  {
    role: "assistant",
    content: [{ type: "tool-call", id: "pinnedfresh", name: "read", input: { filePath: "src/pinned/core.ts" } }],
  },
  toolResult("pinnedfresh", "read", big("pinned-fresh")),
];
await hooks.context(contextEvent("ses_pinned", pinnedFreshMessages));
assert.equal(
  pinnedFreshMessages[1].content[0].result.value.length,
  big("pinned-fresh").length,
  "fresh pinned output never capped",
);

const numberedFile = (count, prefix) =>
  Array.from(
    { length: count },
    (_, index) => `${index + 1}\t${prefix} line ${index + 1} ${"x".repeat(24)}`,
  ).join("\n");

/* A read gets line numbers and an exact continuation range instead of a head/tail char cut. */
const lineMessages = [
  {
    role: "assistant",
    content: [{ type: "tool-call", id: "lines", name: "read", input: { filePath: "src/lines.ts" } }],
  },
  toolResult("lines", "read", numberedFile(400, "line")),
];
await hooks.context(contextEvent("ses_lines", lineMessages));
const lineValue = lineMessages[1].content[0].result.value;
assert.ok(lineValue.length <= 2000, "line-aware trim stays under the cap");
assert.match(lineValue, /Fox Box kept lines/, "line-aware marker present");
assert.match(lineValue, /offset=\d+/, "line-aware continuation hint present");
assert.match(lineValue, /src\/lines\.ts/, "line-aware path present");

const contentParts = Array.from({ length: 100 }, (_, index) => ({
  type: "text",
  text: `part-${index}: ${"x".repeat(90)}`,
}));
const contentMessages = [
  {
    role: "assistant",
    content: [{ type: "tool-call", id: "content", name: "read", input: { filePath: "src/parts.ts" } }],
  },
  contentResult("content", "read", contentParts),
];
await hooks.context(contextEvent("ses_content", contentMessages));
const contentValue = contentMessages[1].content[0].result.value;
const contentTextLength = contentValue
  .filter((part) => part && part.type === "text")
  .reduce((total, part) => total + (typeof part.text === "string" ? part.text.length : 0), 0);
assert.ok(contentTextLength <= 2000, "content-array text stays under the cap");
assert.ok(contentValue.length < contentParts.length, "later content parts are dropped");

const rangeMessages = [
  {
    role: "assistant",
    content: [
      {
        type: "tool-call",
        id: "range-a",
        name: "read",
        input: { filePath: "src/range.ts", startLine: 10, endLine: 20 },
      },
    ],
  },
  toolResult("range-a", "read", "range A"),
  {
    role: "assistant",
    content: [
      {
        type: "tool-call",
        id: "range-b",
        name: "read",
        input: { filePath: "src/range.ts", startLine: 30, endLine: 40 },
      },
    ],
  },
  toolResult("range-b", "read", "range B"),
];
await hooks.context(contextEvent("ses_range", rangeMessages));
assert.equal(rangeMessages[1].content[0].result.value, "range A", "distinct read ranges are not collapsed");
assert.equal(rangeMessages[3].content[0].result.value, "range B", "distinct read ranges both survive");

/* Structured JSON results are read by the model too, so the ledger counts them exactly. */
const jsonInput = { tool: "lookup" };
const jsonValue = { output: "j".repeat(5000) };
const jsonMessages = [
  {
    role: "assistant",
    content: [{ type: "tool-call", id: "json", name: "mcp_lookup", input: jsonInput }],
  },
  {
    role: "tool",
    content: [
      {
        type: "tool-result",
        id: "json",
        name: "mcp_lookup",
        result: { type: "json", value: jsonValue },
      },
    ],
  },
];
await hooks.context(contextEvent("ses_json", jsonMessages));
assert.deepEqual(jsonMessages[1].content[0].result.value, jsonValue, "JSON result left intact");

const duplicateMessages = [
  {
    role: "assistant",
    content: [{ type: "tool-call", id: "dup1", name: "read", input: { filePath: "src/dup.ts" } }],
  },
  toolResult("dup1", "read", big("dup-old")),
  {
    role: "assistant",
    content: [{ type: "tool-call", id: "dup2", name: "read", input: { filePath: "src/dup.ts" } }],
  },
  toolResult("dup2", "read", "short newest result"),
];
await hooks.context(contextEvent("ses_dup", duplicateMessages));
assert.match(
  duplicateMessages[1].content[0].result.value,
  /^\[Fox Box: duplicate read of src\/dup\.ts collapsed/,
  "older duplicate read stubbed",
);
assert.equal(duplicateMessages[3].content[0].result.value, "short newest result", "newest duplicate kept");

const duplicateSkillMessages = [
  {
    role: "assistant",
    content: [{ type: "tool-call", id: "skilldup1", name: "read", input: { filePath: "skills/foo/SKILL.md" } }],
  },
  toolResult("skilldup1", "read", big("skill-dup")),
  {
    role: "assistant",
    content: [{ type: "tool-call", id: "skilldup2", name: "read", input: { filePath: "skills/foo/SKILL.md" } }],
  },
  toolResult("skilldup2", "read", big("skill-dup")),
];
await hooks.context(contextEvent("ses_skilldup", duplicateSkillMessages));
assert.match(
  duplicateSkillMessages[1].content[0].result.value,
  /duplicate read of skills\/foo\/SKILL\.md collapsed/,
  "older skill duplicate stubbed",
);
assert.equal(
  duplicateSkillMessages[3].content[0].result.value.length,
  big("skill-dup").length,
  "newest skill read stays protected after a repeat",
);

const skillErrorMessages = [
  {
    role: "assistant",
    content: [{ type: "tool-call", id: "skillerr1", name: "read", input: { filePath: "skills/foo/SKILL.md" } }],
  },
  toolResult("skillerr1", "read", big("skill-error-old")),
  { role: "assistant", content: [{ type: "text", text: "Checking." }] },
  { role: "assistant", content: [{ type: "text", text: "Still checking." }] },
  { role: "assistant", content: [{ type: "text", text: "Waiting." }] },
  {
    role: "assistant",
    content: [{ type: "tool-call", id: "skillerr2", name: "read", input: { filePath: "skills/foo/SKILL.md" } }],
  },
  {
    role: "tool",
    content: [
      {
        type: "tool-result",
        id: "skillerr2",
        name: "read",
        result: { type: "error", value: "read failed" },
      },
    ],
  },
  { role: "assistant", content: [{ type: "text", text: "Retrying later." }] },
];
await hooks.context(contextEvent("ses_skill_error", skillErrorMessages));
assert.equal(
  skillErrorMessages[1].content[0].result.value.length,
  big("skill-error-old").length,
  "a failed re-read does not displace the last good protected skill copy",
);
assert.equal(skillErrorMessages[6].content[0].result.value, "read failed", "failed read result left intact");

const taskProtectedMessages = [
  {
    role: "assistant",
    content: [{ type: "tool-call", id: "task-1", name: "task", input: { filePath: "src/pinned/core.ts" } }],
  },
  toolResult("task-1", "task", big("task-old")),
  {
    role: "assistant",
    content: [{ type: "tool-call", id: "task-2", name: "task", input: { filePath: "src/pinned/core.ts" } }],
  },
  toolResult("task-2", "task", big("task-new")),
  { role: "assistant", content: [{ type: "text", text: "Checking." }] },
  { role: "assistant", content: [{ type: "text", text: "Still checking." }] },
  { role: "assistant", content: [{ type: "text", text: "Waiting." }] },
  { role: "user", content: [{ type: "text", text: "Continue." }] },
];
await hooks.context(contextEvent("ses_task_protected", taskProtectedMessages));
assert.ok(
  taskProtectedMessages[1].content[0].result.value.length < big("task-old").length,
  "older protected non-collapsible result is trimmed",
);
assert.equal(
  taskProtectedMessages[3].content[0].result.value.length,
  big("task-new").length,
  "newest protected non-collapsible result stays whole",
);

const frozenEvent = Object.freeze({
  sessionID: "ses_frozen",
  model: Object.freeze({ providerID: "strata", id: "unsloth-ud-iq4_xs-v31" }),
  system: Object.freeze([]),
  messages: Object.freeze([]),
  tools: Object.freeze({ read: Object.freeze({ description: "read", input: {} }) }),
  options: Object.freeze({}),
});
await assert.doesNotReject(() => hooks.context(frozenEvent));

const reusedEvent = contextEvent("ses_reused", [
  { role: "user", content: [{ type: "text", text: "Hello again." }] },
]);
await hooks.context(reusedEvent);
await hooks.context(reusedEvent);
assert.equal(
  reusedEvent.system.filter((part) => part.text === "CONTRACT: work in small verified steps.").length,
  1,
  "the contract is not duplicated on a reused event",
);
assert.equal(
  reusedEvent.system.filter(
    (part) => typeof part.text === "string" && part.text.startsWith("Fox Box focus brief for this project"),
  ).length,
  1,
  "the focus brief is not duplicated on a reused event",
);

const duplicatePinnedMessages = [
  {
    role: "assistant",
    content: [{ type: "tool-call", id: "pindup1", name: "read", input: { filePath: "src/pinned/core.ts" } }],
  },
  toolResult("pindup1", "read", big("pinned-dup")),
  {
    role: "assistant",
    content: [{ type: "tool-call", id: "pindup2", name: "read", input: { filePath: "src/pinned/core.ts" } }],
  },
  toolResult("pindup2", "read", big("pinned-dup")),
];
await hooks.context(contextEvent("ses_pindup", duplicatePinnedMessages));
assert.match(
  duplicatePinnedMessages[1].content[0].result.value,
  /duplicate read of src\/pinned\/core\.ts collapsed/,
  "older pinned duplicate stubbed",
);
assert.equal(
  duplicatePinnedMessages[3].content[0].result.value.length,
  big("pinned-dup").length,
  "newest pinned read stays protected after a repeat",
);

await hooks.commands[0].execute({ sessionID: "ses_test", prompt: {}, delivery: "steer" });
assert.deepEqual(compacted, { sessionID: "ses_test" }, "compaction command calls compact");

const statusRaw = await (async () => {
  await cleanup();
  await new Promise((resolve) => setTimeout(resolve, 80));
  return fs.readFile(statusPath(temp), "utf8");
})();
const status = JSON.parse(statusRaw);
assert.equal(status.stopped, true, "status marks the plugin stopped on cleanup");
assert.ok(status.loadedAt > 0, "status loadedAt");
assert.ok(status.totals.model >= 1, "model counter");
assert.ok(status.totals.context >= 1, "context counter");
assert.ok(status.totals.prunes >= 1, "prune counter");
assert.ok(status.totals.prunedChars > 0, "pruned chars counted");
assert.ok(status.sessions.ses_test, "session recorded");
assert.ok(status.sessions.ses_test.runs >= 1, "session runs counted");
assert.ok(status.totals.collapsed >= 3, "duplicate calls collapsed counted");
assert.equal(status.sessions.ses_dup.collapsed, 1, "session duplicate count recorded");
assert.equal(status.last.collapsed, 1, "last request collapsed count recorded");
assert.ok(status.last.hidden.includes("task"), "hidden tool recorded");
assert.ok(status.last.hidden.includes("subagent"), "the V2 subagent name is hidden from a task-only config");
assert.ok(status.last.hidden.includes("webfetch"), "hidden tool recorded");
assert.equal(status.last.tools, 1, "visible tool count recorded");

/* The ledger must report the exact measured delta, not a sum of guesses from each trim path. */
assert.equal(status.version, 3, "metrics status schema version");
assert.equal(
  status.last.savedChars,
  status.last.originalChars - status.last.keptChars,
  "last request savings equal the measured context delta",
);
assert.equal(
  status.last.savedChars,
  status.last.oldChars + status.last.freshChars + status.last.collapsedChars + status.last.otherChars,
  "last request breakdown adds up",
);
assert.ok(status.last.originalChars > status.last.keptChars, "last request context shrank");
assert.ok(status.last.savedPercent > 0, "last request savings percent recorded");
assert.ok(status.last.toolResults >= 2, "tool results counted");
assert.equal(
  status.totals.prunedChars,
  status.totals.originalChars - status.totals.keptChars,
  "totals savings stay exact across requests",
);
assert.ok(status.totals.oldChars > 0, "aged-result savings recorded");
assert.ok(status.totals.freshChars > 0, "fresh-cap savings recorded");
assert.ok(status.totals.collapsedChars > 0, "duplicate savings recorded");
assert.ok(status.totals.trimmedResults > 0, "trimmed results counted");
assert.ok(status.sessions.ses_fresh.trimmedResults >= 1, "per-session trimmed results counted");
assert.equal(
  status.sessions.ses_fresh.originalChars,
  5027,
  "per-session context size counted exactly (21 chars of tool arguments + 5006 chars of result)",
);
/* Single-key objects stringify identically in JSON.stringify and the plugin's stable form. */
assert.equal(
  status.sessions.ses_json.originalChars,
  JSON.stringify(jsonInput).length + JSON.stringify(jsonValue).length,
  "structured JSON tool results count toward the exact ledger",
);
assert.equal(status.sessions.ses_json.prunedChars, 0, "JSON results are counted, not rewritten");
assert.equal(
  status.sessions.ses_fresh.history[0].saved,
  status.sessions.ses_fresh.prunedChars,
  "history entry matches the request's measured savings",
);
assert.ok(
  Array.isArray(status.sessions.ses_test.history) && status.sessions.ses_test.history.length >= 1,
  "per-session request history recorded",
);
/* The main request's session accumulators must match the independent counts, not just each other. */
assert.equal(
  status.sessions.ses_test.originalChars,
  mainOriginalChars,
  "main request original chars match the independent count",
);
assert.equal(
  status.sessions.ses_test.keptChars,
  mainKeptChars,
  "main request kept chars match the independent count",
);
assert.equal(
  status.sessions.ses_test.prunedChars,
  mainOriginalChars - mainKeptChars,
  "main request pruned chars match the independent delta",
);
assert.equal(status.sessions.ses_test.lastOriginal, mainOriginalChars, "last original size recorded per session");
assert.equal(status.sessions.ses_test.lastKept, mainKeptChars, "last kept size recorded per session");
assert.equal(status.sessions.ses_test.otherChars, 0, "main request savings are fully categorized");
assert.equal(
  status.sessions.ses_test.history[0].saved,
  mainOriginalChars - mainKeptChars,
  "main request history stores the exact savings",
);
assert.equal(status.sessions.ses_test.history[0].kept, mainKeptChars, "main request history stores the exact kept size");
/* The per-session latest-request fields must describe one request, not the session total. */
assert.equal(
  status.sessions.ses_test.lastOriginal,
  status.sessions.ses_test.lastSaved + status.sessions.ses_test.lastKept,
  "latest request original size is saved plus kept",
);
assert.equal(
  status.sessions.ses_test.lastOld +
    status.sessions.ses_test.lastFresh +
    status.sessions.ses_test.lastCollapsedChars +
    status.sessions.ses_test.lastOther,
  status.sessions.ses_test.lastSaved,
  "latest-request breakdown adds up per session",
);
assert.equal(status.sessions.ses_dup.lastCollapsed, 1, "latest duplicate count recorded per session");
assert.equal(
  status.sessions.ses_fresh.lastToolResults,
  status.sessions.ses_fresh.toolResults,
  "latest tool-result count recorded per session",
);

/* Every per-request accumulator in totals must equal the sum of the session accumulators. */
const sessionEntries = Object.values(status.sessions);
const sessionSum = (key) => sessionEntries.reduce((total, session) => total + Number(session[key] || 0), 0);
for (const key of [
  "runs",
  "prunedChars",
  "originalChars",
  "keptChars",
  "oldChars",
  "freshChars",
  "collapsedChars",
  "otherChars",
  "collapsed",
  "toolResults",
  "trimmedResults",
]) {
  const totalKey = key === "runs" ? "context" : key;
  assert.equal(status.totals[totalKey], sessionSum(key), `totals.${totalKey} equals the sum of session ${key}`);
}

async function loadPlugin(tag, directory = PROJECT_DIRECTORY) {
  const module = await import(`${pathToFileURL(path.join(root, "plugin", "index.js")).href}?${tag}`);
  const localHooks = { tool: null, context: null };
  const localCtx = {
    location: { directory },
    session: {
      hook: async (name, callback) => {
        localHooks[name] = callback;
        return { dispose: async () => {} };
      },
      compact: async () => {},
    },
    tool: {
      hook: async (name, callback) => {
        if (name === "execute.after") localHooks.tool = callback;
        return { dispose: async () => {} };
      },
    },
    command: { transform: async () => ({ dispose: async () => {} }) },
  };
  const cleanup = await module.default.setup(localCtx);
  return { hooks: localHooks, cleanup };
}

/* A newer fresh read must supersede an older copy for the protected-read slot. */
const rereadHome = await fs.mkdtemp(path.join(os.tmpdir(), "foxbox-latest-reread-"));
process.env.FOXBOX_HOME = rereadHome;
await fs.writeFile(
  path.join(rereadHome, "config.json"),
  JSON.stringify({
    ...config,
    version: 2,
    powers: {
      ...config.powers,
      context: {
        ...config.powers.context,
        keepRecent: 2,
        protectedReads: 1,
        collapseDuplicates: false,
        trimToolOutput: true,
        maxToolOutput: 6000,
        maxOldToolOutput: 1000,
      },
    },
  }),
);
const rereadPlugin = await loadPlugin("latest-reread");
const rereadFile = numberedFile(100, "reread");
const rereadMessages = [
  {
    role: "assistant",
    content: [{ type: "tool-call", id: "reread-old", name: "read", input: { filePath: "src/reread.ts" } }],
  },
  toolResult("reread-old", "read", rereadFile),
  { role: "assistant", content: [{ type: "text", text: "Pause." }] },
  { role: "assistant", content: [{ type: "text", text: "Still paused." }] },
  {
    role: "assistant",
    content: [{ type: "tool-call", id: "reread-new", name: "read", input: { filePath: "src/reread.ts" } }],
  },
  toolResult("reread-new", "read", rereadFile),
];
await rereadPlugin.hooks.context(contextEvent("ses_reread_latest", rereadMessages));
assert.ok(
  rereadMessages[1].content[0].result.value.length < rereadFile.length,
  "an old read falls to the old budget when a newer fresh read exists",
);
assert.equal(
  rereadMessages[5].content[0].result.value.length,
  rereadFile.length,
  "the newer fresh read remains whole",
);
await rereadPlugin.cleanup();
const rereadStatus = JSON.parse(await fs.readFile(statusPath(rereadHome), "utf8"));
assert.equal(rereadStatus.last.protectedReads, 0, "fresh read does not claim an old-read slot");
await fs.rm(rereadHome, { recursive: true, force: true });

/* History keeps the newest 16 requests and its last entry matches the session's last request. */
const historyHome = await fs.mkdtemp(path.join(os.tmpdir(), "foxbox-history-"));
process.env.FOXBOX_HOME = historyHome;
await fs.writeFile(path.join(historyHome, "config.json"), JSON.stringify(config, null, 2));
const historyPlugin = await loadPlugin("history");
for (let index = 0; index < 17; index += 1) {
  await historyPlugin.hooks.context(
    contextEvent("ses_history", [
      {
        role: "assistant",
        content: [{ type: "tool-call", id: `history-${index}`, name: "bash", input: { command: `echo ${index}` } }],
      },
      toolResult(`history-${index}`, "bash", "h".repeat(3000)),
    ]),
  );
}
await historyPlugin.cleanup();
const historyStatus = JSON.parse(await fs.readFile(statusPath(historyHome), "utf8"));
const historySession = historyStatus.sessions.ses_history;
assert.equal(historySession.history.length, 16, "request history is capped at 16 entries");
assert.equal(
  historySession.history.at(-1).saved,
  historySession.lastSaved,
  "newest history entry matches the session's last savings",
);
assert.equal(
  historySession.history.at(-1).kept,
  historySession.lastKept,
  "newest history entry matches the session's last kept size",
);
assert.equal(
  historySession.prunedChars,
  historySession.originalChars - historySession.keptChars,
  "capped history does not disturb the session accumulators",
);
await fs.rm(historyHome, { recursive: true, force: true });

/* A request while Context Keeper is off is not a guarded request and must not enter the ledger. */
const offHome = await fs.mkdtemp(path.join(os.tmpdir(), "foxbox-context-off-"));
process.env.FOXBOX_HOME = offHome;
await fs.writeFile(
  path.join(offHome, "config.json"),
  JSON.stringify({
    ...config,
    powers: { ...config.powers, context: { ...config.powers.context, enabled: false } },
  }),
);
const offPlugin = await loadPlugin("context-off");
await offPlugin.hooks.context(
  contextEvent("ses_off", [
    {
      role: "assistant",
      content: [{ type: "tool-call", id: "off", name: "bash", input: { command: "npm test" } }],
    },
    toolResult("off", "bash", "o".repeat(5000)),
  ]),
);
await offPlugin.cleanup();
const offStatus = JSON.parse(await fs.readFile(statusPath(offHome), "utf8"));
assert.equal(offStatus.sessions.ses_off, undefined, "context-off request does not create a ledger session");
assert.equal(offStatus.totals.context, 0, "context-off request is not counted as guarded");
assert.equal(offStatus.last.originalChars, 0, "context-off request records no pruning");
await fs.rm(offHome, { recursive: true, force: true });

/* Two projects sharing FOXBOX_HOME must write separate status files, each with its own sessions. */
const isolationHome = await fs.mkdtemp(path.join(os.tmpdir(), "foxbox-status-isolation-"));
process.env.FOXBOX_HOME = isolationHome;
await fs.writeFile(path.join(isolationHome, "config.json"), JSON.stringify(config, null, 2));
const alphaPlugin = await loadPlugin("project-alpha", "C:\\Work\\Alpha");
const betaPlugin = await loadPlugin("project-beta", "C:\\Work\\Beta");
const projectEvent = (sessionID, toolID) =>
  contextEvent(sessionID, [
    {
      role: "assistant",
      content: [{ type: "tool-call", id: toolID, name: "bash", input: { command: "npm test" } }],
    },
    toolResult(toolID, "bash", "p".repeat(5000)),
  ]);
await alphaPlugin.hooks.context(projectEvent("ses_alpha", "alpha"));
await betaPlugin.hooks.context(projectEvent("ses_beta", "beta"));
await alphaPlugin.cleanup();
await betaPlugin.cleanup();
const isolationEntries = await fs.readdir(isolationHome);
const statusFiles = isolationEntries.filter((name) => name.startsWith("status-") && name.endsWith(".json"));
assert.equal(statusFiles.length, 2, "each project writes its own status file");
const isolationStatuses = await Promise.all(
  statusFiles.map(async (name) => JSON.parse(await fs.readFile(path.join(isolationHome, name), "utf8"))),
);
const alphaStatus = isolationStatuses.find((entry) => entry.sessions.ses_alpha);
const betaStatus = isolationStatuses.find((entry) => entry.sessions.ses_beta);
assert.ok(alphaStatus, "the alpha project status keeps its own session");
assert.ok(betaStatus, "the beta project status keeps its own session");
assert.equal(alphaStatus.sessions.ses_beta, undefined, "alpha status does not contain beta sessions");
assert.equal(betaStatus.sessions.ses_alpha, undefined, "beta status does not contain alpha sessions");
assert.equal(
  await fs.access(path.join(isolationHome, "status.json")).then(() => true, () => false),
  false,
  "no shared global status file is written",
);
await fs.rm(isolationHome, { recursive: true, force: true });

/* A version 1 config with a sub-48k cap must migrate to 48k, not stay aggressive. */
const legacyHome = await fs.mkdtemp(path.join(os.tmpdir(), "foxbox-legacy-"));
process.env.FOXBOX_HOME = legacyHome;
await fs.writeFile(
  path.join(legacyHome, "config.json"),
  JSON.stringify({
    ...config,
    version: 1,
    powers: { ...config.powers, context: { ...config.powers.context, maxToolOutput: 12000 } },
  }),
);
const legacy = await loadPlugin("legacy");
const legacyFresh = "y".repeat(40000);
const legacyEvent = contextEvent("ses_legacy", [
  {
    role: "assistant",
    content: [{ type: "tool-call", id: "legacy", name: "read", input: { filePath: "src/big.ts" } }],
  },
  toolResult("legacy", "read", legacyFresh),
]);
await legacy.hooks.context(legacyEvent);
assert.equal(
  legacyEvent.messages[1].content[0].result.value.length,
  legacyFresh.length,
  "v1 12k cap migrated to 48k",
);
await legacy.cleanup();

/* A cap above the old 64k ceiling must be honored. */
const highHome = await fs.mkdtemp(path.join(os.tmpdir(), "foxbox-highcap-"));
process.env.FOXBOX_HOME = highHome;
await fs.writeFile(
  path.join(highHome, "config.json"),
  JSON.stringify({
    ...config,
    version: 2,
    powers: { ...config.powers, context: { ...config.powers.context, maxToolOutput: 128000 } },
  }),
);
const high = await loadPlugin("highcap");
const highFresh = "z".repeat(100000);
const highEvent = contextEvent("ses_high", [
  {
    role: "assistant",
    content: [{ type: "tool-call", id: "high", name: "read", input: { filePath: "src/huge.ts" } }],
  },
  toolResult("high", "read", highFresh),
]);
await high.hooks.context(highEvent);
assert.equal(highEvent.messages[1].content[0].result.value.length, highFresh.length, "caps above 64k are honored");
await high.cleanup();

/* The newest read of the configured number of files keeps the fresh cap; skills stay whole outside that count. */
const protectedHome = await fs.mkdtemp(path.join(os.tmpdir(), "foxbox-protected-reads-"));
process.env.FOXBOX_HOME = protectedHome;
await fs.writeFile(
  path.join(protectedHome, "config.json"),
  JSON.stringify({
    ...config,
    version: 2,
    powers: {
      ...config.powers,
      context: {
        ...config.powers.context,
        keepRecent: 2,
        protectedReads: 1,
        collapseDuplicates: true,
        trimToolOutput: true,
        maxToolOutput: 6000,
        maxOldToolOutput: 1000,
        protectSkills: true,
        protectPaths: "src/pinned/**\n**/*.md",
      },
    },
  }),
);
const protectedPlugin = await loadPlugin("protected-reads");
const bashReadmeMessages = [
  {
    role: "assistant",
    content: [{ type: "tool-call", id: "bash-readme", name: "bash", input: "cat README.md && generate 100MB" }],
  },
  toolResult("bash-readme", "bash", big("bash-readme")),
  { role: "assistant", content: [{ type: "text", text: "Pause." }] },
  { role: "user", content: [{ type: "text", text: "Continue." }] },
];
await protectedPlugin.hooks.context(contextEvent("ses_bash_pin", bashReadmeMessages));
assert.ok(
  bashReadmeMessages[1].content[0].result.value.length < big("bash-readme").length,
  "a string tool input is not treated as a pinned path",
);

const fileReadme = numberedFile(100, "readme");
const fileA = numberedFile(100, "alpha");
const fileB = numberedFile(100, "beta");
const fileSkill = numberedFile(100, "skill");
const protectedMessages = [
  {
    role: "assistant",
    content: [{ type: "tool-call", id: "protected-readme", name: "read", input: { filePath: "README.md" } }],
  },
  toolResult("protected-readme", "read", fileReadme),
  {
    role: "assistant",
    content: [{ type: "tool-call", id: "protected-a", name: "read", input: { filePath: "src/a.ts" } }],
  },
  toolResult("protected-a", "read", fileA),
  {
    role: "assistant",
    content: [{ type: "tool-call", id: "protected-b", name: "read", input: { filePath: "src/b.ts" } }],
  },
  toolResult("protected-b", "read", fileB),
  {
    role: "assistant",
    content: [{ type: "tool-call", id: "protected-skill", name: "read", input: { filePath: "skills/foo/SKILL.md" } }],
  },
  toolResult("protected-skill", "read", fileSkill),
  {
    role: "assistant",
    content: [{ type: "tool-call", id: "protected-skill-notes", name: "read", input: { filePath: "skills/foo/notes.md" } }],
  },
  toolResult("protected-skill-notes", "read", fileSkill),
  { role: "assistant", content: [{ type: "text", text: "Pause." }] },
  { role: "user", content: [{ type: "text", text: "Continue." }] },
];
await protectedPlugin.hooks.context(contextEvent("ses_protected", protectedMessages));
assert.equal(
  protectedMessages[1].content[0].result.value.length,
  fileReadme.length,
  "root markdown glob keeps the newest README read whole",
);
assert.ok(
  protectedMessages[3].content[0].result.value.length < fileA.length,
  "older read falls to the old budget",
);
assert.equal(
  protectedMessages[5].content[0].result.value.length,
  fileB.length,
  "newest read keeps the fresh cap",
);
assert.equal(
  protectedMessages[7].content[0].result.value.length,
  fileSkill.length,
  "skill read stays whole outside the protected-read limit",
);
assert.equal(
  protectedMessages[9].content[0].result.value.length,
  fileSkill.length,
  "a file under a skills folder is protected even without a SKILL.md name",
);
await protectedPlugin.cleanup();
const protectedStatus = JSON.parse(await fs.readFile(statusPath(protectedHome), "utf8"));
assert.equal(protectedStatus.last.protectedReads, 1, "one latest read marked protected");
assert.equal(protectedStatus.last.collapsed, 0, "protected-read test has no duplicates");

/* Duplicate collapse still works when trimming is off. */
const collapseHome = await fs.mkdtemp(path.join(os.tmpdir(), "foxbox-collapse-only-"));
process.env.FOXBOX_HOME = collapseHome;
await fs.writeFile(
  path.join(collapseHome, "config.json"),
  JSON.stringify({
    ...config,
    version: 2,
    powers: {
      ...config.powers,
      context: {
        ...config.powers.context,
        keepRecent: 2,
        collapseDuplicates: true,
        trimToolOutput: false,
        maxToolOutput: 2000,
        maxOldToolOutput: 1000,
      },
    },
  }),
);
const collapsePlugin = await loadPlugin("collapse-only");
const collapseMessages = [
  {
    role: "assistant",
    content: [{ type: "tool-call", id: "collapse-1", name: "read", input: { filePath: "src/collapse.ts" } }],
  },
  toolResult("collapse-1", "read", "q".repeat(5000)),
  {
    role: "assistant",
    content: [{ type: "tool-call", id: "collapse-2", name: "read", input: { filePath: "src/collapse.ts" } }],
  },
  toolResult("collapse-2", "read", "n".repeat(5000)),
];
await collapsePlugin.hooks.context(contextEvent("ses_collapse", collapseMessages));
assert.match(
  collapseMessages[1].content[0].result.value,
  /duplicate read of src\/collapse\.ts collapsed/,
  "duplicate stubbed with trimming off",
);
assert.equal(
  collapseMessages[3].content[0].result.value.length,
  5000,
  "newest copy kept whole with trimming off",
);
await collapsePlugin.cleanup();
const collapseStatus = JSON.parse(await fs.readFile(statusPath(collapseHome), "utf8"));
assert.equal(collapseStatus.last.collapsed, 1, "collapse-only request counted");
assert.equal(collapseStatus.last.trimToolOutput, false, "trim setting reported as off");

/* Tool hiding is a surface rule, not sampling tuning: it must apply on a non-Qwen model
   even while the Qwen-only switch keeps sampling and the contract idle. */
const hideHome = await fs.mkdtemp(path.join(os.tmpdir(), "foxbox-hide-any-model-"));
process.env.FOXBOX_HOME = hideHome;
await fs.writeFile(
  path.join(hideHome, "config.json"),
  JSON.stringify({
    ...config,
    version: 2,
    powers: {
      ...config.powers,
      model: {
        ...config.powers.model,
        enabled: true,
        applyToQwenOnly: true,
        hideTools: ["subagent", "webfetch"],
      },
    },
  }),
);
const hidePlugin = await loadPlugin("hide-any-model");
const hideEvent = {
  sessionID: "ses_hide_non_qwen",
  model: { providerID: "opencode-go", id: "deepseek-v4.1-flash" },
  system: [],
  messages: [
    {
      role: "assistant",
      content: [{ type: "tool-call", id: "hide-ctx", name: "bash", input: { command: "echo big" } }],
    },
    toolResult("hide-ctx", "bash", "h".repeat(5000)),
  ],
  tools: {
    subagent: { description: "subagents", input: {} },
    task: { description: "v1 subagents", input: {} },
    webfetch: { description: "web", input: {} },
    read: { description: "read", input: {} },
  },
  options: {},
};
await hidePlugin.hooks.context(hideEvent);
assert.equal(hideEvent.tools.subagent, undefined, "subagent tool hidden on a non-Qwen model");
assert.equal(hideEvent.tools.task, undefined, "the V1 task alias is hidden too");
assert.equal(hideEvent.tools.webfetch, undefined, "webfetch hidden on a non-Qwen model");
assert.ok(hideEvent.tools.read, "unlisted tools stay visible");
assert.equal(
  hideEvent.options.temperature,
  undefined,
  "sampling stays idle when the Qwen-only switch is on",
);
assert.ok(
  hideEvent.messages[1].content[0].result.value.length < 5000,
  "context trimming still runs on a non-Qwen model",
);
assert.doesNotMatch(
  hideEvent.system.map((part) => part.text).join("\n"),
  /CONTRACT: work in small verified steps/,
  "the contract stays idle on a non-Qwen model",
);
await hidePlugin.cleanup();
const hideStatus = JSON.parse(await fs.readFile(statusPath(hideHome), "utf8"));
assert.ok(hideStatus.last.hidden.includes("subagent"), "hidden subagent recorded");
assert.ok(hideStatus.last.hidden.includes("webfetch"), "hidden webfetch recorded");
assert.equal(hideStatus.last.tools, 1, "only the unlisted tool remains visible");
assert.equal(hideStatus.last.applied, false, "the status still reports sampling as not applied");
await fs.rm(hideHome, { recursive: true, force: true });

/* The master switch still owns the tool surface: with Model Fit off, nothing is hidden. */
const modelOffHome = await fs.mkdtemp(path.join(os.tmpdir(), "foxbox-model-off-"));
process.env.FOXBOX_HOME = modelOffHome;
await fs.writeFile(
  path.join(modelOffHome, "config.json"),
  JSON.stringify({
    ...config,
    version: 2,
    powers: {
      ...config.powers,
      model: {
        ...config.powers.model,
        enabled: false,
        applyToQwenOnly: false,
        hideTools: ["subagent", "webfetch"],
      },
    },
  }),
);
const modelOffPlugin = await loadPlugin("model-off");
const modelOffEvent = {
  sessionID: "ses_model_off",
  model: { providerID: "strata", id: "unsloth-ud-iq4_xs-v31" },
  system: [],
  messages: [],
  tools: {
    subagent: { description: "subagents", input: {} },
    webfetch: { description: "web", input: {} },
    read: { description: "read", input: {} },
  },
  options: {},
};
await modelOffPlugin.hooks.context(modelOffEvent);
assert.ok(modelOffEvent.tools.subagent, "Model Fit off leaves subagent visible");
assert.ok(modelOffEvent.tools.webfetch, "Model Fit off leaves webfetch visible");
assert.equal(modelOffEvent.options.temperature, undefined, "Model Fit off leaves sampling alone");
await modelOffPlugin.cleanup();
const modelOffStatus = JSON.parse(await fs.readFile(statusPath(modelOffHome), "utf8"));
assert.equal(modelOffStatus.last.hidden.length, 0, "Model Fit off records no hidden tools");
await fs.rm(modelOffHome, { recursive: true, force: true });

/* The same context is re-sent every turn. The cumulative accumulator is allowed to grow,
   but the per-session last* fields must stay tied to one request so the panel can show the
   correct, non-doubled headline. */
const repeatHome = await fs.mkdtemp(path.join(os.tmpdir(), "foxbox-repeat-ledger-"));
process.env.FOXBOX_HOME = repeatHome;
await fs.writeFile(
  path.join(repeatHome, "config.json"),
  JSON.stringify({
    ...config,
    version: 2,
    powers: {
      ...config.powers,
      model: { ...config.powers.model, hideTools: [] },
    },
  }),
);
const repeatPlugin = await loadPlugin("repeat-ledger");
const repeatEvent = () =>
  contextEvent("ses_repeat", [
    {
      role: "assistant",
      content: [{ type: "tool-call", id: "repeat-1", name: "bash", input: { command: "echo repeat" } }],
    },
    toolResult("repeat-1", "bash", "r".repeat(5000)),
  ]);
await repeatPlugin.hooks.context(repeatEvent());
await repeatPlugin.hooks.context(repeatEvent());
await repeatPlugin.cleanup();
const repeatStatus = JSON.parse(await fs.readFile(statusPath(repeatHome), "utf8"));
const repeatSession = repeatStatus.sessions.ses_repeat;
assert.ok(repeatSession.lastSaved > 0, "repeat test pruned something");
assert.equal(
  repeatSession.prunedChars,
  repeatSession.lastSaved * 2,
  "the cumulative count sums both requests while lastSaved stays one request",
);
assert.equal(
  repeatSession.originalChars,
  repeatSession.lastOriginal * 2,
  "the cumulative original size sums both requests",
);
assert.equal(
  repeatSession.keptChars,
  repeatSession.lastKept * 2,
  "the cumulative kept size sums both requests",
);
assert.equal(
  repeatSession.lastOriginal,
  repeatSession.lastSaved + repeatSession.lastKept,
  "the last request keeps its own exact sizes",
);
await fs.rm(repeatHome, { recursive: true, force: true });

await fs.rm(legacyHome, { recursive: true, force: true });
await fs.rm(highHome, { recursive: true, force: true });
await fs.rm(protectedHome, { recursive: true, force: true });
await fs.rm(collapseHome, { recursive: true, force: true });

await fs.rm(temp, { recursive: true, force: true });
console.log(
  "Plugin tests OK: injection, Qwen settings, tool hiding, skill/pin protection, line-aware caps, duplicate collapse, protected reads, metrics ledger (latest vs cumulative), status, compaction, cap migration.",
);
