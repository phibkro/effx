import {
  type ApplicationIR,
  type Edge,
  type Node,
  type OperationNode,
  StableId,
  make,
} from "@effx/ir";
import type { AccessContractData } from "../../src/extensions/access-contract.ts";

/*
 * IR builders shared by the Cedar projection tests (compiler) and the validator tests (cli).
 * `AccessContract` nodes carry the data the real interpreter writes (spec 0006).
 */

const schemaRef = (name: string) => ({
  module: "app/schemas",
  export: name,
  symbolId: StableId.make("schema", `app/${name}`),
});

export const operation = (name: string, kind: "Query" | "Command"): OperationNode => ({
  _tag: "Operation",
  id: StableId.make("operation", name),
  name,
  kind,
  input: schemaRef(`${name}Input`),
  success: schemaRef(`${name}Success`),
  errors: { values: [], inferred: true },
  requirements: { values: [], inferred: true },
  handler: { module: "app/operations", export: "Operations", member: name },
});

export const contractNode = (operationName: string, data: AccessContractData): Node => ({
  _tag: "Extension",
  id: StableId.make("ext", `access-contract/${operationName}`),
  extension: "access-contract",
  tag: "AccessContract",
  data,
});

export const contractEdge = (operationName: string): Edge => ({
  kind: "ExtensionOf",
  from: StableId.make("ext", `access-contract/${operationName}`),
  to: StableId.make("operation", operationName),
  qualifier: "AccessContract",
});

export const contract = (
  resolver: string,
  overrides: Partial<AccessContractData> = {},
): AccessContractData => ({
  annotator: { module: "profile/access", export: "profileAccessAnnotations" },
  exposure: "External",
  acceptedCredentials: ["BetterAuthCookie", "OAuthUserBearer"],
  principalKinds: ["Person"],
  capabilities: { _tag: "One", capability: "profile.read-self" },
  requirements: [{ id: "profile.owner" }],
  canonicalScopeResolver: { module: "profile/access", export: resolver },
  concealment: { _tag: "Reveal" },
  decisionTime: "SnapshotRead",
  ...overrides,
});

const withContracts = (
  operations: ReadonlyArray<readonly [OperationNode, AccessContractData]>,
  extraNodes: ReadonlyArray<Node> = [],
  extraEdges: ReadonlyArray<Edge> = [],
): ApplicationIR =>
  make(
    [...operations.flatMap(([node, data]) => [node, contractNode(node.name, data)]), ...extraNodes],
    [...operations.map(([node]) => contractEdge(node.name)), ...extraEdges],
  );

const capability = (name: string, resource: string, focus?: ReadonlyArray<string>): Array<Node> => {
  const resourceId = StableId.make("model", resource);

  if (focus === undefined) {
    return [
      { _tag: "Capability", id: StableId.make("capability", name), name, resource: resourceId },
    ];
  }

  const focusId = StableId.make("focus", `${resource}.${focus.join(".")}`);

  return [
    {
      _tag: "Capability",
      id: StableId.make("capability", name),
      name,
      resource: resourceId,
      focus: focusId,
    },
    { _tag: "Focus", id: focusId, root: resourceId, path: focus },
  ];
};

const authorizedBy = (operationName: string, capabilityName: string): Edge => ({
  kind: "AuthorizedBy",
  from: StableId.make("operation", operationName),
  to: StableId.make("capability", capabilityName),
});

/** `examples/users`: `@Authorize` only, no `AccessContract`. */
export const usersIr = make(
  [
    operation("User.Get", "Query"),
    operation("User.ChangeEmail", "Command"),
    ...capability("User.Read", "User"),
    ...capability("User.ChangeEmail", "User", ["email"]),
  ],
  [
    authorizedBy("User.Get", "User.Read"),
    authorizedBy("User.ChangeEmail", "User.ChangeEmail"),
    {
      kind: "Focuses",
      from: StableId.make("capability", "User.ChangeEmail"),
      to: StableId.make("focus", "User.email"),
    },
  ],
);

/** The Profile-like pair of spec 0006: a `SnapshotRead` query and a `Transaction` command. */
export const profileIr = withContracts([
  [operation("Profile.Read", "Query"), contract("ProfileCurrentPerson")],
  [
    operation("Profile.Update", "Command"),
    contract("ProfileCurrentPerson", {
      capabilities: { _tag: "One", capability: "profile.update-self" },
      decisionTime: "Transaction",
    }),
  ],
]);

/** Every capability expression, exposure, principal and concealment shape in one IR. */
export const variantsIr = withContracts(
  [
    [
      operation("Any.Op", "Query"),
      contract("AnyScope", {
        capabilities: { _tag: "Any", capabilities: ["cap.b", "cap.a"] },
        principalKinds: ["ServicePrincipal", "Person"],
        requirements: [],
      }),
    ],
    [
      operation("All.Op", "Query"),
      contract("AllScope", {
        capabilities: { _tag: "All", capabilities: ["cap.x", "cap.y"] },
        requirements: [],
      }),
    ],
    [
      operation("None.Op", "Query"),
      contract("NoneScope", {
        capabilities: { _tag: "None" },
        principalKinds: ["Anonymous"],
        acceptedCredentials: ["None"],
        requirements: [],
        exposure: "Internal",
      }),
    ],
    [
      operation("Params.Op", "Query"),
      contract("AnyScope", {
        capabilities: { _tag: "One", capability: "cap.a" },
        requirements: [
          { id: "profile.owner", parameters: { scope: "self" } },
          { id: "org.member" },
        ],
        concealment: { _tag: "NotFound", stages: ["credential", "scope"] },
      }),
    ],
    [
      operation("Contact.Submit", "Command"),
      contract("ContactDepartmentRecipient", {
        acceptedCredentials: ["ObjectCapability"],
        principalKinds: ["CapabilityHolder"],
        capabilities: { _tag: "One", capability: "contact.submit" },
        requirements: [],
        snapshotDecisionForCommand: true,
      }),
    ],
    [
      operation("Quote.Op", "Command"),
      contract("AnyScope", {
        capabilities: { _tag: "One", capability: 'cap "quoted" \\ name' },
        requirements: [],
      }),
    ],
  ],
  [...capability("cap.a", "Org", ["members"]), ...capability("cap.orphan", "Org")],
  [authorizedBy("Params.Op", "cap.a")],
);

/** Two stacked `@Authorize` on one operation: no single Cedar request expresses both. */
export const stackedIr = make(
  [
    operation("Stacked.Op", "Command"),
    ...capability("cap.one", "Doc"),
    ...capability("cap.two", "Doc"),
  ],
  [authorizedBy("Stacked.Op", "cap.one"), authorizedBy("Stacked.Op", "cap.two")],
);

/** Two distinct resolver symbols with the same export name cannot both be an entity type. */
export const collidingResolversIr = withContracts([
  [
    operation("A.Op", "Query"),
    { ...contract("Scope"), capabilities: { _tag: "One", capability: "a" } },
  ],
  [
    operation("B.Op", "Query"),
    {
      ...contract("Scope"),
      capabilities: { _tag: "One", capability: "b" },
      canonicalScopeResolver: { module: "other/access", export: "Scope" },
    },
  ],
]);

/** A resolver export equal to a Model name collides with the entity type that Model names. */
export const resolverEqualsModelIr = withContracts(
  [[operation("M.Op", "Query"), contract("Org")]],
  capability("cap.a", "Org"),
  [authorizedBy("M.Op", "cap.a")],
);

/** Resolver and Model names that are not valid Cedar identifiers. */
export const invalidNamesIr = withContracts([
  [operation("I.Op", "Query"), contract("if")],
  [operation("J.Op", "Query"), contract("Action")],
]);

/** No operation carries a capability or a contract. */
export const unprotectedIr = make([operation("Plain.Op", "Query")], []);
