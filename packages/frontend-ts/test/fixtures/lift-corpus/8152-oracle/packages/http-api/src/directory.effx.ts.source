import { Capability, Concealment, Http, Operation } from "@effx/runtime";
import {
  SchoolCommand,
  SchoolCommandResult,
  SchoolManagement,
} from "@vektorprogrammet/domain/schools";
import { ExternalNativeApi } from "./api.js";
import { PersonSecurity, nativeOperationAnnotations } from "./common.js";
import {
  directoryAccessAnnotations,
  PeopleDirectoryResolver,
  SchoolsDirectoryResolver,
  SchoolsManagementResolver,
} from "./directory-effx-adapters.js";
import {
  EmptyDirectoryInput,
  PeopleDirectoryResponse,
  SchoolDirectoryResponse,
  SchoolsDirectoryQuery,
} from "./directory.js";
import {
  DirectoryListPeopleCodes,
  DirectoryListSchoolsCodes,
  SchoolAdministrationCodes,
  nativeProblems,
} from "./endpoint-problems.js";
import {
  EntityMutationResponseHeaders,
  IdempotencyHeaders,
  PrivateReadResponseHeaders,
} from "./http-semantics.js";

export const DirectoryGroup = Http.group({
  root: ExternalNativeApi,
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
    middleware: [PersonSecurity],
    metadata: {
      operationId: "directory.listPeople",
      summary: "List people",
      description: "Returns the people directory within the caller's scope.",
      annotator: nativeOperationAnnotations,
    },
  })
  .http.problems({
    registry: nativeProblems,
    identifier: "DirectoryListPeopleProblem",
    codes: DirectoryListPeopleCodes,
  })
  .http.access({
    annotator: directoryAccessAnnotations,
    exposure: "External",
    acceptedCredentials: ["BetterAuthCookie", "OAuthUserBearer"],
    principalKinds: ["Person"],
    capabilities: Capability.one("profile.read-directory"),
    requirements: [],
    canonicalScopeResolver: PeopleDirectoryResolver,
    concealment: Concealment.reveal,
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
    middleware: [PersonSecurity],
    metadata: {
      operationId: "directory.listSchools",
      summary: "List schools",
      description: "Returns the native school directory in authority scope.",
      annotator: nativeOperationAnnotations,
    },
  })
  .http.problems({
    registry: nativeProblems,
    identifier: "DirectoryListSchoolsProblem",
    codes: DirectoryListSchoolsCodes,
  })
  .http.access({
    annotator: directoryAccessAnnotations,
    exposure: "External",
    acceptedCredentials: ["BetterAuthCookie", "OAuthUserBearer"],
    principalKinds: ["Person"],
    capabilities: Capability.one("schools.read-directory"),
    requirements: [],
    canonicalScopeResolver: SchoolsDirectoryResolver,
    concealment: Concealment.reveal,
    decisionTime: "SnapshotRead",
  })
  .declare();

export const ReadSchoolManagement = Operation.query({
  name: "directory.readSchoolManagement",
  input: EmptyDirectoryInput,
  success: SchoolManagement,
})
  .http.get("/api/schools/management")
  .http.contract({
    root: "external-native-api",
    group: "directory",
    success: SchoolManagement,
    status: 200,
    responseHeaders: PrivateReadResponseHeaders,
    middleware: [PersonSecurity],
    metadata: {
      operationId: "directory.readSchoolManagement",
      summary: "Manage schools",
      description: "Returns authorized school facts, capacity plans, options, and history.",
      annotator: nativeOperationAnnotations,
    },
  })
  .http.problems({
    registry: nativeProblems,
    identifier: "SchoolAdministrationProblem",
    codes: SchoolAdministrationCodes,
  })
  .http.access({
    annotator: directoryAccessAnnotations,
    exposure: "External",
    acceptedCredentials: ["BetterAuthCookie", "OAuthUserBearer"],
    principalKinds: ["Person"],
    capabilities: Capability.one("schools.manage"),
    requirements: [],
    canonicalScopeResolver: SchoolsManagementResolver,
    concealment: Concealment.reveal,
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
    middleware: [PersonSecurity],
    metadata: {
      operationId: "directory.executeSchoolCommand",
      summary: "Maintain schools",
      description:
        "Applies one scoped school or capacity command with an explicit observed revision and atomic history.",
      annotator: nativeOperationAnnotations,
    },
  })
  .http.problems({
    registry: nativeProblems,
    identifier: "SchoolAdministrationProblem",
    codes: SchoolAdministrationCodes,
  })
  .http.access({
    annotator: directoryAccessAnnotations,
    exposure: "External",
    acceptedCredentials: ["BetterAuthCookie", "OAuthUserBearer"],
    principalKinds: ["Person"],
    capabilities: Capability.one("schools.manage"),
    requirements: [],
    canonicalScopeResolver: SchoolsManagementResolver,
    concealment: Concealment.reveal,
    decisionTime: "Transaction",
  })
  .declare();
