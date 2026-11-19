import assert from "node:assert/strict";
import path from "node:path";
import { build } from "esbuild";

const result = await build({
  entryPoints: [path.join(process.cwd(), "panel", "fill.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node18",
  write: false,
});
const code = result.outputFiles?.[0]?.text;
assert.ok(code, "panel/fill.ts bundling produced no output");

const module = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const { extractJsonObject, fillValuesFromJson } = module;

assert.deepEqual(extractJsonObject('```json\n{"name":"Ada"}\n```'), { name: "Ada" });
assert.deepEqual(extractJsonObject('Sure.\n{"a":"x","b":{"c":1}}\nDone.'), { a: "x", b: { c: 1 } });
assert.deepEqual(extractJsonObject('{"text":"brace } and { inside","ok":true}'), {
  text: "brace } and { inside",
  ok: true,
});
assert.equal(extractJsonObject("no json here"), null);
assert.equal(extractJsonObject('{"broken":'), null);
assert.deepEqual(extractJsonObject('Use {curly braces} in prose, then {"ok":true}'), { ok: true });

const missing = [
  { key: "name", label: "Name", value: "", max: 5 },
  { key: "note", label: "Note", value: "", max: 10 },
  { key: "detail", label: "Detail", value: "", max: 20 },
];
assert.deepEqual(
  fillValuesFromJson({ name: "  Ada Lovelace  ", note: 42, detail: { nested: true }, extra: "ignored" }, missing),
  { name: "Ada L", note: "42" },
  "values are trimmed, clamped, and limited to missing string/number fields",
);
assert.deepEqual(fillValuesFromJson({ name: null, note: true, detail: [] }, missing), {});
assert.deepEqual(fillValuesFromJson({ name: "   " }, missing), {});
assert.deepEqual(
  fillValuesFromJson({ Name: " Ada ", Note: "kept" }, missing),
  { name: "Ada", note: "kept" },
  "keys are matched case-insensitively",
);
assert.deepEqual(
  fillValuesFromJson({ name: "string", note: "<string>", detail: "real detail" }, missing),
  { detail: "real detail" },
  "schema placeholders are not written into fields",
);

console.log(
  "Panel fill tests OK: JSON extraction from prose/fences, braces inside strings, type rejection, placeholder rejection, case-insensitive keys, trimming, and length limits.",
);
