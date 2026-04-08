# AGENTS Guide for aspen

This file is for coding agents working in this repository.
Follow repository facts first, then these conventions.

## Repository Snapshot

- Frontend stack: Vue 3 + TypeScript + Vite.
- Desktop shell: Tauri v2 (Rust in `src-tauri/`).
- Desktop self-updates: Tauri updater against signed GitHub Releases metadata.
- FPGA synthesis: Yosys, invoked from the Tauri backend for the Synthesis page.
- FPGA implementation/bitstream: Rust `fde` from crates.io (`fde = "1.0"`), invoked directly from the Tauri backend through staged function calls.
- Runtime synthesis must use Aspen's bundled Yosys toolchain; do not fall back to a system `yosys` on `PATH`.
- Runtime implementation must use Aspen's Cargo-linked Rust `fde` dependency; do not shell out to a system-installed `fde`.
- Package manager: pnpm.
- Type safety baseline: strict TypeScript (`strict: true`, unused checks on).
- UI foundation: Tailwind CSS v4 + shadcn-vue/reka-ui patterns.

## Repository Origin Context

- Project intent (from maintainer): consolidate `../ufde-next` and `../Rabbit` into one workspace.
- Expect mixed style artifacts while integration is in progress.
- When editing existing files, prioritize local consistency first, then gradually normalize toward this guide.
- Do not perform wide-format rewrites unless required by the task.

## Project Layout

- `src/main.ts`: frontend entrypoint.
- `src/App.vue`: top-level app shell.
- `src/components/`: Vue components and UI primitives.
- `src/lib/`: shared frontend utilities.
- `src/stores/`: reactive state stores.
- `src/index.css`: global Tailwind/theme tokens.
- `src-tauri/src/main.rs`: Rust binary entrypoint.
- `src-tauri/src/lib.rs`: Tauri commands and app wiring.
- `src-tauri/src/hardware/synthesis.rs`: Yosys runner and synthesis report generation.
- `src-tauri/src/hardware/implementation.rs`: Rust `fde` implementation/STA/bitstream runner using in-process library calls.
- `src-tauri/resource/fde/hw_lib/`: packaged FDE XML architecture/library resources.
- `src-tauri/tauri.conf.json`: Tauri build/dev config.
- `src-tauri/tauri.yosys.conf.json`: optional Tauri bundle config used when packaging Aspen with the Yosys toolchain and FDE resources.
- `src-tauri/tauri.release.conf.json`: tag-release bundle config that also enables updater artifacts.

## Source of Truth for Commands

- `package.json` scripts are primary for JS/TS workflows.
- `src-tauri/tauri.conf.json` controls Tauri pre-dev/pre-build hooks.
- Prettier is configured via `.prettierrc.json` and `.prettierignore`.
- Frontend tests are configured via `vitest.config.ts`.

## Install and Run

- Install deps: `pnpm install`
- Frontend dev server: `pnpm dev`
- Tauri dev app: `pnpm tauri dev`
- Frontend preview: `pnpm preview`
- Download, prune, and bundle the official OSS CAD Suite into `src-tauri/vendor/yosys`: `pnpm prepare:yosys-bundle`

## Build, Lint, Typecheck, Test

- Canonical frontend build: `pnpm build`
  - Expands to: `vue-tsc --noEmit && vite build`
- Frontend typecheck: `pnpm typecheck`
- Frontend format write: `pnpm format`
- Frontend format check: `pnpm format:check`
- Tauri production build: `pnpm tauri build`
- Tauri build with bundled FPGA toolchains/resources: `pnpm tauri build --no-bundle -c src-tauri/tauri.yosys.conf.json`
- Updater manifest helper: `python3 scripts/generate_updater_manifest.py --assets-dir <dir> --repo 0xtaruhi/aspen --tag vX.Y.Z --out <latest.json>`
- Standalone typecheck: `pnpm exec vue-tsc --noEmit`
- Rust formatting: `cargo fmt --manifest-path src-tauri/Cargo.toml`
- Rust tests: `cargo test --manifest-path src-tauri/Cargo.toml`

### Lint/Format Status

- There is currently no ESLint script in `package.json`.
- Use Prettier (`pnpm format` / `pnpm format:check`) for formatting.
- Treat typecheck (`pnpm typecheck`) plus build (`pnpm build`) as frontend quality gates.

### Pre-commit Hooks

- Husky + lint-staged are configured.
- Pre-commit hook runs `pnpm lint-staged`.
- lint-staged runs Prettier on staged frontend/docs files and `cargo fmt` for staged Rust files.

## Single-Test Commands (Important)

Current repository status:

- Frontend: Vitest is configured.
- Rust: single test execution is available via Cargo.

Use these when Rust tests exist:

- Run one Rust test by name substring:
  - `cargo test --manifest-path src-tauri/Cargo.toml test_name`
- Run one Rust integration/unit target exactly:
  - `cargo test --manifest-path src-tauri/Cargo.toml module::tests::case_name`

- Single test file: `pnpm exec vitest path/to/file.test.ts`
- Single test by name: `pnpm exec vitest path/to/file.test.ts -t "test name"`

## Pre-PR Verification Checklist

- `pnpm prepare:yosys-bundle`
- `pnpm build`
- `pnpm tauri build` for desktop-impacting changes
- `cargo test --manifest-path src-tauri/Cargo.toml` when Rust code changes
- Verify bundled Yosys-backed synthesis if you touched `src-tauri/src/hardware/synthesis.rs`, `src/components/pages/Synthesis.vue`, or CI/toolchain packaging.
- Verify Rust `fde` implementation/bitstream generation if you touched `src-tauri/src/hardware/implementation.rs`, `src/components/pages/Implementation.vue`, or CI/toolchain packaging.
- Manual smoke test in `pnpm dev` and `pnpm tauri dev`

## TypeScript and Vue Style

- Prefer `<script setup lang="ts">` for Vue SFCs.
- Keep TypeScript strict; do not weaken compiler options.
- Avoid `any`; prefer explicit types/interfaces and narrow unions.
- Use `import type` for type-only imports.
- Keep reactivity explicit (`ref`, `reactive`, `computed`) and typed.
- Use path alias `@/` for imports under `src`.
- Use relative imports for nearby sibling files when already local to a folder cluster.

## Import Conventions

Follow this order in TS/Vue scripts:

- Type imports first.
- External package imports next.
- Internal alias imports (`@/...`) next.
- Relative imports last.

Additional guidance:

- Keep import groups compact; one blank line between groups.
- Match existing quote style in the file you are editing.
- Do not reorder imports in large files unless needed for your change.

## Naming Conventions

- Vue components: PascalCase filenames (`ThemeToggleButton.vue`).
- Utility/helper functions: camelCase.
- Composable-style accessors: `useX` naming (for hooks/context accessors).
- Store objects: suffix `Store` (e.g., `projectStore`, `uiStore`).
- TS interfaces/types: PascalCase; union literals for constrained states.
- Rust structs/enums/traits: standard Rust naming (`CamelCase` types, `snake_case` funcs).

## Formatting Conventions

- Use 2-space indentation in Vue/TS/CSS/JSON files.
- Keep template class strings readable; group layout/spacing before color/state.
- Prefer small focused functions over deeply nested blocks.
- Add comments only when intent is not obvious from code.

## Error Handling Conventions

- Never silently swallow meaningful errors.
- In UI async flows, surface failures in user-facing state when possible.
- In Rust commands, propagate errors with `Result<_, String>` using explicit `map_err` context.
- Keep cleanup in `finally`/drop-equivalent paths where required.
- Do not leave empty catch blocks unless intentionally benign and documented.

## Tauri and Rust Patterns

- Expose frontend-callable methods via `#[tauri::command]`.
- Register commands in `tauri::generate_handler![]` inside `run()`.
- Keep blocking hardware/IO operations off the async runtime using `spawn_blocking`.
- Maintain thread-safe shared state with `Arc<Mutex<...>>` when needed.
- Emit frontend events with stable event names and predictable payload shape.

## UI and Styling Patterns

- Reuse existing primitives in `src/components/ui/` before creating new base components.
- Use `cn()` helper (`src/lib/utils.ts`) for conditional class composition.
- Keep theme tokens in `src/index.css`; prefer tokenized colors over hardcoded random values.
- Use existing icon package (`lucide-vue-next`) consistently.

## Cursor and Copilot Rules

- `.cursor/rules/`: not found.
- `.cursorrules`: not found.
- `.github/copilot-instructions.md`: not found.
- If these files are added later, treat them as higher-priority agent instructions.

## Commit and PR Expectations

- Use Conventional Commits (`feat: ...`, `fix: ...`, `refactor: ...`, `docs: ...`).
- Keep commits focused and avoid unrelated file churn.
- PRs should include intent, risk notes, and manual verification steps.
- Include screenshots/GIFs for visible UI changes.

## Agent Guardrails

- Do not invent commands that are not configured in this repo.
- Verify command availability from `package.json`/config before recommending.
- When introducing new tooling (lint/test), update this file in the same PR.
- Prefer incremental, pattern-matching edits over large rewrites.
