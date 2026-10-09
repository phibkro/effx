/**
 * Public HTTP contracts for health and first-party session resources.
 *
 * @since 0.1.0
 */
import { PersonId } from "@vektorprogrammet/domain/organization";
import { PUBLIC_SYSTEM_ACCESS } from "@vektorprogrammet/domain/authz";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";
import { annotateAccessSpec, browserSessionNativeAccess } from "./access.js";
import { operationAnnotations, SessionSecurity } from "./common.js";
import {
  SystemDeleteOwnedSessionProblem,
  SystemDeleteSessionProblem,
  SystemHealthProblem,
  SystemListSessionsProblem,
  SystemReadSessionProblem,
  SystemRevokeAllSessionsProblem,
  SystemRevokeOtherSessionsProblem,
} from "./endpoint-problems.js";
import {
  endpointProblemResponses,
  IdempotencyHeaders,
  noContentMutationResponse,
  noStoreReadResponse,
  privateReadResponse,
} from "./http-semantics.js";

export const HealthOkResponse = Schema.Struct({ status: Schema.Literals(["ok"]) })
  .pipe(HttpApiSchema.status(200))
  .annotate({ identifier: "HealthOkResponse", description: "Database is available." });

export const HealthUnavailableResponse = Schema.Struct({ status: Schema.Literals(["unavailable"]) })
  .pipe(HttpApiSchema.status(503))
  .annotate({
    identifier: "HealthUnavailableResponse",
    description: "Database is unavailable.",
  });

export const HealthEndpoint = HttpApiEndpoint.get("health", "/health", {
  success: noStoreReadResponse(HealthOkResponse),
  error: endpointProblemResponses(SystemHealthProblem),
})
  .pipe((endpoint) => annotateAccessSpec(endpoint, PUBLIC_SYSTEM_ACCESS))
  .annotateMerge(
    operationAnnotations("Read native health", "Checks the native PostgreSQL boundary."),
  );

const SessionId = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => value.length > 0 && value.length <= 128, {
      message: "a bounded opaque session identifier",
    }),
  ),
);

/** Credential-free owner-only session metadata. */
export const SessionResponse = Schema.Struct({
  sessionId: SessionId,
  personId: PersonId,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  expiresAt: Schema.String,
  ipAddress: Schema.NullOr(Schema.String),
  userAgent: Schema.NullOr(Schema.String),
  current: Schema.Boolean,
}).annotate({
  identifier: "SessionResponse",
  description: "Safe first-party session metadata without credential material.",
});

export const SessionListResponse = Schema.Array(SessionResponse).annotate({
  identifier: "SessionListResponse",
  description: "Sessions owned by the authenticated person.",
});

export const ReadSessionEndpoint = HttpApiEndpoint.get("readSession", "/api/session", {
  success: privateReadResponse(SessionResponse),
  error: endpointProblemResponses(SystemReadSessionProblem),
})
  .middleware(SessionSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      browserSessionNativeAccess({
        canonicalScopeResolver: "identity.current-session",
        decisionTime: "SnapshotRead",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Read current session",
      "Reads safe metadata for the authoritative current Better Auth session.",
    ),
  );

export const DeleteSessionEndpoint = HttpApiEndpoint.delete("deleteSession", "/api/session", {
  headers: IdempotencyHeaders,
  success: noContentMutationResponse(),
  error: endpointProblemResponses(SystemDeleteSessionProblem),
})
  .middleware(SessionSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      browserSessionNativeAccess({
        canonicalScopeResolver: "identity.current-session",
        decisionTime: "Transaction",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations("End current session", "Revokes the authoritative current session."),
  );

export const ListSessionsEndpoint = HttpApiEndpoint.get("listSessions", "/api/sessions", {
  success: privateReadResponse(SessionListResponse),
  error: endpointProblemResponses(SystemListSessionsProblem),
})
  .middleware(SessionSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      browserSessionNativeAccess({
        canonicalScopeResolver: "identity.owned-sessions",
        requirements: ["sessions.owner"],
        decisionTime: "SnapshotRead",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "List current person's sessions",
      "Lists only safe metadata for sessions owned by the authenticated person.",
    ),
  );

export const DeleteOwnedSessionEndpoint = HttpApiEndpoint.delete(
  "deleteOwnedSession",
  "/api/sessions/:sessionId",
  {
    params: { sessionId: SessionId },
    success: noContentMutationResponse(),
    headers: IdempotencyHeaders,
    error: endpointProblemResponses(SystemDeleteOwnedSessionProblem),
  },
)
  .middleware(SessionSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      browserSessionNativeAccess({
        canonicalScopeResolver: "identity.session-by-id",
        requirements: ["sessions.owner"],
        concealRequirement: true,
        decisionTime: "Transaction",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Revoke one session",
      "Revokes one owned session; missing and non-owned identifiers are concealed.",
    ),
  );

export const RevokeOtherSessionsEndpoint = HttpApiEndpoint.post(
  "revokeOtherSessions",
  "/api/sessions:revoke-others",
  {
    params: {},
    headers: IdempotencyHeaders,
    success: noContentMutationResponse(),
    error: endpointProblemResponses(SystemRevokeOtherSessionsProblem),
  },
)
  .middleware(SessionSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      browserSessionNativeAccess({
        canonicalScopeResolver: "identity.current-session",
        decisionTime: "Transaction",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Revoke other sessions",
      "Revokes every owned session except the authoritative current session.",
    ),
  );

export const RevokeAllSessionsEndpoint = HttpApiEndpoint.post(
  "revokeAllSessions",
  "/api/sessions:revoke-all",
  {
    params: {},
    headers: IdempotencyHeaders,
    success: noContentMutationResponse(),
    error: endpointProblemResponses(SystemRevokeAllSessionsProblem),
  },
)
  .middleware(SessionSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      browserSessionNativeAccess({
        canonicalScopeResolver: "identity.current-session",
        decisionTime: "Transaction",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Revoke all sessions",
      "Revokes every owned session, including the authoritative current session.",
    ),
  );

export class SystemApi extends HttpApiGroup.make("system")
  .add(
    HealthEndpoint,
    ReadSessionEndpoint,
    DeleteSessionEndpoint,
    ListSessionsEndpoint,
    DeleteOwnedSessionEndpoint,
    RevokeOtherSessionsEndpoint,
    RevokeAllSessionsEndpoint,
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "System",
      description: "Native health and first-party session resources.",
    }),
  ) {}
