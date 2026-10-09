/**
 * Core-owned lift tests still bound to the retired rc.116 fixture helper. The Core owner migrates
 * them from the integration head (STATE.md "Open gap"). `tsconfig.json` `exclude` repeats this list
 * because JSON cannot import it.
 */
export const parkedTests: ReadonlyArray<string> = [
  "packages/frontend-ts/test/bindings-rc116.test.ts",
  "packages/frontend-ts/test/dense-status.test.ts",
  "packages/frontend-ts/test/errors-static-members.test.ts",
  "packages/frontend-ts/test/problem-naming.test.ts",
];
