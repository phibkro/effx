import { assert, describe, it } from "@effect/vitest";
import { expectTypeOf } from "vitest";
import {
  Capability,
  Concealment,
  type AccessCapabilities,
  type AccessConcealment,
  type NonEmptyStrings,
} from "@effx/runtime";

describe("@effx/runtime tagged access values", () => {
  it("constructs the same plain capability values as source literals", () => {
    assert.deepStrictEqual(Capability.one("profile.read"), {
      _tag: "One",
      capability: "profile.read",
    });
    assert.deepStrictEqual(Capability.any("profile.read"), {
      _tag: "Any",
      capabilities: ["profile.read"],
    });
    assert.deepStrictEqual(Capability.any("profile.read", "profile.owner"), {
      _tag: "Any",
      capabilities: ["profile.read", "profile.owner"],
    });
    assert.deepStrictEqual(Capability.all("profile.read"), {
      _tag: "All",
      capabilities: ["profile.read"],
    });
    assert.deepStrictEqual(Capability.all("profile.read", "profile.owner"), {
      _tag: "All",
      capabilities: ["profile.read", "profile.owner"],
    });
    assert.deepStrictEqual(Capability.none, { _tag: "None" });
  });

  it("constructs the same plain concealment values as source literals", () => {
    assert.deepStrictEqual(Concealment.reveal, { _tag: "Reveal" });
    assert.deepStrictEqual(Concealment.notFound("Resolve"), {
      _tag: "NotFound",
      stages: ["Resolve"],
    });
    assert.deepStrictEqual(Concealment.notFound("Resolve", "Authorize"), {
      _tag: "NotFound",
      stages: ["Resolve", "Authorize"],
    });
  });

  it("retains precise readonly tags and nonempty tuple types in the public API", () => {
    expectTypeOf(Capability.one("profile.read")).toExtend<AccessCapabilities>();
    expectTypeOf(Capability.one("profile.read")._tag).toEqualTypeOf<"One">();
    expectTypeOf(Capability.any("profile.read")).toExtend<AccessCapabilities>();
    expectTypeOf(Capability.any("profile.read")._tag).toEqualTypeOf<"Any">();
    expectTypeOf(Capability.any("profile.read").capabilities).toEqualTypeOf<NonEmptyStrings>();
    expectTypeOf(Capability.all("profile.read")).toExtend<AccessCapabilities>();
    expectTypeOf(Capability.all("profile.read")._tag).toEqualTypeOf<"All">();
    expectTypeOf(Capability.all("profile.read").capabilities).toEqualTypeOf<NonEmptyStrings>();
    expectTypeOf(Capability.none._tag).toEqualTypeOf<"None">();
    expectTypeOf(Concealment.reveal._tag).toEqualTypeOf<"Reveal">();
    expectTypeOf(Concealment.notFound("Resolve")).toExtend<AccessConcealment>();
    expectTypeOf(Concealment.notFound("Resolve")._tag).toEqualTypeOf<"NotFound">();
    expectTypeOf(Concealment.notFound("Resolve").stages).toEqualTypeOf<NonEmptyStrings>();
    expectTypeOf<
      [] extends Parameters<typeof Capability.any> ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      [] extends Parameters<typeof Capability.all> ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      [] extends Parameters<typeof Concealment.notFound> ? true : false
    >().toEqualTypeOf<false>();
  });
});
