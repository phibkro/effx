import type { HttpAccessAnnotationSpec } from "@effx/runtime";
import {
  type AuthorizationMode,
  CAPABILITY_TYPE_IDS,
  type SCOPE_RESOLVER_IDS,
} from "@vektorprogrammet/domain/authz";
import { Schema, Struct } from "effect";
import { accessSpecAnnotations, personNativeAccess } from "./access.js";

/** Explicit exported resolver symbols used by the SocialEvents contract. */
export const SocialEventsScopeResolver = { id: "social-events.scope" } as const satisfies {
  readonly id: (typeof SCOPE_RESOLVER_IDS)[number];
};

export const SocialEventsListResolver = { id: "social-events.list" } as const satisfies {
  readonly id: (typeof SCOPE_RESOLVER_IDS)[number];
};

export const SocialEventsCreateResolver = { id: "social-events.create" } as const satisfies {
  readonly id: (typeof SCOPE_RESOLVER_IDS)[number];
};

const socialEventsPolicies = {
  "social-events.read-scope": {
    resolver: SocialEventsScopeResolver,
    decisionTime: "SnapshotRead",
  },
  "social-events.read": {
    resolver: SocialEventsListResolver,
    decisionTime: "SnapshotRead",
  },
  "social-events.create": {
    resolver: SocialEventsCreateResolver,
    decisionTime: "Transaction",
  },
} as const satisfies Partial<
  Record<
    (typeof CAPABILITY_TYPE_IDS)[number],
    {
      readonly resolver: { readonly id: (typeof SCOPE_RESOLVER_IDS)[number] };
      readonly decisionTime: AuthorizationMode;
    }
  >
>;

type SocialEventsCapability = keyof typeof socialEventsPolicies;

/** The same person access specification for current endpoints and future declarations. */
export const socialEventsPersonAccess = (capability: SocialEventsCapability) => {
  const policy = socialEventsPolicies[capability];

  return personNativeAccess({
    capability,
    canonicalScopeResolver: policy.resolver.id,
    decisionTime: policy.decisionTime,
  });
};

const SocialEventsAccess = Schema.Struct({
  exposure: Schema.Literal("External"),
  acceptedCredentials: Schema.Tuple([
    Schema.Literal("BetterAuthCookie"),
    Schema.Literal("OAuthUserBearer"),
  ]),
  principalKinds: Schema.Tuple([Schema.Literal("Person")]),
  capabilities: Schema.TaggedStruct("One", {
    capability: Schema.Literals(Struct.keys(socialEventsPolicies)),
  }),
  requirements: Schema.Array(Schema.Never),
  canonicalScopeResolver: Schema.Unknown,
  concealment: Schema.TaggedStruct("Reveal", {}),
  decisionTime: Schema.String,
}).pipe(
  Schema.check(
    Schema.makeFilter(
      (spec) => {
        const policy = socialEventsPolicies[spec.capabilities.capability];

        return (
          spec.canonicalScopeResolver === policy.resolver &&
          spec.decisionTime === policy.decisionTime
        );
      },
      { message: "SocialEvents capabilities must use their own resolver and decision time" },
    ),
  ),
);

const decodeSocialEventsAccess = Schema.decodeUnknownSync(SocialEventsAccess, {
  onExcessProperty: "error",
});

/** Derives native annotations only for the three existing SocialEvents access triples. */
export const socialEventsAccessAnnotations = (input: HttpAccessAnnotationSpec) => {
  const spec = decodeSocialEventsAccess(input);

  return accessSpecAnnotations(socialEventsPersonAccess(spec.capabilities.capability));
};
