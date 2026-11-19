import fs from "node:fs";
import path from "node:path";
import { parseManifestJson } from "@openchamber/sdk/schemas";

const root = process.cwd();
const packagePath = path.join(root, "package.json");
const raw = fs.readFileSync(packagePath, "utf8");
const result = parseManifestJson(raw);

if (!result.ok) {
  console.error("Manifest is invalid:");
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}

const manifest = result.manifest;
const required = [];
if (manifest.contributes.panel) required.push(manifest.contributes.panel.entry);
if (manifest.contributes.page && typeof manifest.contributes.page === "object") {
  required.push(manifest.contributes.page.entry);
}
if (manifest.contributes.statusSection && typeof manifest.contributes.statusSection === "object") {
  required.push(manifest.contributes.statusSection.entry);
}
for (const editor of manifest.contributes.fileEditors ?? []) required.push(editor.entry);
if (typeof manifest.contributes.opencodePlugin === "string") {
  const folder = path.join(root, manifest.contributes.opencodePlugin);
  const candidates = ["index.js", "server.js"].map((name) => path.join(folder, name));
  const hasEntry = candidates.some((file) => fs.existsSync(file));
  if (!hasEntry) {
    const packageFile = path.join(folder, "package.json");
    if (!fs.existsSync(packageFile)) {
      console.error(`Plugin folder has no index.js/server.js: ${folder}`);
      process.exit(1);
    }
  }
}

for (const entry of required) {
  const file = path.join(root, entry);
  if (!fs.existsSync(file)) {
    console.error(`Declared entry is missing: ${entry}`);
    process.exit(1);
  }
}

if (!fs.existsSync(path.join(root, "panel", "main.js"))) {
  console.warn("panel/main.js has not been built yet; run `npm run build` before installing.");
} else {
  const sourcePath = path.join(root, "panel", "main.ts");
  const builtPath = path.join(root, "panel", "main.js");
  if (fs.existsSync(sourcePath)) {
    try {
      if (fs.statSync(sourcePath).mtimeMs > fs.statSync(builtPath).mtimeMs) {
        console.warn("panel/main.js is older than panel/main.ts; run `npm run build` before installing.");
      }
    } catch {
      // A stat failure is not a manifest problem.
    }
  }
}

const displayName = manifest.contributes.panel?.name ?? "Fox Box";
const displayId = manifest.contributes.panel?.id ?? "fox-box";
console.log(`Manifest OK: ${displayName} (${displayId}) v${result.version}`);
console.log(`Capabilities: ${manifest.contributes.capabilities.join(", ") || "none"}`);
console.log(`Actions: ${(manifest.contributes.actions ?? []).map((action) => action.id).join(", ") || "none"}`);
