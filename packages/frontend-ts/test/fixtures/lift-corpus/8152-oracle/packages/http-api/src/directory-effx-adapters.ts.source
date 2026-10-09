import type { HttpAccessAnnotationSpec } from "@effx/runtime";
import { type SCOPE_RESOLVER_IDS } from "@vektorprogrammet/domain/authz";
import { Match, Schema } from "effect";
import { accessSpecAnnotations, personNativeAccess } from "./access.js";

/** The resolver values are explicit symbols, not guessed from effx export names. */
export const PeopleDirectoryResolver = { id: "profile.people-directory" } as const satisfies {
  readonly id: (typeof SCOPE_RESOLVER_IDS)[number];
};

export const SchoolsDirectoryResolver = { id: "schools.directory" } as const satisfies {
  readonly id: (typeof SCOPE_RESOLVER_IDS)[number];
};

export const SchoolsManagementResolver = { id: "schools.management" } as const satisfies {
  readonly id: (typeof SCOPE_RESOLVER_IDS)[number];
};

const Resolver = Schema.Unknown.pipe(
  Schema.check(
    Schema.makeFilter(
      (value) =>
        value === PeopleDirectoryResolver ||
        value === SchoolsDirectoryResolver ||
        value === SchoolsManagementResolver,
      { message: "an exported directory scope resolver symbol" },
    ),
  ),
);

const DirectoryAccess = Schema.Struct({
  exposure: Schema.Literal("External"),
  acceptedCredentials: Schema.Tuple([
    Schema.Literal("BetterAuthCookie"),
    Schema.Literal("OAuthUserBearer"),
  ]),
  principalKinds: Schema.Tuple([Schema.Literal("Person")]),
  capabilities: Schema.TaggedStruct("One", {
    capability: Schema.Literals([
      "profile.read-directory",
      "schools.read-directory",
      "schools.manage",
    ]),
  }),
  requirements: Schema.Array(Schema.Never),
  canonicalScopeResolver: Resolver,
  concealment: Schema.TaggedStruct("Reveal", {}),
  decisionTime: Schema.Literals(["SnapshotRead", "Transaction"]),
}).pipe(
  Schema.check(
    Schema.makeFilter(
      (spec) => {
        switch (spec.capabilities.capability) {
          case "profile.read-directory":
            return (
              spec.canonicalScopeResolver === PeopleDirectoryResolver &&
              spec.decisionTime === "SnapshotRead"
            );
          case "schools.read-directory":
            return (
              spec.canonicalScopeResolver === SchoolsDirectoryResolver &&
              spec.decisionTime === "SnapshotRead"
            );
          case "schools.manage":
            return spec.canonicalScopeResolver === SchoolsManagementResolver;
        }
      },
      { message: "directory capabilities must use their own resolver and decision time" },
    ),
  ),
);

const decodeDirectoryAccess = Schema.decodeUnknownSync(DirectoryAccess, {
  onExcessProperty: "error",
});

/** Derives only the existing People/Schools directory and management AccessSpecs. */
export const directoryAccessAnnotations = (input: HttpAccessAnnotationSpec) => {
  const spec = decodeDirectoryAccess(input);

  const resolver = Match.value(spec.capabilities.capability).pipe(
    Match.when("profile.read-directory", () => PeopleDirectoryResolver),
    Match.when("schools.read-directory", () => SchoolsDirectoryResolver),
    Match.when("schools.manage", () => SchoolsManagementResolver),
    Match.exhaustive,
  );

  return accessSpecAnnotations(
    personNativeAccess({
      capability: spec.capabilities.capability,
      canonicalScopeResolver: resolver.id,
      decisionTime: spec.decisionTime,
    }),
  );
};
