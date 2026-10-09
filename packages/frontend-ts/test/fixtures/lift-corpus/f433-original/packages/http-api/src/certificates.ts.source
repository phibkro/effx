/**
 * Days served and certificates: school coordination confirms each assistant's days served per
 * department and semester, and an issuer downloads the cumulative certificate of an assistant.
 *
 * @since 0.2.0
 */
import { DepartmentId, PersonId, SemesterId } from "@vektorprogrammet/domain/organization";
import {
  AssistantCursor,
  CertificateAssistant,
  CertificatePreview,
  CertificateScopes,
  CertificateSemesterScope,
  DAYS_SERVED_PAGE_SIZE,
  DaysServedEntry,
  DaysServedTotal,
} from "@vektorprogrammet/domain/placements";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";
import { annotateAccessSpec, personNativeAccess } from "./access.js";
import { operationAnnotations, PersonSecurity } from "./common.js";
import {
  documentMutationResponse,
  endpointProblemResponses,
  entityMutationResponse,
  IdempotencyIfMatchHeaders,
  privateReadResponse,
  problemUnion,
  StrongETag,
} from "./http-semantics.js";

export { AssistantCursor, CertificateScopes, DaysServedTotal };

/** One assistant's days served, with the entity tag that a confirmation's `If-Match` repeats. */
export const DaysServedEntryResource = Schema.Struct({
  ...DaysServedEntry.fields,
  etag: StrongETag,
}).annotate({
  identifier: "DaysServedEntryResource",
  description:
    "One assistant in one department and semester: the dated evidence, the calculated count, and the current confirmation.",
});

export const DaysServedListResponse = Schema.Struct({
  departmentId: DepartmentId,
  departmentName: Schema.String,
  semester: CertificateSemesterScope,
  items: Schema.Array(DaysServedEntryResource).pipe(
    Schema.check(Schema.isMaxLength(DAYS_SERVED_PAGE_SIZE)),
  ),
  nextCursor: Schema.optional(AssistantCursor),
}).annotate({
  identifier: "DaysServedListResponse",
  description: `One page of at most ${DAYS_SERVED_PAGE_SIZE} assistants, ordered by name.`,
});

/** Confirms the calculated count, or adjusts it; zero is a confirmed total too. */
export const ConfirmDaysServedInput = Schema.Struct({ total: DaysServedTotal }).annotate({
  identifier: "ConfirmDaysServedInput",
});

export const CertificateListResponse = Schema.Struct({
  departmentId: DepartmentId,
  departmentName: Schema.String,
  items: Schema.Array(CertificateAssistant).pipe(
    Schema.check(Schema.isMaxLength(DAYS_SERVED_PAGE_SIZE)),
  ),
  nextCursor: Schema.optional(AssistantCursor),
}).annotate({
  identifier: "CertificateListResponse",
  description: `One page of at most ${DAYS_SERVED_PAGE_SIZE} assistants with service in the department, ordered by name.`,
});

/** What the issuer sees before download, with the entity tag of the content that would be issued. */
export const CertificatePreviewResource = Schema.Struct({
  ...CertificatePreview.fields,
  etag: StrongETag,
}).annotate({
  identifier: "CertificatePreviewResource",
  description:
    "Every semester of the assistant in the department with its status, the certificate that an issue would record, and its content entity tag.",
});

export const CertificatesReadProblem = problemUnion("CertificatesReadProblem", [
  "request.malformed",
  "header.malformed",
  "authority.denied",
  "origin.denied",
  "resource.not-found",
  "transaction.conflict",
  "internal.error",
]);

export const CertificatesConfirmProblem = problemUnion("CertificatesConfirmProblem", [
  "request.malformed",
  "header.malformed",
  "idempotency-key.invalid",
  "precondition.invalid",
  "authority.denied",
  "origin.denied",
  "resource.not-found",
  "idempotency.in-flight",
  "idempotency.digest-conflict",
  "idempotency.response-expired",
  "transaction.conflict",
  "precondition.failed",
  "request.too-large",
  "media-type.unsupported",
  "validation.failed",
  "precondition.required",
  "internal.error",
  "idempotency.unavailable",
]);

export const CertificatesIssueProblem = problemUnion("CertificatesIssueProblem", [
  "request.malformed",
  "header.malformed",
  "idempotency-key.invalid",
  "precondition.invalid",
  "authority.denied",
  "origin.denied",
  "resource.not-found",
  "idempotency.in-flight",
  "idempotency.digest-conflict",
  "idempotency.response-expired",
  "transaction.conflict",
  "precondition.failed",
  "certificate.empty",
  "certificate.unprintable",
  "precondition.required",
  "internal.error",
  "idempotency.unavailable",
]);

const access = (
  capability: "placements.days-served" | "certificates.issue",
  decisionTime: "SnapshotRead" | "Transaction",
) =>
  personNativeAccess({
    capability,
    canonicalScopeResolver: "placements.explicit-department",
    decisionTime,
  });

const SemesterParams = { departmentId: DepartmentId, semesterId: SemesterId };

const EntryParams = { ...SemesterParams, personId: PersonId };

const DepartmentParams = { departmentId: DepartmentId };

const CertificateParams = { departmentId: DepartmentId, personId: PersonId };

/** @since 0.2.0 @category Endpoints */
export const ReadCertificateScopesEndpoint = HttpApiEndpoint.get(
  "readCertificateScopes",
  "/api/certificate-scopes",
  {
    success: privateReadResponse(CertificateScopes),
    error: endpointProblemResponses(CertificatesReadProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "placements.days-served",
        alternatives: ["certificates.issue"],
        canonicalScopeResolver: "placements.explicit-department",
        decisionTime: "SnapshotRead",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Read certificate scopes",
      "Returns the departments where the reader confirms days served or issues certificates, and the semesters. Either capability in some department grants the read.",
    ),
  );

/** @since 0.2.0 @category Endpoints */
export const ListDaysServedEndpoint = HttpApiEndpoint.get(
  "listDaysServed",
  "/api/departments/:departmentId/semesters/:semesterId/days-served",
  {
    params: SemesterParams,
    query: { cursor: Schema.optional(AssistantCursor) },
    success: privateReadResponse(DaysServedListResponse),
    error: endpointProblemResponses(CertificatesReadProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(endpoint, access("placements.days-served", "SnapshotRead")),
  )
  .annotateMerge(
    operationAnnotations(
      "List days served",
      "Returns a bounded page of the assistants of a department and semester with the dated evidence, the calculated count, and the current confirmation. Requires the days-served capability in the department.",
    ),
  );

/** @since 0.2.0 @category Endpoints */
export const ConfirmDaysServedEndpoint = HttpApiEndpoint.post(
  "confirmDaysServed",
  "/api/departments/:departmentId/semesters/:semesterId/days-served/:personId",
  {
    params: EntryParams,
    headers: IdempotencyIfMatchHeaders,
    payload: ConfirmDaysServedInput,
    success: entityMutationResponse(DaysServedEntryResource),
    error: endpointProblemResponses(CertificatesConfirmProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) => annotateAccessSpec(endpoint, access("placements.days-served", "Transaction")))
  .annotateMerge(
    operationAnnotations(
      "Confirm days served",
      "Confirms or adjusts one assistant's total for the semester as the next revision. The earlier confirmation stays as history. Requires the observed entry entity tag.",
    ),
  );

/** @since 0.2.0 @category Endpoints */
export const ListCertificatesEndpoint = HttpApiEndpoint.get(
  "listCertificates",
  "/api/departments/:departmentId/certificates",
  {
    params: DepartmentParams,
    query: { cursor: Schema.optional(AssistantCursor) },
    success: privateReadResponse(CertificateListResponse),
    error: endpointProblemResponses(CertificatesReadProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) => annotateAccessSpec(endpoint, access("certificates.issue", "SnapshotRead")))
  .annotateMerge(
    operationAnnotations(
      "List certificates",
      "Returns a bounded page of the assistants with service in the department and how many semesters their certificate lists. Issuers of the department only.",
    ),
  );

/** @since 0.2.0 @category Endpoints */
export const ReadCertificateEndpoint = HttpApiEndpoint.get(
  "readCertificate",
  "/api/departments/:departmentId/certificates/:personId",
  {
    params: CertificateParams,
    success: privateReadResponse(CertificatePreviewResource),
    error: endpointProblemResponses(CertificatesReadProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) => annotateAccessSpec(endpoint, access("certificates.issue", "SnapshotRead")))
  .annotateMerge(
    operationAnnotations(
      "Read certificate",
      "Returns every semester of the assistant in the department with its status and the certificate that an issue would record. Issuers of the department only, never the assistant.",
    ),
  );

/** @since 0.2.0 @category Endpoints */
export const IssueCertificateEndpoint = HttpApiEndpoint.post(
  "issueCertificate",
  "/api/departments/:departmentId/certificates/:personId/issues",
  {
    params: CertificateParams,
    headers: IdempotencyIfMatchHeaders,
    success: documentMutationResponse("application/pdf"),
    error: endpointProblemResponses(CertificatesIssueProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) => annotateAccessSpec(endpoint, access("certificates.issue", "Transaction")))
  .annotateMerge(
    operationAnnotations(
      "Issue certificate",
      "Records one issue of the certificate with the issuer, the authorizing seat, the instant, and the content hash, and returns the PDF. Requires the observed certificate entity tag. An idempotency-key replay returns the same PDF.",
    ),
  );

/**
 * Days served and certificates.
 *
 * @since 0.2.0
 * @category Groups
 */
export class CertificatesApi extends HttpApiGroup.make("certificates")
  .add(
    ReadCertificateScopesEndpoint,
    ListDaysServedEndpoint,
    ConfirmDaysServedEndpoint,
    ListCertificatesEndpoint,
    ReadCertificateEndpoint,
    IssueCertificateEndpoint,
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Certificates",
      description:
        "Confirmation of days served per assistant, department, and semester, and the issue of cumulative certificates.",
    }),
  ) {}
