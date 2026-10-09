import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  Terms,
  nativeCalleeOf,
  type NativeCallee,
  type NativeKind,
  type Term,
} from "@effx/compiler";

const target = "effect-4.0";

const httpApi = "effect/http-api";

const claim = (kind: NativeKind, module: string, member?: string): NativeCallee =>
  member === undefined
    ? { kind, target, ref: { module, export: kind } }
    : { kind, target, ref: { module, export: kind }, member };

const get = (module: string, kind: NativeKind = "HttpApiEndpoint"): Term =>
  Terms.member(Terms.ref({ module, export: kind }), "get");

interface Case {
  readonly name: string;
  readonly claims: ReadonlyArray<NativeCallee>;
  readonly term: Term;
  readonly found: boolean;
}

const cases: ReadonlyArray<Case> = [
  {
    name: "a stable HTTP API namespace claim",
    claims: [claim("HttpApiEndpoint", httpApi, "get")],
    term: get(httpApi),
    found: true,
  },
  {
    name: "a nested module under the stable HTTP API family",
    claims: [claim("HttpApiEndpoint", httpApi + "/HttpApiEndpoint", "get")],
    term: get(httpApi + "/HttpApiEndpoint"),
    found: true,
  },
  {
    name: "a different member than the claim names",
    claims: [claim("HttpApiEndpoint", httpApi, "post")],
    term: get(httpApi),
    found: false,
  },
  {
    name: "a member selected from a reference the claim does not name",
    claims: [claim("HttpApiEndpoint", httpApi, "get")],
    term: get(httpApi, "HttpApiGroup"),
    found: false,
  },
  {
    name: "a module outside the HTTP API family",
    claims: [claim("HttpApiEndpoint", "effect", "get")],
    term: get("effect"),
    found: false,
  },
  {
    name: "a core kind on the core module",
    claims: [claim("Schema", "effect", "Struct")],
    term: Terms.member(Terms.ref({ module: "effect", export: "Schema" }), "Struct"),
    found: true,
  },
  {
    name: "a core kind claimed inside the HTTP API family",
    claims: [claim("Schema", httpApi + "/Schema", "Struct")],
    term: Terms.member(Terms.ref({ module: httpApi + "/Schema", export: "Schema" }), "Struct"),
    found: false,
  },
];

describe("nativeCalleeOf", () => {
  it.effect.each(cases)("$name: found=$found", ({ claims, term, found }) =>
    Effect.sync(() => {
      const callee = nativeCalleeOf(target, claims, term);

      assert.strictEqual(callee !== undefined, found);

      if (found) assert.deepStrictEqual(callee, claims[0]);
    }),
  );

  it.effect("names a bare reference only when the claim has no member", () =>
    Effect.sync(() => {
      const reference = { module: httpApi, export: "HttpApiSchema" };
      const bare = claim("HttpApiSchema", httpApi);

      assert.deepStrictEqual(nativeCalleeOf(target, [bare], Terms.ref(reference)), bare);
      assert.isUndefined(
        nativeCalleeOf(target, [bare], Terms.member(Terms.ref(reference), "status")),
      );
    }),
  );

  it.effect("names nothing for terms outside a claimed reference/member form", () =>
    Effect.sync(() => {
      const claims = [claim("HttpApiEndpoint", httpApi, "get")];

      for (const term of [
        Terms.lit("get"),
        Terms.call(get(httpApi), []),
        Terms.member(
          Terms.member(Terms.ref({ module: httpApi, export: "HttpApiEndpoint" }), "x"),
          "get",
        ),
      ])
        assert.isUndefined(nativeCalleeOf(target, claims, term));
    }),
  );
});
