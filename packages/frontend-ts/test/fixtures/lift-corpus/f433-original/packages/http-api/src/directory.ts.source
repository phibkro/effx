/**
 * Public HTTP contracts for the people and school directories.
 *
 */
import { DepartmentId } from "@vektorprogrammet/domain/organization";
import {
  SchoolCommand,
  SchoolCommandResult,
  SchoolManagement,
  SchoolDirectoryDepartmentSchema,
  SchoolDirectorySchema,
  SchoolId,
  type SchoolDirectory,
  type SchoolDirectoryDepartment,
  type SchoolDirectoryEntry,
} from "@vektorprogrammet/domain/schools";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";
import { annotateAccessSpec, personNativeAccess } from "./access.js";
import { operationAnnotations, PersonSecurity } from "./common.js";
import { DirectoryListPeopleProblem, DirectoryListSchoolsProblem } from "./endpoint-problems.js";
import {
  endpointProblemResponses,
  privateReadResponse,
  IdempotencyHeaders,
  entityMutationResponse,
  problemUnion,
} from "./http-semantics.js";

export { SchoolDirectoryDepartmentSchema, SchoolDirectorySchema, SchoolId };

export type { SchoolDirectory, SchoolDirectoryDepartment, SchoolDirectoryEntry };

/**
 * One profile/organization directory row.
 *
 * @since 0.1.0
 * @category Schemas
 */
export const PeopleDirectoryEntry = Schema.Struct({
  personId: Schema.String,
  firstName: Schema.String,
  lastName: Schema.String,
  email: Schema.String,
  phone: Schema.String,
  studyProgramme: Schema.Null,
  departments: Schema.Array(Schema.String),
  isActive: Schema.Boolean,
}).annotate({
  identifier: "PeopleDirectoryEntry",
  description: "Person profile enriched with Organization-owned department facts.",
  examples: [
    {
      personId: "7202",
      firstName: "Ming",
      lastName: "Medlem",
      email: "ming.medlem@example.org",
      phone: "+47 900 00 000",
      studyProgramme: null,
      departments: ["1"],
      isActive: true,
    },
  ],
});

/**
 * Complete scoped people directory response.
 *
 * @since 0.1.0
 * @category Schemas
 */
export const PeopleDirectoryResponse = Schema.Struct({
  activePeople: Schema.Array(PeopleDirectoryEntry),
  inactivePeople: Schema.Array(PeopleDirectoryEntry),
  nextCursor: Schema.NullOr(Schema.String),
}).annotate({
  identifier: "PeopleDirectoryResponse",
  description: "Active and inactive people visible in the caller's authority scope.",
  examples: [
    {
      activePeople: [
        {
          personId: "7202",
          firstName: "Ming",
          lastName: "Medlem",
          email: "ming.medlem@example.org",
          phone: "+47 900 00 000",
          studyProgramme: null,
          departments: ["1"],
          isActive: true,
        },
      ],
      inactivePeople: [],
      nextCursor: null,
    },
  ],
});

/** @since 0.1.0 @category Endpoints */
export const ListPeopleEndpoint = HttpApiEndpoint.get("listPeople", "/api/people", {
  success: privateReadResponse(PeopleDirectoryResponse),
  error: endpointProblemResponses(DirectoryListPeopleProblem),
})
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "profile.read-directory",
        canonicalScopeResolver: "profile.people-directory",
        decisionTime: "SnapshotRead",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations("List people", "Returns the people directory within the caller's scope."),
  );

export const SchoolDirectoryExample = {
  activeSchools: [
    {
      schoolId: SchoolId.make(1),
      name: "Trondheim katedral videregående skole",
      contactPerson: "Heidi Holm",
      email: "post@tks.example.org",
      phone: "+47 900 00 001",
      language: "Norwegian",
      departments: [{ departmentId: DepartmentId.make("1"), name: "Trondheim" }],
      isActive: true,
    },
  ],
  inactiveSchools: [],
} as const;

/** @since 0.1.0 @category Endpoints */
export const ListSchoolsEndpoint = HttpApiEndpoint.get("listSchools", "/api/schools", {
  query: { department: Schema.optional(DepartmentId) },
  success: privateReadResponse(
    SchoolDirectorySchema.annotate({
      identifier: "SchoolDirectory",
      description: "Active and inactive school directory entries.",
      examples: [SchoolDirectoryExample],
    }),
  ),
  error: endpointProblemResponses(DirectoryListSchoolsProblem),
})
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "schools.read-directory",
        canonicalScopeResolver: "schools.directory",
        decisionTime: "SnapshotRead",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations("List schools", "Returns the native school directory in authority scope."),
  );

/**
 * Scoped people and school directory endpoints.
 *
 * @since 0.1.0
 * @category Groups
 */
export { SchoolCommand, SchoolCommandResult, SchoolManagement };

const SchoolAdministrationProblem = problemUnion("SchoolAdministrationProblem", [
  "authority.denied",
  "origin.denied",
  "request.malformed",
  "request.too-large",
  "media-type.unsupported",
  "header.malformed",
  "idempotency-key.invalid",
  "idempotency.in-flight",
  "idempotency.digest-conflict",
  "idempotency.response-expired",
  "transaction.conflict",
  "resource.not-found",
  "precondition.failed",
  "schools.invalid-command",
  "schools.association-in-use",
  "schools.inactive",
  "schools.capacity-exists",
  "schools.unavailable",
  "idempotency.unavailable",
  "internal.error",
]);

export const ReadSchoolManagementEndpoint = HttpApiEndpoint.get(
  "readSchoolManagement",
  "/api/schools/management",
  {
    success: privateReadResponse(SchoolManagement),
    error: endpointProblemResponses(SchoolAdministrationProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "schools.manage",
        canonicalScopeResolver: "schools.management",
        decisionTime: "SnapshotRead",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Manage schools",
      "Returns authorized school facts, capacity plans, options, and history.",
    ),
  );

export const ExecuteSchoolCommandEndpoint = HttpApiEndpoint.post(
  "executeSchoolCommand",
  "/api/schools/commands",
  {
    headers: IdempotencyHeaders,
    payload: SchoolCommand,
    success: entityMutationResponse(SchoolCommandResult),
    error: endpointProblemResponses(SchoolAdministrationProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "schools.manage",
        canonicalScopeResolver: "schools.management",
        decisionTime: "Transaction",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Maintain schools",
      "Applies one scoped school or capacity command with an explicit observed revision and atomic history.",
    ),
  );

export class DirectoryApi extends HttpApiGroup.make("directory")
  .add(
    ListPeopleEndpoint,
    ListSchoolsEndpoint,
    ReadSchoolManagementEndpoint,
    ExecuteSchoolCommandEndpoint,
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Directories",
      description: "Scoped people and school directories.",
      override: { "x-displayName": "Directories" },
    }),
  ) {}
