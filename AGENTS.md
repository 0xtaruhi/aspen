# Repository Guidelines

## Project Structure & Module Organization
The Vite + Vue 3 front end lives in `src`, with the entry point in `src/main.ts` and the root layout in `src/App.vue`. Shared UI is collected under `src/components`, reusable logic in `src/lib`, and static assets in `src/assets`; place global styles in `src/index.css`. Tauri’s Rust shell resides in `src-tauri/` (`src-tauri/src/main.rs` orchestrates commands, `src-tauri/src/lib.rs` hosts shared modules, and `tauri.conf.json` captures window/config tweaks), while production-ready static files belong in `public/`.

## Build, Test, and Development Commands
- `pnpm install` — install both Node and Tauri CLI dependencies.
- `pnpm dev` — launch the Vite dev server with hot module replacement for rapid UI iteration.
- `pnpm tauri dev` — boot the desktop shell with the bundled front end; use this for end-to-end smoke checks.
- `pnpm build` — run `vue-tsc --noEmit` for strict type validation and generate the production bundle in `dist/`.
- `pnpm preview` — serve the built bundle locally to validate release artefacts.
- `pnpm tauri build` — produce platform-specific binaries through the Tauri CLI (ensure `rustup` targets are installed).

## Coding Style & Naming Conventions
Use two-space indentation for Vue SFCs, TypeScript, and JSON. Components follow PascalCase filenames (e.g., `StatusPanel.vue`), composables use the `useX` pattern inside `src/lib`, and helper functions stay in camelCase. Prefer `<script setup lang="ts">` with explicit prop typing, keep Tailwind utility classes grouped by layout → color → state, and run `pnpm exec vue-tsc --noEmit` before pushing. Rust modules should obey `rustfmt` (via `cargo fmt`) and keep command handlers in `src-tauri/src/main.rs`.

## Testing Guidelines
Automated tests are not yet scaffolded; perform manual verification in both the browser (`pnpm dev`) and desktop shell (`pnpm tauri dev`) before opening a PR. Document the scenarios exercised in the PR description, and add regression checks whenever you introduce new user flows. If you add automated tests, co-locate UI specs under `src/__tests__/` using Vitest (install with `pnpm add -D vitest`), and place Rust unit tests alongside code with `#[cfg(test)]`, then run them through `pnpm exec vitest` or `cargo test`.

## Commit & Pull Request Guidelines
No shared Git history is available here, so adopt Conventional Commits (`feat: add widget layout`, `fix: resolve tauri splash crash`) to keep logs readable. Keep commits focused and code-formatted, and reference issue IDs where applicable. PRs should explain intent, list manual verification steps, and include screenshots for visual changes or Tauri window adjustments.
