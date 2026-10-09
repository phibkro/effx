/**
 * Public HTTP contracts for organization queries and commands.
 *
 * @since 0.1.0
 */
import {
  DepartmentId,
  DepartmentJsonSchema,
  FieldOfStudyJsonSchema,
  FieldOfStudyId,
  PersonId,
  SemesterId,
  TeamId,
  TeamJsonSchema,
  type DepartmentJson,
  type FieldOfStudyJson,
  type TeamJson,
} from "@vektorprogrammet/domain/organization";
import { Schema } from "effect";
import {
  AppointmentManagement,
  BoardRosters,
  OrganizationLifecycleCommand,
  OrganizationLifecycleResult,
} from "@vektorprogrammet/domain/organization";
import {
  DelegableCapability,
  DelegationArea,
  DelegationCommand,
  DelegationManagement,
  DelegationResult,
  OrganizationCapability,
} from "@vektorprogrammet/domain/authz";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";
import { annotateAccessSpec, anonymousNativeAccess, personNativeAccess } from "./access.js";
import { operationAnnotations, PersonSecurity } from "./common.js";
import {
  OrganizationCreateDepartmentProblem,
  OrganizationCreateFieldOfStudyProblem,
  OrganizationCreateTeamProblem,
  OrganizationListDepartmentsProblem,
  OrganizationListFieldOfStudiesProblem,
  OrganizationListMailingListsProblem,
  OrganizationListTeamInterestProblem,
  OrganizationListTeamsProblem,
} from "./endpoint-problems.js";
import {
  ConditionalReadHeaders,
  createdMutationResponse,
  endpointProblemResponses,
  IdempotencyHeaders,
  privateReadResponse,
  publicConditionalResponses,
  entityMutationResponse,
  problemUnion,
} from "./http-semantics.js";
import {
  CreateDepartmentRequest,
  CreateFieldOfStudyRequest,
  CreateTeamRequest,
} from "./v2-schemas.js";

export {
  DepartmentId,
  DepartmentJsonSchema,
  FieldOfStudyJsonSchema,
  PersonId,
  SemesterId,
  TeamJsonSchema,
};

export type { DepartmentJson, FieldOfStudyJson, TeamJson };

/**
 * Reach-scoped organization query. Repeated values remain representable because
 * the current transport selects the first value.
 *
 * @since 0.1.0
 * @category Schemas
 */
export const OrganizationScopeQuery = {
  department: Schema.optional(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
  semester: Schema.optional(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
};

/**
 * Mailing-list projection selector.
 *
 * @since 0.1.0
 * @category Schemas
 */
export const MailingListQuery = {
  ...OrganizationScopeQuery,
  type: Schema.optional(
    Schema.Union([
      Schema.Literals(["assistants", "team", "all"]),
      Schema.Array(Schema.Literals(["assistants", "team", "all"])),
    ]),
  ),
};

/**
 * Strict team-interest response compatible with the existing Hydra envelope.
 *
 * @since 0.1.0
 * @category Schemas
 */
export const TeamInterestResponse = Schema.Struct({
  "hydra:member": Schema.Array(
    Schema.Struct({ id: Schema.Int, userName: Schema.String, teamName: Schema.String }),
  ),
  "hydra:totalItems": Schema.Int,
}).annotate({
  identifier: "TeamInterestResponse",
  description: "Scoped team-interest rows.",
  examples: [
    {
      "hydra:member": [{ id: 1, userName: "ming.medlem", teamName: "Rekruttering" }],
      "hydra:totalItems": 1,
    },
  ],
});

/**
 * Projected mailing list.
 *
 * @since 0.1.0
 * @category Schemas
 */
export const MailingListResponse = Schema.Array(
  Schema.Struct({ name: Schema.String, emails: Schema.Array(Schema.String) }),
).annotate({
  identifier: "MailingListResponse",
  description: "Scoped mailing-list projections.",
  examples: [[{ name: "leder-trondheim", emails: ["lina.leder@example.org"] }]],
});

/**
 * Representative department JSON projection.
 *
 * @since 0.1.0
 * @category Schemas
 */
export const DepartmentExample = {
  departmentId: DepartmentId.make("1"),
  name: "Datateknologi",
  shortName: "DAT",
  email: "datateknologi@example.org",
  address: "Sem Sælands vei 1",
  city: "Trondheim",
  latitude: null,
  longitude: null,
  slackChannel: null,
  logoPath: null,
  active: true,
  revision: 0,
} as const;

/**
 * Representative team JSON projection.
 *
 * @since 0.1.0
 * @category Schemas
 */
export const TeamExample = {
  teamId: TeamId.make("rekruttering"),
  departmentId: DepartmentId.make("1"),
  name: "Rekruttering",
  shortName: "REK",
  shortDescription: "Interviews applicants",
  description: "Interviews applicants and runs the admission process.",
  email: "rekruttering@example.org",
  deadline: "2026-09-15T23:59:59.999Z",
  acceptApplication: true,
  active: true,
  revision: 0,
} as const;

/**
 * Representative field-of-study JSON projection.
 *
 * @since 0.1.0
 * @category Schemas
 */
export const FieldOfStudyExample = {
  fieldOfStudyId: FieldOfStudyId.make("datateknologi"),
  departmentId: DepartmentId.make("1"),
  name: "Datateknologi",
  shortName: "DAT",
  active: true,
  revision: 0,
} as const;

/** @since 0.1.0 @category Endpoints */
export const ListDepartmentsEndpoint = HttpApiEndpoint.get("listDepartments", "/api/departments", {
  headers: ConditionalReadHeaders,
  success: publicConditionalResponses(
    Schema.Array(
      DepartmentJsonSchema.annotate({
        identifier: "DepartmentJson",
        description: "One native department directory row.",
        examples: [DepartmentExample],
      }),
    ),
  ),
  error: endpointProblemResponses(OrganizationListDepartmentsProblem),
})
  .pipe((endpoint) =>
    annotateAccessSpec(endpoint, anonymousNativeAccess("organization.public-departments")),
  )
  .annotateMerge(
    operationAnnotations("List departments", "Returns the public native department directory."),
  );

/** @since 0.1.0 @category Endpoints */
export const ListTeamsEndpoint = HttpApiEndpoint.get("listTeams", "/api/teams", {
  headers: ConditionalReadHeaders,
  success: publicConditionalResponses(
    Schema.Array(
      TeamJsonSchema.annotate({
        identifier: "TeamJson",
        description: "One native team directory row.",
        examples: [TeamExample],
      }),
    ),
  ),
  error: endpointProblemResponses(OrganizationListTeamsProblem),
})
  .pipe((endpoint) =>
    annotateAccessSpec(endpoint, anonymousNativeAccess("organization.public-teams")),
  )
  .annotateMerge(operationAnnotations("List teams", "Returns the public native team directory."));

export const ListFieldOfStudiesEndpoint = HttpApiEndpoint.get(
  "listFieldOfStudies",
  "/api/field-of-studies",
  {
    headers: ConditionalReadHeaders,
    success: publicConditionalResponses(
      Schema.Array(
        FieldOfStudyJsonSchema.annotate({
          identifier: "FieldOfStudyJson",
          description: "One native field-of-study directory row.",
          examples: [FieldOfStudyExample],
        }),
      ),
    ),
    error: endpointProblemResponses(OrganizationListFieldOfStudiesProblem),
  },
)
  .pipe((endpoint) =>
    annotateAccessSpec(endpoint, anonymousNativeAccess("organization.public-field-of-studies")),
  )
  .annotateMerge(
    operationAnnotations("List fields of study", "Returns the public native study directory."),
  );

/** @since 0.1.0 @category Endpoints */
export const ListTeamInterestEndpoint = HttpApiEndpoint.get(
  "listTeamInterest",
  "/api/team-interest-registrations",
  {
    query: OrganizationScopeQuery,
    success: privateReadResponse(TeamInterestResponse),
    error: endpointProblemResponses(OrganizationListTeamInterestProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "organization.read-team-interest",
        canonicalScopeResolver: "organization.team-interest-registrations",
        decisionTime: "SnapshotRead",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "List team interest",
      "Returns registrations within the caller's team-interest reach: the own team for its leader, whole departments for department reach.",
    ),
  );

/** @since 0.1.0 @category Endpoints */
export const ListMailingListsEndpoint = HttpApiEndpoint.get(
  "listMailingLists",
  "/api/mailing-lists",
  {
    query: MailingListQuery,
    success: privateReadResponse(MailingListResponse),
    error: endpointProblemResponses(OrganizationListMailingListsProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "organization.read-mailing-lists",
        canonicalScopeResolver: "organization.mailing-lists",
        decisionTime: "SnapshotRead",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Project mailing lists",
      "Projects addresses within the departments where the caller reads people.",
    ),
  );

/** @since 0.1.0 @category Endpoints */
export const CreateDepartmentEndpoint = HttpApiEndpoint.post(
  "createDepartment",
  "/api/departments",
  {
    headers: IdempotencyHeaders,
    payload: CreateDepartmentRequest,
    success: createdMutationResponse(DepartmentJsonSchema.pipe(HttpApiSchema.status(201))),
    error: endpointProblemResponses(OrganizationCreateDepartmentProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "organization.create-department",
        canonicalScopeResolver: "organization.department-create",
        decisionTime: "Transaction",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Create department",
      "Creates or replays an idempotent department command.",
    ),
  );

/** @since 0.1.0 @category Endpoints */
export const CreateTeamEndpoint = HttpApiEndpoint.post("createTeam", "/api/teams", {
  headers: IdempotencyHeaders,
  payload: CreateTeamRequest,
  success: createdMutationResponse(TeamJsonSchema.pipe(HttpApiSchema.status(201))),
  error: endpointProblemResponses(OrganizationCreateTeamProblem),
})
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "organization.create-team",
        canonicalScopeResolver: "organization.team-create",
        decisionTime: "Transaction",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations("Create team", "Creates or replays an idempotent team command."),
  );

/** @since 0.1.0 @category Endpoints */
export const CreateFieldOfStudyEndpoint = HttpApiEndpoint.post(
  "createFieldOfStudy",
  "/api/field-of-studies",
  {
    headers: IdempotencyHeaders,
    payload: CreateFieldOfStudyRequest,
    success: createdMutationResponse(FieldOfStudyJsonSchema.pipe(HttpApiSchema.status(201))),
    error: endpointProblemResponses(OrganizationCreateFieldOfStudyProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "organization.create-field-of-study",
        canonicalScopeResolver: "organization.field-of-study-create",
        decisionTime: "Transaction",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Create field of study",
      "Creates or replays an idempotent field-of-study command.",
    ),
  );

/**
 * Organization directory and administration API.
 *
 * @since 0.1.0
 * @category Groups
 */
const OrganizationLifecycleProblem = problemUnion("OrganizationLifecycleProblem", [
  "authority.denied",
  "origin.denied",
  "resource.not-found",
  "precondition.failed",
  "validation.failed",
  "request.malformed",
  "request.too-large",
  "idempotency-key.invalid",
  "idempotency.digest-conflict",
  "idempotency.in-flight",
  "idempotency.response-expired",
  "transaction.conflict",
  "internal.error",
  "idempotency.unavailable",
  "organization.unavailable",
]);

export const ReadAppointmentManagementEndpoint = HttpApiEndpoint.get(
  "readAppointmentManagement",
  "/api/organization/appointments",
  {
    success: privateReadResponse(AppointmentManagement),
    error: endpointProblemResponses(OrganizationLifecycleProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "organization.manage-appointments",
        canonicalScopeResolver: "organization.appointment-management",
        decisionTime: "SnapshotRead",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Read appointment management",
      "Returns authorized people, units, appointments, account access and history.",
    ),
  );

/**
 * The rosters of Styret of an independent department and of Hovedstyret: the appointed seats and
 * the seats that current team leadership derives, for the boards whose appointments the reader
 * manages.
 */
export const ReadBoardRostersEndpoint = HttpApiEndpoint.get(
  "readBoardRosters",
  "/api/organization/board-rosters",
  {
    success: privateReadResponse(BoardRosters),
    error: endpointProblemResponses(OrganizationLifecycleProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "organization.manage-appointments",
        canonicalScopeResolver: "organization.appointment-management",
        decisionTime: "SnapshotRead",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Read board rosters",
      "Returns the appointed and derived seats of the certificate-issuing boards whose appointments the reader manages, as of the request instant.",
    ),
  );

export const ExecuteOrganizationLifecycleEndpoint = HttpApiEndpoint.post(
  "executeLifecycle",
  "/api/organization/appointments/commands",
  {
    headers: IdempotencyHeaders,
    payload: OrganizationLifecycleCommand,
    success: entityMutationResponse(OrganizationLifecycleResult),
    error: endpointProblemResponses(OrganizationLifecycleProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "organization.manage-appointments",
        canonicalScopeResolver: "organization.appointment-management",
        decisionTime: "Transaction",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Manage appointments and account access",
      "Applies one authorized, revision-checked lifecycle command with atomic history.",
    ),
  );

/**
 * The delegations that one person manages: a Styret leader those of its department's teams,
 * Hovedstyret or a global administrator those of national teams.
 */
export const ReadDelegationManagementEndpoint = HttpApiEndpoint.get(
  "readDelegationManagement",
  "/api/organization/delegations",
  {
    success: privateReadResponse(DelegationManagement),
    error: endpointProblemResponses(OrganizationLifecycleProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "organization.manage-delegations",
        canonicalScopeResolver: "organization.delegation-management",
        decisionTime: "SnapshotRead",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Read delegation management",
      "Returns the teams, delegations and history within the caller's delegation management reach.",
    ),
  );

export const ExecuteDelegationEndpoint = HttpApiEndpoint.post(
  "executeDelegation",
  "/api/organization/delegations/commands",
  {
    headers: IdempotencyHeaders,
    payload: DelegationCommand,
    success: entityMutationResponse(DelegationResult),
    error: endpointProblemResponses(OrganizationLifecycleProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "organization.manage-delegations",
        canonicalScopeResolver: "organization.delegation-management",
        decisionTime: "Transaction",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Issue or end a delegation",
      "Issues or ends one named, time-bounded delegation with atomic history under current authority.",
    ),
  );

export {
  AppointmentManagement,
  BoardRosters,
  DelegableCapability,
  DelegationArea,
  DelegationCommand,
  DelegationManagement,
  DelegationResult,
  OrganizationCapability,
  OrganizationLifecycleCommand,
  OrganizationLifecycleResult,
};

export class OrganizationApi extends HttpApiGroup.make("organization")
  .add(
    ReadAppointmentManagementEndpoint,
    ReadBoardRostersEndpoint,
    ExecuteOrganizationLifecycleEndpoint,
    ReadDelegationManagementEndpoint,
    ExecuteDelegationEndpoint,
    ListDepartmentsEndpoint,
    ListTeamsEndpoint,
    ListFieldOfStudiesEndpoint,
    ListTeamInterestEndpoint,
    ListMailingListsEndpoint,
    CreateDepartmentEndpoint,
    CreateTeamEndpoint,
    CreateFieldOfStudyEndpoint,
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Organization",
      description: "Public organization directories and scoped administration.",
      override: { "x-displayName": "Organization" },
    }),
  ) {}
