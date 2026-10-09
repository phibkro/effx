import {
  CredentialMechanismSchema,
  CapabilityExpressionSchema,
  CAPABILITY_TYPE_IDS,
  CREDENTIAL_MECHANISM_KINDS,
  INVITATION_RESPONSE_CAPABILITY,
  OBJECT_CAPABILITY_TYPE_IDS,
  PRINCIPAL_KINDS,
  REQUIREMENT_IDS,
  SCOPE_RESOLVER_IDS,
  type AccessSpec,
  type AuthorizationMode,
  type CapabilityExpression,
  CapabilityTypeId,
  type CredentialMechanism,
  RequirementId,
  ScopeResolverId,
  type TypedRequirement,
  makeAccessSpec,
  ConcealmentPolicySchema,
} from "@vektorprogrammet/domain/authz";

type RequirementValue = (typeof REQUIREMENT_IDS)[number];

type ScopeResolverValue = (typeof SCOPE_RESOLVER_IDS)[number];

type CapabilityValue = (typeof CAPABILITY_TYPE_IDS)[number];

const typedRequirements = (
  requirements: ReadonlyArray<RequirementValue>,
): ReadonlyArray<TypedRequirement> =>
  requirements.map((id) => ({ id: RequirementId.make(id), parameters: {} }));

/** Colocated AccessSpec constructor for an anonymous native operation. */
export const anonymousNativeAccess = (
  canonicalScopeResolver: ScopeResolverValue,
  decisionTime: AuthorizationMode = "SnapshotRead",
): AccessSpec =>
  makeAccessSpec({
    exposure: "External",
    acceptedCredentials: [CredentialMechanismSchema.cases.None.make({})],
    principalKinds: ["Anonymous"],
    capabilities: CapabilityExpressionSchema.cases.None.make({}),
    requirements: [],
    canonicalScopeResolver,
    concealment: ConcealmentPolicySchema.cases.Reveal.make({}),
    decisionTime,
  });

/** Colocated AccessSpec constructor for a first-party cookie-only session operation. */
export const browserSessionNativeAccess = (input: {
  readonly canonicalScopeResolver: ScopeResolverValue;
  readonly requirements?: ReadonlyArray<RequirementValue>;
  readonly concealRequirement?: boolean;
  readonly decisionTime: AuthorizationMode;
}): AccessSpec =>
  makeAccessSpec({
    exposure: "External",
    acceptedCredentials: [CredentialMechanismSchema.cases.BetterAuthCookie.make({})],
    principalKinds: ["Person"],
    capabilities: CapabilityExpressionSchema.cases.None.make({}),
    requirements: typedRequirements(input.requirements ?? []),
    canonicalScopeResolver: input.canonicalScopeResolver,
    concealment:
      input.concealRequirement === true
        ? ConcealmentPolicySchema.cases.NotFound.make({ conceal: ["Requirement"] })
        : ConcealmentPolicySchema.cases.Reveal.make({}),
    decisionTime: input.decisionTime,
  });

/**
 * Colocated AccessSpec constructor for a person operation accepting cookie or OAuth bearer. An
 * operation that serves several capabilities names the others as `alternatives`; any one of
 * them grants it.
 */
export const personNativeAccess = (input: {
  readonly capability: CapabilityValue;
  readonly alternatives?: readonly [CapabilityValue, ...Array<CapabilityValue>];
  readonly canonicalScopeResolver: ScopeResolverValue;
  readonly requirements?: ReadonlyArray<RequirementValue>;
  readonly decisionTime: AuthorizationMode;
}): AccessSpec =>
  makeAccessSpec({
    exposure: "External",
    acceptedCredentials: [
      CredentialMechanismSchema.cases.BetterAuthCookie.make({}),
      CredentialMechanismSchema.cases.OAuthUserBearer.make({}),
    ],
    principalKinds: ["Person"],
    capabilities:
      input.alternatives === undefined
        ? CapabilityExpressionSchema.cases.One.make({
            capability: { type: CapabilityTypeId.make(input.capability) },
          })
        : CapabilityExpressionSchema.cases.Any.make({
            capabilities: [input.capability, ...input.alternatives].map((capability) => ({
              type: CapabilityTypeId.make(capability),
            })),
          }),
    requirements: typedRequirements(input.requirements ?? []),
    canonicalScopeResolver: ScopeResolverId.make(input.canonicalScopeResolver),
    concealment: ConcealmentPolicySchema.cases.Reveal.make({}),
    decisionTime: input.decisionTime,
  });

/** Exact object-capability access contract for invitation response operations. */
export const invitationNativeAccess = (
  requirements: ReadonlyArray<"recruitment.invitation-pending">,
  decisionTime: AuthorizationMode,
): AccessSpec =>
  makeAccessSpec({
    exposure: "External",
    acceptedCredentials: [
      CredentialMechanismSchema.cases.ObjectCapability.make({
        capabilityType: INVITATION_RESPONSE_CAPABILITY,
      }),
    ],
    principalKinds: ["CapabilityHolder"],
    capabilities: CapabilityExpressionSchema.cases.One.make({
      capability: { type: INVITATION_RESPONSE_CAPABILITY },
    }),
    requirements: typedRequirements(requirements),
    canonicalScopeResolver: "recruitment.invitation-response-by-capability",
    concealment: ConcealmentPolicySchema.cases.NotFound.make({
      conceal: ["CredentialFailure", "PrincipalKind", "Capability", "Scope", "Requirement"],
    }),
    decisionTime,
  });

/** Exact isolated internal receipt evidence access contract. */
export const internalReceiptEvidenceAccess = (): AccessSpec =>
  makeAccessSpec({
    exposure: "Internal",
    acceptedCredentials: [CredentialMechanismSchema.cases.BetterAuthCookie.make({})],
    principalKinds: ["Person"],
    capabilities: CapabilityExpressionSchema.cases.One.make({
      capability: { type: CapabilityTypeId.make("receipts.read-internal-evidence") },
    }),
    requirements: typedRequirements(["internal-evidence.enabled", "receipts.owner"]),
    canonicalScopeResolver: "receipts.by-id",
    concealment: ConcealmentPolicySchema.cases.Reveal.make({}),
    decisionTime: "SnapshotRead",
  });

import { Match, Predicate, Context, Option, Schema } from "effect";
import { HttpApiEndpoint, OpenApi } from "effect/unstable/httpapi";

export const AccessSpecAnnotation = Context.Service<AccessSpec>(
  "@vektorprogrammet/http-api/AccessSpec",
);

const rank = (order: ReadonlyArray<string>, value: string): number => {
  const index = order.indexOf(value);

  return index === -1 ? order.length : index;
};

const compareByRegistry = (order: ReadonlyArray<string>) => (left: string, right: string) =>
  rank(order, left) - rank(order, right);

const projectedCapabilities = (expression: CapabilityExpression) => {
  return Match.value(expression).pipe(
    Match.tag("None", () => {
      return { none: true };
    }),
    Match.tag("One", (expression) => {
      return { one: expression.capability.type };
    }),
    Match.tag("All", (expression) => {
      return {
        all: expression.capabilities
          .map((capability) => capability.type)
          .sort(compareByRegistry(CAPABILITY_TYPE_IDS)),
      };
    }),
    Match.tag("Any", (expression) => {
      return {
        any: expression.capabilities
          .map((capability) => capability.type)
          .sort(compareByRegistry(CAPABILITY_TYPE_IDS)),
      };
    }),
    Match.exhaustive,
  );
};

const projectedRequirement = (requirement: TypedRequirement) => {
  const parameters = Object.keys(requirement.parameters);

  return parameters.length === 0
    ? { id: requirement.id }
    : { id: requirement.id, parameters: requirement.parameters };
};

export interface VektorAccessProjection {
  readonly exposure: AccessSpec["exposure"];
  readonly acceptedCredentials: ReadonlyArray<string>;
  readonly principalKinds: ReadonlyArray<string>;
  readonly capabilities: ReturnType<typeof projectedCapabilities>;
  readonly requirements: ReadonlyArray<ReturnType<typeof projectedRequirement>>;
  readonly canonicalScopeResolver: string;
  readonly concealment: {
    readonly mode: "Reveal" | "NotFound";
    readonly stages: ReadonlyArray<string>;
  };
  readonly decisionTime: AccessSpec["decisionTime"];
}

export const projectVektorAccess = (spec: AccessSpec): VektorAccessProjection => ({
  exposure: spec.exposure,
  acceptedCredentials: spec.acceptedCredentials
    .map((credential) => credential._tag)
    .sort(compareByRegistry(CREDENTIAL_MECHANISM_KINDS)),
  principalKinds: [...spec.principalKinds].sort(compareByRegistry(PRINCIPAL_KINDS)),
  capabilities: projectedCapabilities(spec.capabilities),
  requirements: [...spec.requirements]
    .sort((left, right) => compareByRegistry(REQUIREMENT_IDS)(left.id, right.id))
    .map(projectedRequirement),
  canonicalScopeResolver: spec.canonicalScopeResolver,
  concealment: !Predicate.isTagged(spec.concealment, "NotFound")
    ? { mode: "Reveal", stages: [] }
    : { mode: "NotFound", stages: [...spec.concealment.conceal].sort() },
  decisionTime: spec.decisionTime,
});

type CapabilityTypeValue = (typeof CAPABILITY_TYPE_IDS)[number];

const capabilityTypeValue = (id: CapabilityTypeId): CapabilityTypeValue => id;

/**
 * A capability carried in the request body. It needs no HTTP security scheme. When the
 * body member at `personCredentialWhen` has the given value, the operation also requires
 * the Person credential its AccessSpec accepts.
 */
type BodyCapabilityProjection = {
  readonly bodyPointer: string;
  readonly required: true;
  readonly personCredentialWhen: { readonly pointer: string; readonly equals: string };
};

const objectCapabilitySecurityScheme: Partial<
  Record<CapabilityTypeValue, string | BodyCapabilityProjection>
> = {
  "contact.submit": "contactBackend",
  "onboarding.claim": {
    bodyPointer: "/token",
    required: true,
    personCredentialWhen: { pointer: "/mode", equals: "ExistingAccount" },
  },
  "recruitment.invitation-response": "invitationCapability",
};

export const assertAccessProjectionRegistryParity = (): void => {
  const expected = [...OBJECT_CAPABILITY_TYPE_IDS].sort();
  const actual = Object.keys(objectCapabilitySecurityScheme).sort();

  if (
    expected.length !== actual.length ||
    expected.some((capabilityType, index) => capabilityType !== actual[index])
  ) {
    throw new TypeError(
      `ObjectCapability OpenAPI security mapping does not match the domain registry: expected ${expected.join(",")}; received ${actual.join(",")}`,
    );
  }
};

assertAccessProjectionRegistryParity();

const securitySchemeFor = (mechanism: CredentialMechanism): string | null | undefined => {
  return Match.value(mechanism).pipe(
    Match.tag("None", () => {
      return undefined;
    }),
    Match.tag("BetterAuthCookie", () => {
      return "cookieHeader";
    }),
    Match.tag("OAuthUserBearer", () => {
      return "oauthUserBearer";
    }),
    Match.tag("OAuthServiceBearer", () => {
      return "oauthServiceBearer";
    }),
    Match.tag("ObjectCapability", (mechanism) => {
      const scheme = objectCapabilitySecurityScheme[capabilityTypeValue(mechanism.capabilityType)];

      if (scheme === undefined) {
        throw new TypeError(
          `object capability ${mechanism.capabilityType} has no OpenAPI security scheme`,
        );
      }

      return Predicate.isString(scheme) ? scheme : null;
    }),
    Match.exhaustive,
  );
};

export type OpenApiSecurityProjection = ReadonlyArray<
  Readonly<Record<string, ReadonlyArray<string>>>
>;

export const projectCredentialSecurity = (spec: AccessSpec): OpenApiSecurityProjection => {
  if (
    spec.acceptedCredentials.length === 1 &&
    Predicate.isTagged(spec.acceptedCredentials[0], "None")
  ) {
    return [];
  }

  return spec.acceptedCredentials.flatMap((mechanism) => {
    const scheme = securitySchemeFor(mechanism);

    if (scheme === undefined) {
      throw new TypeError("None cannot be combined with another credential mechanism");
    }

    // A body capability is the alternative that needs no HTTP security scheme.
    return scheme === null ? [{}] : [{ [scheme]: [] }];
  });
};

export const accessSpecAnnotations = (input: AccessSpec): Context.Context<AccessSpec> => {
  const spec = makeAccessSpec(input);

  const personMechanisms = spec.acceptedCredentials
    .filter(
      (mechanism) =>
        Predicate.isTagged(mechanism, "BetterAuthCookie") ||
        Predicate.isTagged(mechanism, "OAuthUserBearer"),
    )
    .map((mechanism) => mechanism._tag)
    .sort(compareByRegistry(CREDENTIAL_MECHANISM_KINDS));

  return Context.merge(
    Context.make(AccessSpecAnnotation, spec),
    OpenApi.annotations({
      override: {
        "x-vektor-access": projectVektorAccess(spec),
        security: projectCredentialSecurity(spec),
        ...Object.fromEntries(
          spec.acceptedCredentials.flatMap((mechanism) => {
            if (!Predicate.isTagged(mechanism, "ObjectCapability")) return [];

            const projection =
              objectCapabilitySecurityScheme[capabilityTypeValue(mechanism.capabilityType)];

            if (!Predicate.isObjectOrArray(projection)) return [];

            if (personMechanisms.length === 0) {
              throw new TypeError(
                `body capability ${mechanism.capabilityType} requires a Person credential its AccessSpec does not accept`,
              );
            }

            return [
              [
                "x-vektor-body-capability",
                {
                  type: mechanism.capabilityType,
                  pointer: projection.bodyPointer,
                  required: projection.required,
                },
              ],
              [
                "x-vektor-conditional-credential",
                {
                  when: projection.personCredentialWhen,
                  principalKind: "Person",
                  mechanisms: personMechanisms,
                },
              ],
            ];
          }),
        ),
      },
    }),
  );
};

export const reflectAccessSpec = (
  endpoint: Pick<HttpApiEndpoint.Top, "annotations">,
): Option.Option<AccessSpec> => Context.getOption(endpoint.annotations, AccessSpecAnnotation);

export const annotateAccessSpec = <
  Identifier extends string,
  Method extends HttpApiEndpoint.Top["method"],
  Path extends string,
  Params extends Schema.Top,
  Query extends Schema.Top,
  Payload extends Schema.Top,
  Headers extends Schema.Top,
  Success extends Schema.Top,
  Error extends Schema.Top,
  Middleware,
  MiddlewareServices,
>(
  endpoint: HttpApiEndpoint.HttpApiEndpoint<
    Identifier,
    Method,
    Path,
    Params,
    Query,
    Payload,
    Headers,
    Success,
    Error,
    Middleware,
    MiddlewareServices
  >,
  input: AccessSpec,
) => {
  if (Option.isSome(reflectAccessSpec(endpoint))) {
    throw new TypeError(`endpoint ${endpoint.identifier} has multiple AccessSpec annotations`);
  }

  return endpoint.annotateMerge(accessSpecAnnotations(input));
};
