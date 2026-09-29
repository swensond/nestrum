# 0001 — Workspace tooling

## Status

Accepted for Phase 0.

## Context

The roadmap requires TypeScript 7, pnpm, Vitest, ESM, strict checking, and `vitest.workspace.ts`. The registry provides TypeScript 7.0.2 and Vitest 5.0.2. Current Vitest uses `test.projects`; legacy workspace discovery is deprecated.

## Decision

Pin TypeScript 7.0.2, Vitest 5.0.2, and pnpm 12.6.0. Use the stable `tsc` binary rather than a preview dependency. Declare the Vitest-supported Node engine range (`^22.12.0 || ^24.0.0 || >=26.0.0`).

Use strict NodeNext module resolution and ES2022 output. The core build emits JavaScript, declaration files, and maps without test files. A separate root no-emit configuration checks source, tests, and Vitest configuration with explicit Node ambient types. Root `check` runs tests, typecheck, and build.

Keep `vitest.workspace.ts` as an ordinary typed project list explicitly imported by `vitest.config.ts` into `test.projects`. This preserves the requested layout using current Vitest APIs.

## Consequences

The workspace needs no preview compiler or deprecated Vitest workspace option. New packages must add their test project and review root typecheck coverage. Runtime packages may later need separate compiler configurations, especially for Svelte and browser code. Packages are private until publishing is deliberately designed.

## References

- [TypeScript 7 compiler usage](https://github.com/microsoft/typescript/blob/v7.0.2/tsc/README.md)
- [Vitest projects](https://vitest.dev/guide/projects)
- [pnpm workspace](https://pnpm.io/workspaces)
