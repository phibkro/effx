import { Effect } from "effect";
import { Http, Query } from "@effx/runtime";
import { PersonSecurity } from "./profile-support.js";
import { ExternalDirectoryApi } from "./directory-root.js";
import {
  DirectoryProblemResponses,
  DirectoryRequestMarker,
  ListSchoolsCodes,
  PrivateReadResponseHeaders,
  SchoolDirectoryResponse,
  SchoolsDirectoryQuery,
  SchoolsDirectoryResolver,
  directoryAccessAnnotations,
  directoryOperationAnnotations,
} from "./directory-support.js";

@Http.Group({
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
      concealment: { _tag: "Reveal" },
    },
  },
})
export class DirectoryMethods {
  @Query({
    name: "directory.listSchools",
    input: SchoolsDirectoryQuery,
    success: SchoolDirectoryResponse,
  })
  @Http.Get("/api/schools")
  @Http.Contract({
    query: true,
    status: 200,
    responseHeaders: PrivateReadResponseHeaders,
    metadata: {
      summary: "List schools",
      description: "Returns the native school directory in authority scope.",
    },
  })
  @Http.Problems({ codes: ListSchoolsCodes, identifier: "DirectoryListSchoolsProblem" })
  @Http.Access({
    capabilities: { _tag: "One", capability: "schools.read-directory" },
    requirements: [],
    canonicalScopeResolver: SchoolsDirectoryResolver,
    decisionTime: "SnapshotRead",
  })
  static listSchools(_input: typeof SchoolsDirectoryQuery.Type) {
    return Effect.succeed({ schools: [] });
  }
}
