import type { HttpAccessAnnotationSpec } from "@effx/runtime";
import { Schema } from "effect";
import { type SCOPE_RESOLVER_IDS } from "@vektorprogrammet/domain/authz";
import { accessSpecAnnotations, personNativeAccess } from "./access.js";

/** An explicit symbol-to-resolver mapping for the Profile contract. */
export const ProfileCurrentPerson = { id: "profile.current-person" } as const satisfies {
  readonly id: (typeof SCOPE_RESOLVER_IDS)[number];
};

const Resolver = Schema.Unknown.pipe(
  Schema.check(
    Schema.makeFilter((value) => value === ProfileCurrentPerson, {
      message: "the exported ProfileCurrentPerson resolver symbol",
    }),
  ),
);

const ProfileAccess = Schema.Struct({
  exposure: Schema.Literal("External"),
  acceptedCredentials: Schema.Tuple([
    Schema.Literal("BetterAuthCookie"),
    Schema.Literal("OAuthUserBearer"),
  ]),
  principalKinds: Schema.Tuple([Schema.Literal("Person")]),
  capabilities: Schema.TaggedStruct("One", {
    capability: Schema.Literals(["profile.read-self", "profile.update-self"]),
  }),
  requirements: Schema.Tuple([
    Schema.Struct({
      id: Schema.Literal("profile.owner"),
      parameters: Schema.optionalKey(Schema.Record(Schema.String, Schema.Never)),
    }),
  ]),
  canonicalScopeResolver: Resolver,
  concealment: Schema.TaggedStruct("Reveal", {}),
  decisionTime: Schema.Literals(["SnapshotRead", "Transaction"]),
}).pipe(
  Schema.check(
    Schema.makeFilter(
      (spec) =>
        (spec.capabilities.capability === "profile.read-self" &&
          spec.decisionTime === "SnapshotRead") ||
        (spec.capabilities.capability === "profile.update-self" &&
          spec.decisionTime === "Transaction"),
      { message: "Profile reads use SnapshotRead and updates use Transaction" },
    ),
  ),
);

const decodeProfileAccess = Schema.decodeUnknownSync(ProfileAccess, {
  onExcessProperty: "error",
});

/** Derives the native AccessSpec only for the exact person-owned Profile declarations. */
export const profileAccessAnnotations = (input: HttpAccessAnnotationSpec) => {
  const spec = decodeProfileAccess(input);

  return accessSpecAnnotations(
    personNativeAccess({
      capability: spec.capabilities.capability,
      canonicalScopeResolver: ProfileCurrentPerson.id,
      requirements: spec.requirements.map(({ id }) => id),
      decisionTime: spec.decisionTime,
    }),
  );
};
