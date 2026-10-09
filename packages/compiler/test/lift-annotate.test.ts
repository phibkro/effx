import { assert, describe, expectTypeOf, it } from "@effect/vitest";
import { Context, Result } from "effect";
import type { SymbolRef } from "@effx/ir";
import { A, Annotation } from "@effx/runtime";
import {
  LiftDiagnostics,
  Terms,
  extension,
  implement,
  lift,
  liftRegistryOf,
  type DefinitionLift,
  type EffectModel,
  type LiftResult,
  type LiftSite,
  type ReadArgs,
  type StepRecord,
  type Term,
} from "@effx/compiler";
import { lowered, range } from "./lift-support.ts";
import { profileFullModel, profileInput } from "./lift-profile.ts";

const symbolOf = (module: string, name: string): SymbolRef => ({ module, export: name });

class RateLimitPolicy extends Context.Service<
  RateLimitPolicy,
  {
    readonly perMinute: number;
    readonly burst?: number;
  }
>()("app/RateLimit") {}

const RateLimit = Annotation.define({
  name: "app.RateLimit",
  target: "operation",
  args: { perMinute: A.int, burst: A.optional(A.int) },
  cardinality: "one",
  effect: { target: "endpoint", key: RateLimitPolicy },
});

const DEFINITION_MODULE = "./src/user-annotation";

const RateLimitRef = symbolOf(DEFINITION_MODULE, "RateLimit");

const RateLimitPolicyRef = symbolOf(DEFINITION_MODULE, "RateLimitPolicy");

const RateLimitRecord = {
  ref: RateLimitRef,
  name: "app.RateLimit",
  key: { ref: RateLimitPolicyRef, id: "app/RateLimit" },
} as const;

const annotateStep = (keyTerm: Term, json: Parameters<typeof Terms.lit>[0]): StepRecord => ({
  _tag: "Method",
  name: "annotate",
  args: [lowered(keyTerm, 804, 900), lowered(Terms.lit(json), 902, 940)],
  range: range(804, 940),
});

const annotateModel = (keyTerm: Term, json: Parameters<typeof Terms.lit>[0]): EffectModel => ({
  ...profileFullModel,
  endpoints: profileFullModel.endpoints.map((endpoint, index) =>
    index === 0
      ? { ...endpoint, steps: [...endpoint.steps, annotateStep(keyTerm, json)] }
      : endpoint,
  ),
  definitions: [RateLimitRecord],
});

const liftWith = (model: EffectModel, implementations: Parameters<typeof extension>[1]) =>
  lift(model, profileInput, liftRegistryOf([extension("app", implementations)]));

const annotationsOf = (result: LiftResult) =>
  result.collected.declarations.flatMap((declaration) =>
    declaration.annotations.filter((annotation) => annotation.name === "app.RateLimit"),
  );

const messagesOf = (result: LiftResult) =>
  result.diagnostics.map((diagnostic) => diagnostic.message);

describe("the definition-owned `.annotate` lift", () => {
  it("recognizes the writer spelling with the definition's own record facts", () => {
    const result = liftWith(
      annotateModel(Terms.member(Terms.member(Terms.ref(RateLimitRef), "effect"), "key"), {
        perMinute: 60,
        burst: 5,
      }),
      [implement(RateLimit)],
    );

    assert.deepStrictEqual(
      annotationsOf(result),
      [{ name: "app.RateLimit", args: [{ perMinute: 60, burst: 5 }], definition: RateLimitRef }],
      messagesOf(result).join("\n"),
    );
  });

  it("recognizes the hand-written key spelling through the same record", () => {
    const result = liftWith(
      annotateModel(Terms.ref(RateLimitPolicyRef), { perMinute: 60, burst: 5 }),
      [implement(RateLimit)],
    );

    assert.deepStrictEqual(
      annotationsOf(result),
      [{ name: "app.RateLimit", args: [{ perMinute: 60, burst: 5 }], definition: RateLimitRef }],
      messagesOf(result).join("\n"),
    );
  });

  it("keeps unregistered refs faithful", () => {
    const mystery = symbolOf("./src/mystery", "MysteryKey");

    const result = liftWith(annotateModel(Terms.ref(mystery), { perMinute: 60 }), [
      implement(RateLimit),
    ]);

    assert.include(
      messagesOf(result),
      LiftDiagnostics.EFFX3001.emit({
        _tag: "UnknownAnnotationKey",
        subject: "profile.readOwnProfile",
        key: "MysteryKey",
      }).message,
    );
    assert.deepStrictEqual(annotationsOf(result), []);
  });

  it("invokes the typed recognizer at the selected key", () => {
    const recognize: DefinitionLift<typeof RateLimit>["recognize"] = (site) => {
      expectTypeOf(site).toEqualTypeOf<LiftSite<typeof RateLimit>>();
      const args: ReadArgs<typeof RateLimit> = [{ perMinute: 120 }];

      return Result.succeed(args);
    };

    const result = liftWith(annotateModel(Terms.ref(RateLimitPolicyRef), { perMinute: 60 }), [
      implement(RateLimit, { lift: { recognize } }),
    ]);

    assert.deepStrictEqual(
      annotationsOf(result),
      [{ name: "app.RateLimit", args: [{ perMinute: 120 }], definition: RateLimitRef }],
      messagesOf(result).join("\n"),
    );
  });

  it("blocks a rejected hook site", () => {
    const recognize: DefinitionLift<typeof RateLimit>["recognize"] = () =>
      Result.fail({ _tag: "Unsupported", construct: "a rejected recognize site" });

    const result = liftWith(annotateModel(Terms.ref(RateLimitPolicyRef), { perMinute: 60 }), [
      implement(RateLimit, { lift: { recognize } }),
    ]);

    assert.deepStrictEqual(annotationsOf(result), []);
    assert.include(
      messagesOf(result),
      LiftDiagnostics.EFFX3011.emit({
        subject: "profile.readOwnProfile",
        reason: "hook-failed",
        construct: "a rejected recognize site",
      }).message,
    );
  });

  it("contains hook throws in the closed throw reason", () => {
    const recognize: DefinitionLift<typeof RateLimit>["recognize"] = () => {
      throw new Error("private payload");
    };

    const result = liftWith(annotateModel(Terms.ref(RateLimitPolicyRef), { perMinute: 60 }), [
      implement(RateLimit, { lift: { recognize } }),
    ]);

    assert.deepStrictEqual(annotationsOf(result), []);
    assert.include(
      messagesOf(result),
      LiftDiagnostics.EFFX3011.emit({
        subject: "profile.readOwnProfile",
        reason: "hook-threw",
      }).message,
    );
  });
});
