import type { LiftInput, LiftRule, TemplateExpr } from "@effx/compiler";
import { StableId, type SchemaRef, type SymbolRef } from "@effx/ir";

export const corpusGroups = ["profile", "directory", "social-events"] as const;

export type CorpusGroup = (typeof corpusGroups)[number];

const accessAnnotators: Record<CorpusGroup, string> = {
  profile: "profileAccessAnnotations",
  directory: "directoryAccessAnnotations",
  "social-events": "socialEventsAccessAnnotations",
};

export const app = "../../packages/http-api/src";

const sym = (file: string, name: string): SymbolRef => ({ module: `${app}/${file}`, export: name });

const schema = (file: string, name: string): SchemaRef => ({
  ...sym(file, name),
  symbolId: StableId.make("schema", `packages/http-api/src/${file}/${name}`),
});

const constant = (value: string | ReadonlyArray<string>): TemplateExpr => ({
  _tag: "Const",
  value,
});

const accessRule = (group: CorpusGroup): LiftRule => ({
  _tag: "Access",
  callee: sym("access", "personNativeAccess"),
  apply: sym("access", "annotateAccessSpec"),
  annotator: sym(`${group}-effx-adapters`, accessAnnotators[group]),
  arguments: {
    _tag: "Object",
    fields: [
      { name: "capability", kind: "string", required: true },
      { name: "canonicalScopeResolver", kind: "string", required: true },
      { name: "requirements", kind: "strings", required: false, default: [] },
      { name: "decisionTime", kind: "string", required: true },
    ],
  },
  resolver: { _tag: "Arg", name: "canonicalScopeResolver" },
  emit: {
    exposure: constant("External"),
    acceptedCredentials: constant(["BetterAuthCookie", "OAuthUserBearer"]),
    principalKinds: constant(["Person"]),
    capabilities: {
      _tag: "Object",
      fields: [
        { key: "_tag", value: constant("One") },
        { key: "capability", value: { _tag: "Arg", name: "capability" } },
      ],
    },
    requirements: {
      _tag: "Map",
      arg: "requirements",
      body: { _tag: "Object", fields: [{ key: "id", value: { _tag: "Item" } }] },
    },
    concealment: { _tag: "Object", fields: [{ key: "_tag", value: constant("Reveal") }] },
    decisionTime: { _tag: "Arg", name: "decisionTime" },
  },
});

/** Reviewed data rules point to real exports in the pinned human adaptation, never executable substitutes. */
export const inputOf = (group: CorpusGroup): LiftInput => {
  const rules: Array<LiftRule> = [
    {
      _tag: "SuccessWrapper",
      callee: sym("http-semantics", "privateConditionalResponses"),
      responseHeaders: schema("http-semantics", "ProfileReadResponseHeaders"),
      conditional: true,
      status: 200,
    },
    {
      _tag: "SuccessWrapper",
      callee: sym("http-semantics", "entityMutationResponse"),
      responseHeaders: schema("http-semantics", "EntityMutationResponseHeaders"),
      status: 200,
    },
    {
      _tag: "SuccessWrapper",
      callee: sym("http-semantics", "privateReadResponse"),
      responseHeaders: schema("http-semantics", "PrivateReadResponseHeaders"),
      status: 200,
    },
    // The helper imposes no status. Its call site states `HttpApiSchema.status(201)`, which lift preserves.
    {
      _tag: "SuccessWrapper",
      callee: sym("http-semantics", "createdMutationResponse"),
      responseHeaders: schema("http-semantics", "CreatedMutationResponseHeaders"),
    },
    {
      _tag: "ProblemRegistry",
      response: sym("http-semantics", "endpointProblemResponses"),
      union: sym("http-semantics", "problemUnion"),
      registry: sym("endpoint-problems", "nativeProblems"),
    },
    {
      _tag: "Metadata",
      callee: sym("common", "operationAnnotations"),
      annotator: sym("common", "nativeOperationAnnotations"),
      positional: ["summary", "description"],
    },
    accessRule(group),
  ];

  const names = {
    "profile.current-person": sym("profile-effx-adapters", "ProfileCurrentPerson"),
    "profile.people-directory": sym("directory-effx-adapters", "PeopleDirectoryResolver"),
    "schools.directory": sym("directory-effx-adapters", "SchoolsDirectoryResolver"),
    "schools.management": sym("directory-effx-adapters", "SchoolsManagementResolver"),
    "social-events.scope": sym("social-events-effx-adapters", "SocialEventsScopeResolver"),
    "social-events.list": sym("social-events-effx-adapters", "SocialEventsListResolver"),
    "social-events.create": sym("social-events-effx-adapters", "SocialEventsCreateResolver"),
    "directory.listSchools#query": sym("directory", "SchoolsDirectoryQuery"),
    "directory.listSchools#success": sym("directory", "SchoolDirectoryResponse"),
    "social-events.list#query": sym("social-events", "SocialEventScopeQuery"),
    [`${app}/endpoint-problems#ProfileReadOwnProfileProblem#codes`]: sym(
      "endpoint-problems",
      "ProfileReadOwnProfileCodes",
    ),
    [`${app}/endpoint-problems#ProfileUpdateOwnProfileProblem#codes`]: sym(
      "endpoint-problems",
      "ProfileUpdateOwnProfileCodes",
    ),
    [`${app}/endpoint-problems#DirectoryListPeopleProblem#codes`]: sym(
      "endpoint-problems",
      "DirectoryListPeopleCodes",
    ),
    [`${app}/endpoint-problems#DirectoryListSchoolsProblem#codes`]: sym(
      "endpoint-problems",
      "DirectoryListSchoolsCodes",
    ),
    [`${app}/directory#SchoolAdministrationProblem#codes`]: sym(
      "endpoint-problems",
      "SchoolAdministrationCodes",
    ),
    [`${app}/social-events#SocialEventsReadScopeProblem#codes`]: sym(
      "social-events",
      "SocialEventsReadScopeCodes",
    ),
    [`${app}/social-events#SocialEventsListProblem#codes`]: sym(
      "social-events",
      "SocialEventsListCodes",
    ),
    [`${app}/social-events#SocialEventsCreateProblem#codes`]: sym(
      "social-events",
      "SocialEventsCreateCodes",
    ),
  } satisfies LiftInput["names"];

  const common = { group, rules, names, output: { module: `${app}/${group}.effx` } };

  return group === "profile"
    ? common
    : {
        ...common,
        emptyInput: schema(
          group,
          group === "directory" ? "EmptyDirectoryInput" : "EmptySocialEventInput",
        ),
      };
};
