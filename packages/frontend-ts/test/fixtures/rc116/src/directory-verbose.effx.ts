import { Http, Operation } from "@effx/runtime";
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
});

export const ListPeople = Operation.query({
  name: "directory.listPeople",
  input: EmptyDirectoryInput,
  success: PeopleDirectoryResponse,
})
  .http.get("/api/people")
  .http.contract({
    root: "external-native-api",
    group: "directory",
    success: PeopleDirectoryResponse,
    status: 200,
    responseHeaders: PrivateReadResponseHeaders,
    middleware: [PersonSecurity, DirectoryRequestMarker],
    metadata: {
      annotator: directoryOperationAnnotations,
      operationId: "directory.listPeople",
      summary: "List people",
      description: "Returns the people directory within the caller's scope.",
    },
  })
  .http.problems({
    registry: DirectoryProblemResponses,
    codes: ListPeopleCodes,
    identifier: "DirectoryListPeopleProblem",
  })
  .http.access({
    annotator: directoryAccessAnnotations,
    exposure: "External",
    acceptedCredentials: ["BetterAuthCookie", "OAuthUserBearer"],
    principalKinds: ["Person"],
    concealment: { _tag: "Reveal" },
    capabilities: { _tag: "One", capability: "profile.read-directory" },
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
  .http.get("/api/schools")
  .http.contract({
    root: "external-native-api",
    group: "directory",
    query: SchoolsDirectoryQuery,
    success: SchoolDirectoryResponse,
    status: 200,
    responseHeaders: PrivateReadResponseHeaders,
    middleware: [PersonSecurity, DirectoryRequestMarker],
    metadata: {
      annotator: directoryOperationAnnotations,
      operationId: "directory.listSchools",
      summary: "List schools",
      description: "Returns the native school directory in authority scope.",
    },
  })
  .http.problems({
    registry: DirectoryProblemResponses,
    codes: ListSchoolsCodes,
    identifier: "DirectoryListSchoolsProblem",
  })
  .http.access({
    annotator: directoryAccessAnnotations,
    exposure: "External",
    acceptedCredentials: ["BetterAuthCookie", "OAuthUserBearer"],
    principalKinds: ["Person"],
    concealment: { _tag: "Reveal" },
    capabilities: { _tag: "One", capability: "schools.read-directory" },
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
  .http.post("/api/schools/commands")
  .http.contract({
    root: "external-native-api",
    group: "directory",
    headers: IdempotencyHeaders,
    payload: SchoolCommand,
    success: SchoolCommandResult,
    status: 200,
    responseHeaders: EntityMutationResponseHeaders,
    middleware: [PersonSecurity, DirectoryRequestMarker],
    metadata: {
      annotator: directoryOperationAnnotations,
      operationId: "directory.executeSchoolCommand",
      summary: "Maintain schools",
      description: "Applies one scoped school command with an idempotency key.",
    },
  })
  .http.problems({
    registry: DirectoryProblemResponses,
    codes: SchoolCommandCodes,
    identifier: "SchoolCommandProblem",
  })
  .http.access({
    annotator: directoryAccessAnnotations,
    exposure: "External",
    acceptedCredentials: ["BetterAuthCookie", "OAuthUserBearer"],
    principalKinds: ["Person"],
    concealment: { _tag: "Reveal" },
    capabilities: { _tag: "One", capability: "schools.manage" },
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
  .http.patch("/api/schools/management")
  .http.contract({
    root: "external-native-api",
    group: "directory",
    headers: SchoolPatchHeaders,
    payload: SchoolPatch,
    success: SchoolPatchResult,
    status: 200,
    responseHeaders: EntityMutationResponseHeaders,
    middleware: [PersonSecurity],
    metadata: {
      annotator: directoryOperationAnnotations,
      operationId: "directory.amendSchool",
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
    concealment: { _tag: "Reveal" },
    capabilities: { _tag: "One", capability: "schools.manage" },
    requirements: [{ id: "schools.revision" }],
    canonicalScopeResolver: SchoolsManagementResolver,
    decisionTime: "Transaction",
  })
  .declare();
