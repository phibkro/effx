/** Post-0024 item-2 consumer: keep the 200 override of SchoolPatchResult (annotated 201). */
import { Capability, Concealment, Http, Operation } from "@effx/runtime";
import { PersonSecurity } from "./profile-support.js";
import { ExternalDirectoryApi } from "./directory-root.js";
import {
  DirectoryProblemResponses,
  DirectoryRequestMarker,
  EmptyDirectoryInput,
  EntityMutationResponseHeaders,
  IdempotencyHeaders,
  ListPeopleCodes,
  ListSchoolsCodes,
  PeopleDirectoryResolver,
  PeopleDirectoryResponse,
  PrivateReadResponseHeaders,
  SchoolCommand,
  SchoolCommandCodes,
  SchoolCommandResult,
  SchoolDirectoryResponse,
  SchoolPatch,
  SchoolPatchCodes,
  SchoolPatchHeaders,
  SchoolPatchResult,
  SchoolsDirectoryQuery,
  SchoolsDirectoryResolver,
  SchoolsManagementResolver,
  directoryAccessAnnotations,
  directoryOperationAnnotations,
} from "./directory-support.js";

export const DirectoryGroup = Http.group({
  root: ExternalDirectoryApi,
  group: "directory",
  title: "Directories",
  description: "Scoped people and school directories.",
  displayName: "Directories",
  defaults: {
    middleware: [PersonSecurity, DirectoryRequestMarker],
    metadata: { annotator: directoryOperationAnnotations },
    problems: { registry: DirectoryProblemResponses },
    access: {
      annotator: directoryAccessAnnotations,
      exposure: "External",
      acceptedCredentials: ["BetterAuthCookie", "OAuthUserBearer"],
      principalKinds: ["Person"],
      concealment: Concealment.reveal,
    },
  },
});

export const ListPeople = Operation.query({
  name: "directory.listPeople",
  input: EmptyDirectoryInput,
  success: PeopleDirectoryResponse,
})
  .in(DirectoryGroup)
  .http.get("/api/people")
  .http.contract({
    responseHeaders: PrivateReadResponseHeaders,
    metadata: {
      summary: "List people",
      description: "Returns the people directory within the caller's scope.",
    },
  })
  .http.problems({ codes: ListPeopleCodes, identifier: "DirectoryListPeopleProblem" })
  .http.access({
    capabilities: Capability.one("profile.read-directory"),
    requirements: [],
    canonicalScopeResolver: PeopleDirectoryResolver,
    decisionTime: "SnapshotRead",
  })
  .declare();

export const ListSchools = Operation.query({
  name: "directory.listSchools",
  input: SchoolsDirectoryQuery,
  success: SchoolDirectoryResponse,
})
  .in(DirectoryGroup)
  .http.get("/api/schools")
  .http.contract({
    query: true,
    responseHeaders: PrivateReadResponseHeaders,
    metadata: {
      summary: "List schools",
      description: "Returns the native school directory in authority scope.",
    },
  })
  .http.problems({ codes: ListSchoolsCodes, identifier: "DirectoryListSchoolsProblem" })
  .http.access({
    capabilities: Capability.one("schools.read-directory"),
    requirements: [],
    canonicalScopeResolver: SchoolsDirectoryResolver,
    decisionTime: "SnapshotRead",
  })
  .declare();

export const ExecuteSchoolCommand = Operation.command({
  name: "directory.executeSchoolCommand",
  input: SchoolCommand,
  success: SchoolCommandResult,
})
  .in(DirectoryGroup)
  .http.post("/api/schools/commands")
  .http.contract({
    headers: IdempotencyHeaders,
    responseHeaders: EntityMutationResponseHeaders,
    metadata: {
      summary: "Maintain schools",
      description: "Applies one scoped school command with an idempotency key.",
    },
  })
  .http.problems({ codes: SchoolCommandCodes, identifier: "SchoolCommandProblem" })
  .http.access({
    capabilities: Capability.one("schools.manage"),
    requirements: [],
    canonicalScopeResolver: SchoolsManagementResolver,
    decisionTime: "Transaction",
  })
  .declare();

export const AmendSchool = Operation.command({
  name: "directory.amendSchool",
  input: SchoolPatch,
  success: SchoolPatchResult,
})
  .in(DirectoryGroup)
  .http.patch("/api/schools/management")
  .http.contract({
    root: "external-native-api",
    group: "directory",
    headers: SchoolPatchHeaders,
    status: 200,
    responseHeaders: EntityMutationResponseHeaders,
    middleware: [PersonSecurity],
    metadata: {
      annotator: directoryOperationAnnotations,
      summary: "Amend school",
      description: "Updates a school's name at the observed revision.",
    },
  })
  .http.problems({
    registry: DirectoryProblemResponses,
    codes: SchoolPatchCodes,
    identifier: "SchoolPatchProblem",
  })
  .http.access({
    annotator: directoryAccessAnnotations,
    exposure: "External",
    acceptedCredentials: ["BetterAuthCookie"],
    principalKinds: ["Person"],
    concealment: Concealment.reveal,
    capabilities: Capability.one("schools.manage"),
    requirements: [{ id: "schools.revision" }],
    canonicalScopeResolver: SchoolsManagementResolver,
    decisionTime: "Transaction",
  })
  .declare();
