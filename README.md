# Fox Box

Fox Box is an extension for OpenChamber. It trims the outgoing request, adds a few sampling and tool-surface settings, and provides small panels for planning, debugging, prose, characters, and game feel.

Several panels use the Small Model configured in OpenChamber to generate drafts and suggestions, so they are starting points rather than guaranteed answers.

> **Aimed at local Qwen.** Fox Box is tuned mainly for Qwen3.8-Flash-Next running locally through Strata or a similar provider. A balanced preset exists and tool hiding works with every model, but the defaults are not tuned for other models.

## Install

Requires OpenChamber 2.7.0 or newer and OpenCode 2.x.

1. For a folder install, build the panel first:

   ```bash
   npm install
   npm run build
   ```

2. In OpenChamber, open **Settings → Extensions → Add**.
3. Choose this folder, or paste:

   ```text
   https://github.com/DarkKitsune/fox-box
   ```

4. Approve the requested capabilities: `prompt`, `sessions`, `files`, `model`, and the bundled OpenCode plugin.

Folder installs run from the folder, so rebuild and reload after changes. A Git install copies the built package into OpenChamber's data folder.

## What it does

### Context

- **Context Keeper** edits the outgoing request only; stored history is untouched. It can collapse repeated reads, cap old and fresh tool output, and leave skills, pinned paths, and recent reads protected. The limits are configurable.
- **Handoff Passport** turns a captured chat into a compact handoff: goal, current state, decisions, files, open threads, next moves, and things not to repeat. It can start a fresh session from the result.

### Build

- **Slice Forge** asks the model to turn a goal into one small vertical slice with non-goals, concrete steps, acceptance checks, risks, and a first prompt.
- **Bug Hunter** starts from a symptom or stack trace, asks for a reproduction, ranks likely causes, names the verification, and proposes a regression guard.
- **Red Pen** reviews selected code, a file, or diff lines for correctness, edge cases, security, and tests.
- **Game Feel Lab** drafts a juice pass, a tuning matrix, and a playtest kit. It also works for design-only game passes.

### Studio

- **Character Forge** is a structured character sheet for role, look, want, need, wound, contradiction, secret, arc, voice, and relationships. Characters are saved locally.
- **Prose Atelier** offers line polish, a scene doctor, and voice matching. Voice matching can use a saved character.
- **Idea Distiller** scores small idea notes on novelty, usefulness, fit, and effort, then blends two into a combined concept. A result can be sent to Slice Forge.

### Tune

- **Model Fit** provides Qwen-oriented sampling presets, reasoning effort, an output cap, and a short contract for small models. The tool-surface controls hide selected tools from the request without uninstalling them.

### Metrics

- **Pruning Ledger** reports exact character counts, an estimated token count, the latest request's savings, a breakdown by cause, recent request history, and per-session totals.

Chat, selection, file, and diff menu actions feed captured material into the relevant panel.

**Fill blanks** appears on the creative forms in Character Forge, Idea Distiller, and Game Feel Lab, and on the Slice Forge brief. It asks the Small Model for only the fields left empty. It is a separate Small Model call and is not run by actions that send work to the full agent.

## How pruning is measured

Fox Box counts characters in the outgoing text, tool results, and tool arguments before and after it edits the request. Those counts are exact.

The headline counters describe the **latest guarded request**. The cumulative value is **input saved over time**: a chat re-sends its history every turn, so the same text can be pruned again on later turns. It is not a unique-character count.

Token counts are estimates. When OpenChamber's context meter has a measurement, Fox Box uses the model's measured tokens per character; otherwise it falls back to four characters per token.

## Development and testing

```bash
npm run check          # typecheck, plugin tests, panel tests, build, manifest check
npm run build          # rebuild panel/main.js
npm run typecheck
npm run test:plugin
npm run test:panel
npm run check:manifest
```

`panel/main.js` is committed because the extension loads it directly. Rebuild it after editing `panel/main.ts`.

The plugin tests cover request injection, tool hiding, context pruning, protection rules, and ledger accounting. The panel tests cover the Fill blanks JSON parsing; the rest of the panel has less automated coverage.

## Status

This is a hobby project, not an official OpenChamber project or a supported product. Most of the code was written by AI. Passing tests mean the covered behavior works; they do not prove the extension is free of bugs, and the panel and less common paths are not tested as thoroughly.

Expect rough edges. Use it on work you can afford to redo, keep projects under version control, and check how it behaves in your own sessions before depending on it.

## Layout and data

```text
panel/      OpenChamber panel, TypeScript and its built bundle
plugin/     OpenCode plugin that edits outgoing requests
scripts/    Manifest check, plugin tests, panel preview
assets/     Extension icon
```

Config and ledger files live in `~/.config/openchamber/fox-box/`. Handoffs and prose drafts saved from the panel go under `.foxbox/` in the open project. Fox Box does not call external APIs itself; generate actions use the Small Model configured in OpenChamber.
