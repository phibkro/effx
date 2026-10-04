import { assert } from "@effect/vitest";

/** Fail when the source compiler or selected config evaluates an application entry. */
export const failOnApplicationImport = (entry: string): void => {
  assert.fail(`effx evaluated application ${entry} while loading its config or compiling`);
};
