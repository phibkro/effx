/**
 * TEMPORARY. Core-owned lift tests still bound to the retired rc.116 fixture helper. Owner: Core
 * (stable fixture migration). Removal: when these tests and the 57 Core fixtures run on the stable
 * helper in the gate, delete this file, its imports in `vitest.config.ts` and `oxlint.config.ts`, and
 * the matching `tsconfig.json` `exclude` entries (JSON cannot import this list). See STATE.md "Open gap".
 */
export const parkedTests: ReadonlyArray<string> = [
  "packages/frontend-ts/test/bindings-rc116.test.ts",
  "packages/frontend-ts/test/dense-status.test.ts",
  "packages/frontend-ts/test/errors-static-members.test.ts",
  "packages/frontend-ts/test/problem-naming.test.ts",
];
