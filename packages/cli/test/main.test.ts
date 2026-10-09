import { assert, describe, it } from "@effect/vitest";
import { CompilerFault, SourceFrontend, type TargetProfile } from "@effx/compiler";
import { ExecutableInventory, LspPlatform, main } from "@effx/cli";
import { Effect } from "effect";
import { expectTypeOf } from "vitest";

describe("portable CLI root contract", () => {
  it("keeps native capabilities and compiler failures visible until the process root provides them", () => {
    expectTypeOf<Effect.Success<typeof main>>().toEqualTypeOf<void>();
    expectTypeOf<
      Extract<Effect.Error<typeof main>, CompilerFault>
    >().toEqualTypeOf<CompilerFault>();
    expectTypeOf<
      Extract<Effect.Services<typeof main>, SourceFrontend>
    >().toEqualTypeOf<SourceFrontend>();
    expectTypeOf<Extract<Effect.Services<typeof main>, LspPlatform>>().toEqualTypeOf<LspPlatform>();
    expectTypeOf<
      Extract<Effect.Services<typeof main>, ExecutableInventory>
    >().toEqualTypeOf<ExecutableInventory>();
    expectTypeOf<TargetProfile>().toEqualTypeOf<"effect-4.0">();
  });

  it.effect(
    "constructs and discards substituted native capabilities without performing setup",
    () =>
      Effect.sync(() => {
        let calls = 0;

        const setup = Effect.sync(() => {
          calls++;
          throw new Error("discarded root must never acquire a native capability");
        });

        const discarded = main.pipe(
          Effect.provideService(LspPlatform, { acquireIO: setup }),
          Effect.provideService(ExecutableInventory, { keys: setup }),
        );

        assert.isTrue(Effect.isEffect(discarded));
        assert.strictEqual(calls, 0);
      }),
  );
});
