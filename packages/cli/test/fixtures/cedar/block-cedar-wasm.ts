/*
 * Spec 0017 F3d: stands in for `@cedar-policy/cedar-wasm/nodejs` via a tsconfig `paths` override.
 * Loading it prints CEDAR_PROBE_LOADED and fails, which both proves `check`/`build` never load the
 * validator and simulates a missing optional peer for `effx cedar`.
 */
throw new Error("CEDAR_PROBE_LOADED: @cedar-policy/cedar-wasm is blocked by the test probe");
