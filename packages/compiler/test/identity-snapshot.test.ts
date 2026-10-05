import { assert, describe, it } from "@effect/vitest";
import { type Collected, StageResult } from "@effx/compiler";
import { Effect } from "effect";
import { collectedSnapshot } from "../../../scripts/identity-snapshot.ts";

describe("identity snapshot data projection", () => {
  it("drops execution-only resolvers without changing serialized evidence", () => {
    const data: Collected = { declarations: [], diagnostics: [] };
    const capturedProgram = { marker: "frontend Program" };

    const collected: Collected = {
      ...data,
      resolveEffectModule: () => capturedProgram.marker.length > 0,
      resolveHttpApiInventory: () => Effect.succeed(StageResult.succeed([])),
    };

    const projected = collectedSnapshot(collected);

    assert.deepStrictEqual(projected, data);
    assert.strictEqual(JSON.stringify(projected), JSON.stringify(collected));
    assert.isFalse(Object.hasOwn(projected, "resolveEffectModule"));
    assert.isFalse(Object.hasOwn(projected, "resolveHttpApiInventory"));
  });
});
