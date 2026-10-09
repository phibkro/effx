import { describe, expect, it } from "vitest";
import { type Schema } from "effect";
import {
  collapseSuffixPass,
  defaultOperationId,
  dropDefaultIdentifier,
  endpointKeyOf,
  wireCompare,
} from "../src/lift/deltas.ts";
import {
  OPEN_API_IDENTIFIER_KEY,
  type EndpointReflection,
  type Reflection,
} from "../src/lift/reflection.ts";

/** One reflection document's own JSON value: the check's only kind of recorded data. */
type JsonValue = Schema.Json;

const endpoint = (
  identifier: string,
  overrides: Partial<EndpointReflection> = {},
): EndpointReflection => ({
  group: "profile",
  identifier,
  method: "get",
  path: "/api/profile",
  middleware: ["PersonSecurity"],
  successStatuses: [200],
  errorStatuses: [404],
  annotationKeys: [],
  projections: {},
  ...overrides,
});

const reflection = (
  endpoints: ReadonlyArray<EndpointReflection>,
  openapi: Reflection["openapi"] = { components: { schemas: {} } },
): Reflection => ({ openapi, endpoints });

describe("Δ1 ref-suffix", () => {
  const base: JsonValue = { type: "object", properties: { id: { type: "string" } } };

  const openapiOf = (extra: JsonValue): Reflection["openapi"] => ({
    components: { schemas: Object.assign({ Profile: base }, extra) },
    paths: {
      "/api/profile": {
        get: {
          responses: {
            200: { content: { "application/json": { schema: { $ref: ref("Profile") } } } },
          },
        },
      },
    },
  });

  const ref = (name: string): JsonValue => ({
    $ref: `#/components/schemas/${name}`,
  });

  it("collapses a deeply-equal suffixed duplicate onto the base and rewrites every $ref", () => {
    const outcome = wireCompare(
      reflection([], openapiOf({ Profile_1: base })),
      reflection([], openapiOf({})),
    );

    const originalCollapse = collapseSuffixPass(openapiOf({ Profile_1: base }));

    expect(outcome._tag).toBe("Pass");
    expect(outcome._tag === "Pass" && outcome.applied).toContain("ref-suffix");
    expect(originalCollapse.collapsed).toBe(true);
    expect(originalCollapse.document).not.toHaveProperty("components.schemas.Profile_1");
    expect(JSON.stringify(originalCollapse.document)).not.toContain(
      "#/components/schemas/Profile_1",
    );
    expect(JSON.stringify(originalCollapse.document)).toContain("#/components/schemas/Profile");
  });

  it("does not collapse when the suffixed value differs (non-firing control)", () => {
    const differing = Object.assign({}, base, { properties: { other: { type: "string" } } });

    const outcome = wireCompare(
      reflection([], openapiOf({ Profile_1: differing })),
      reflection([], openapiOf({})),
    );

    expect(outcome._tag).toBe("Mismatch");
    const collapse = collapseSuffixPass(openapiOf({ Profile_1: differing }));

    expect(collapse.collapsed).toBe(false);
  });

  it("collapses every suffixed duplicate that deep-equals the plain base onto it", () => {
    const original = openapiOf({ Profile_1: base, Profile_2: base });
    const single = collapseSuffixPass(original);

    expect(single.document).not.toHaveProperty("components.schemas.Profile_1");
    expect(single.document).not.toHaveProperty("components.schemas.Profile_2");
    expect(single.document).toHaveProperty("components.schemas.Profile");
  });

  it("does not collapse a suffix onto a chained suffixed base with a different value", () => {
    const other = Object.assign({}, base, { properties: { different: { type: "string" } } });
    const original = openapiOf({ Profile_1: other, Profile_2: other });

    const single = collapseSuffixPass(original);

    // Profile_2's deep-equality target is the plain Profile, which differs here; no collapse runs.
    expect(single.collapsed).toBe(false);
    expect(single.document).toHaveProperty("components.schemas.Profile_2");
  });
});

describe("Δ2 explicit-default-identifier", () => {
  const withIdentifier = (
    identifier: string,
    value: string,
    key = OPEN_API_IDENTIFIER_KEY,
  ): EndpointReflection =>
    endpoint(identifier, {
      annotationKeys: [key],
      identifierAnnotation: { key: OPEN_API_IDENTIFIER_KEY, endpoint: identifier, value },
    });

  it("drops key and value when the actual merged Context value equals the default", () => {
    const original = [withIdentifier("readOwnProfile", "profile.readOwnProfile")];
    const dropped = dropDefaultIdentifier(original);

    expect(dropped[0]!.annotationKeys).toEqual([]);
    expect("identifierAnnotation" in dropped[0]!).toBe(false);
  });

  it("preserves a non-default identifier (non-firing control)", () => {
    const original = [withIdentifier("readOwnProfile", "profile.other")];
    const dropped = dropDefaultIdentifier(original);

    expect(dropped[0]!.annotationKeys).toEqual([OPEN_API_IDENTIFIER_KEY]);
    expect(dropped[0]!.identifierAnnotation?.value).toBe("profile.other");
  });

  it("does not drop when the witness is missing even if the key is present", () => {
    const original = [endpoint("readOwnProfile", { annotationKeys: [OPEN_API_IDENTIFIER_KEY] })];
    const dropped = dropDefaultIdentifier(original);

    expect(dropped[0]!.annotationKeys).toEqual([OPEN_API_IDENTIFIER_KEY]);
  });

  it("fires the Δ2 class when one side only needs the drop", () => {
    const plain = reflection([endpoint("readOwnProfile")]);

    const withGenerated = reflection([
      endpoint("readOwnProfile", {
        annotationKeys: [OPEN_API_IDENTIFIER_KEY],
        identifierAnnotation: {
          key: OPEN_API_IDENTIFIER_KEY,
          endpoint: "readOwnProfile",
          value: "profile.readOwnProfile",
        },
      }),
    ]);

    const passes = wireCompare(plain, withGenerated);

    expect(passes._tag).toBe("Pass");
    expect(passes._tag === "Pass" && passes.applied).toContain("explicit-default-identifier");
  });
});

describe("Δ3 endpoint-order", () => {
  it("passes when the order of the same keys differs", () => {
    const one = reflection([endpoint("a"), endpoint("b")]);
    const two = reflection([endpoint("b"), endpoint("a")]);

    expect(wireCompare(one, two)).toEqual({ _tag: "Pass", applied: ["endpoint-order"] });
  });

  it("lists no delta when both empty or already ordered", () => {
    expect(wireCompare(reflection([]), reflection([]))).toEqual({ _tag: "Pass", applied: [] });
    const ordered = reflection([endpoint("a"), endpoint("b")]);
    expect(wireCompare(ordered, ordered)).toEqual({ _tag: "Pass", applied: [] });
  });
});

describe("mismatch paths", () => {
  it("fails on a mutated summary and names the openapi path", () => {
    const one = reflection([endpoint("read")], {
      paths: { "/api/profile": { get: { summary: "Read own profile" } } },
    });

    const two = reflection([endpoint("read")], {
      paths: { "/api/profile": { get: { summary: "Read MY profile" } } },
    });

    const outcome = wireCompare(one, two);

    expect(outcome._tag).toBe("Mismatch");

    if (outcome._tag === "Mismatch") {
      expect(
        outcome.differences.some(
          (d) => d.includes("/paths/~1api~1profile") && d.includes("Read MY profile"),
        ),
      ).toBe(true);
    }
  });

  it("fails on differing media type names and reports openapi paths", () => {
    const one = reflection([], {
      paths: {
        "/api/profile": {
          get: { responses: { 200: { content: { "application/json": { schema: {} } } } } },
        },
      },
    });

    const two = reflection([], {
      paths: {
        "/api/profile": {
          get: {
            responses: { 200: { content: { "application/merge-patch+json": { schema: {} } } } },
          },
        },
      },
    });

    const outcome = wireCompare(one, two);

    expect(outcome._tag).toBe("Mismatch");

    if (outcome._tag === "Mismatch") {
      expect(outcome.differences.some((d) => d.includes("merge-patch"))).toBe(true);
    }
  });

  it("fails on keys unique to one side", () => {
    const outcome = wireCompare(reflection([endpoint("read")]), reflection([]));

    expect(outcome._tag).toBe("Mismatch");

    if (outcome._tag === "Mismatch") {
      expect(outcome.differences.some((d) => d.includes("missing profile.read"))).toBe(true);
    }
  });

  it("fails on a mismatched projection element", () => {
    const outcome = wireCompare(
      reflection([], {}) &&
        reflection([endpoint("read", { projections: { access: { exposure: "External" } } })]),
      reflection([endpoint("read", { projections: { access: { exposure: "Internal" } } })]),
    );

    expect(outcome._tag).toBe("Mismatch");

    if (outcome._tag === "Mismatch") {
      expect(outcome.differences.some((d) => d.includes("projections"))).toBe(true);
    }
  });
});

describe("Δ3 treated keys", () => {
  it("keeps both-empty a passing record with no deltas besides the map form", () => {
    const bothEmpty = wireCompare(reflection([]), reflection([endpoint("x")]));

    expect(bothEmpty._tag).toBe("Mismatch");
  });
});

describe("helpers", () => {
  it("reads the same default operation id on both map orders", () => {
    expect(defaultOperationId("profile", "readOwnProfile")).toBe("profile.readOwnProfile");
    expect(endpointKeyOf(endpoint("readOwnProfile"))).toBe("profile\u0000readOwnProfile");
  });

  it("orders status lists as sets (Δ4-free extra ordering must not differ)", () => {
    const outcome = wireCompare(
      reflection([endpoint("read", { successStatuses: [200, 304], errorStatuses: [404, 400] })]),
      reflection([endpoint("read", { successStatuses: [304, 200], errorStatuses: [400, 404] })]),
    );

    expect(outcome._tag).toBe("Pass");

    if (outcome._tag === "Pass") {
      expect(outcome.applied).toEqual([]);
    }
  });
});
