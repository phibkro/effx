import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  Terms,
  nativeCalleeOf,
  type NativeCallee,
  type NativeKind,
  type TargetProfile,
  type Term,
} from "@effx/compiler";

/*
 * Native Effect identity is the frontend's typed claim, validated by the core against the ONE profile table
 * the generator imports from (`generate/target.ts`): stable is `effect/http-api`, rc.116 is
 * `effect/unstable/httpapi`. Nothing here freezes either module, and no spelling decides anything.
 */

const stable = "effect/http-api";

const rc = "effect/unstable/httpapi";

const claim = (
  target: TargetProfile,
  kind: NativeKind,
  module: string,
  member?: string,
): NativeCallee =>
  member === undefined
    ? { kind, target, ref: { module, export: kind } }
    : { kind, target, ref: { module, export: kind }, member };

const get = (module: string, kind: NativeKind = "HttpApiEndpoint"): Term =>
  Terms.member(Terms.ref({ module, export: kind }), "get");

interface Case {
  readonly name: string;
  readonly model: TargetProfile;
  readonly claims: ReadonlyArray<NativeCallee>;
  readonly term: Term;
  readonly found: boolean;
}

const cases: ReadonlyArray<Case> = [
  {
    name: "a stable claim inside the stable family",
    model: "effect-4.0",
    claims: [claim("effect-4.0", "HttpApiEndpoint", stable, "get")],
    term: get(stable),
    found: true,
  },
  {
    name: "an rc claim inside the rc family",
    model: "effect-4.0-rc",
    claims: [claim("effect-4.0-rc", "HttpApiEndpoint", rc, "get")],
    term: get(rc),
    found: true,
  },
  {
    name: "a claim on a module nested under the family root",
    model: "effect-4.0-rc",
    claims: [claim("effect-4.0-rc", "HttpApiEndpoint", `${rc}/HttpApiEndpoint`, "get")],
    term: get(`${rc}/HttpApiEndpoint`),
    found: true,
  },
  {
    name: "a stable module claimed under the rc target",
    model: "effect-4.0-rc",
    claims: [claim("effect-4.0-rc", "HttpApiEndpoint", stable, "get")],
    term: get(stable),
    found: false,
  },
  {
    name: "an rc module claimed under the stable target",
    model: "effect-4.0",
    claims: [claim("effect-4.0", "HttpApiEndpoint", rc, "get")],
    term: get(rc),
    found: false,
  },
  {
    name: "a claim made for another target than the model's",
    model: "effect-4.0-rc",
    claims: [claim("effect-4.0", "HttpApiEndpoint", stable, "get")],
    term: get(stable),
    found: false,
  },
  {
    name: "a different member than the claim names",
    model: "effect-4.0-rc",
    claims: [claim("effect-4.0-rc", "HttpApiEndpoint", rc, "post")],
    term: get(rc),
    found: false,
  },
  {
    name: "a member selected from a reference the claim does not name",
    model: "effect-4.0-rc",
    claims: [claim("effect-4.0-rc", "HttpApiEndpoint", rc, "get")],
    term: get(rc, "HttpApiGroup"),
    found: false,
  },
  {
    name: "a core kind on the core module",
    model: "effect-4.0-rc",
    claims: [claim("effect-4.0-rc", "Schema", "effect", "Struct")],
    term: Terms.member(Terms.ref({ module: "effect", export: "Schema" }), "Struct"),
    found: true,
  },
  {
    name: "a core kind claimed inside the http-api family",
    model: "effect-4.0-rc",
    claims: [claim("effect-4.0-rc", "Schema", `${rc}/Schema`, "Struct")],
    term: Terms.member(Terms.ref({ module: `${rc}/Schema`, export: "Schema" }), "Struct"),
    found: false,
  },
];

describe("nativeCalleeOf", () => {
  it.effect.each(cases)("$name: found=$found", ({ model, claims, term, found }) =>
    Effect.sync(() => {
      const callee = nativeCalleeOf(model, claims, term);

      assert.strictEqual(callee !== undefined, found);

      if (found) assert.deepStrictEqual(callee, claims[0]);
    }),
  );

  it.effect("names a bare reference only when the claim has no member", () =>
    Effect.sync(() => {
      const reference = { module: rc, export: "HttpApiSchema" };
      const bare = claim("effect-4.0-rc", "HttpApiSchema", rc);

      assert.deepStrictEqual(nativeCalleeOf("effect-4.0-rc", [bare], Terms.ref(reference)), bare);
      assert.isUndefined(
        nativeCalleeOf("effect-4.0-rc", [bare], Terms.member(Terms.ref(reference), "status")),
      );
    }),
  );

  it.effect("names nothing for a term that is not a reference or a member of one", () =>
    Effect.sync(() => {
      const claims = [claim("effect-4.0-rc", "HttpApiEndpoint", rc, "get")];

      for (const term of [
        Terms.lit("get"),
        Terms.call(get(rc), []),
        Terms.member(
          Terms.member(Terms.ref({ module: rc, export: "HttpApiEndpoint" }), "x"),
          "get",
        ),
      ])
        assert.isUndefined(nativeCalleeOf("effect-4.0-rc", claims, term));
    }),
  );
});
