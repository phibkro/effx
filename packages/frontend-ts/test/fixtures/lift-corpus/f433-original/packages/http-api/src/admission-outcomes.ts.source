/**
 * HTTP contract for admission outcomes: the recorded outcome of each application, and the
 * substitutes on call whom department members contact to arrange cover.
 */
import { PublicApplicationIdSchema } from "@vektorprogrammet/domain/application";
import { AdmissionPeriodId } from "@vektorprogrammet/domain/admission-period";
import {
  AdmissionOutcomeCommand,
  AdmissionOutcomeEntry,
  AdmissionOutcomeScope,
  AdmissionOutcomeScopes,
  OnCallSubstitute,
} from "@vektorprogrammet/domain/admissions";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";
import { annotateAccessSpec, personNativeAccess } from "./access.js";
import { operationAnnotations, PersonSecurity } from "./common.js";
import {
  ConditionalReadHeaders,
  StrongETag,
  IdempotencyIfMatchHeaders,
  privateReadResponse,
  privateConditionalResponses,
  entityMutationResponse,
  endpointProblemResponses,
  problemUnion,
} from "./http-semantics.js";

export { AdmissionOutcomeCommand, AdmissionOutcomeScope };

export const AdmissionOutcomeResource = Schema.Struct({
  ...AdmissionOutcomeEntry.fields,
  etag: StrongETag,
}).annotate({ identifier: "AdmissionOutcomeResource" });

const BoardFields = {
  ...AdmissionOutcomeScope.fields,
  admissionPeriodId: Schema.NullOr(AdmissionPeriodId),
};

/** Admission management sees every application; other department members see substitutes on call. */
export const AdmissionOutcomeBoardResource = Schema.TaggedUnion({
  ReadOnly: { ...BoardFields, substitutes: Schema.Array(OnCallSubstitute) },
  Decide: { ...BoardFields, entries: Schema.Array(AdmissionOutcomeResource) },
}).annotate({ identifier: "AdmissionOutcomeBoardResource" });

const admissionOutcomeProblems = [
  "request.malformed",
  "request.too-large",
  "precondition.invalid",
  "idempotency-key.invalid",
  "header.malformed",
  "validation.failed",
  "scope.invalid",
  "authority.denied",
  "resource.not-found",
  "precondition.required",
  "precondition.failed",
  "idempotency.in-flight",
  "idempotency.digest-conflict",
  "idempotency.response-expired",
  "transaction.conflict",
  "internal.error",
  "media-type.unsupported",
] as const;

export const AdmissionOutcomeProblem = problemUnion(
  "AdmissionOutcomeProblem",
  admissionOutcomeProblems,
);

/** A command also answers an unavailable receipt store. */
export const AdmissionOutcomeCommandProblem = problemUnion("AdmissionOutcomeCommandProblem", [
  ...admissionOutcomeProblems,
  "idempotency.unavailable",
]);

const access = (decide: boolean) =>
  personNativeAccess({
    capability: decide ? "admissions.outcomes.decide" : "admissions.outcomes.read",
    canonicalScopeResolver: "admissions.application-outcomes",
    decisionTime: decide ? "Transaction" : "SnapshotRead",
  });

export const ListAdmissionOutcomeScopesEndpoint = HttpApiEndpoint.get(
  "listScopes",
  "/api/admission-outcomes/scopes",
  {
    success: privateReadResponse(AdmissionOutcomeScopes),
    error: endpointProblemResponses(AdmissionOutcomeProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((e) => annotateAccessSpec(e, access(false)))
  .annotateMerge(
    operationAnnotations(
      "Select admission outcome scope",
      "Authorized departments and canonical historical semesters.",
    ),
  );

export const ReadAdmissionOutcomesEndpoint = HttpApiEndpoint.get(
  "readOutcomes",
  "/api/admission-outcomes",
  {
    query: AdmissionOutcomeScope.fields,
    success: privateReadResponse(AdmissionOutcomeBoardResource),
    error: endpointProblemResponses(AdmissionOutcomeProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((e) => annotateAccessSpec(e, access(false)))
  .annotateMerge(
    operationAnnotations(
      "Read admission outcomes",
      "Admission management reads every application of the period; other department members read the name and contact of each substitute on call.",
    ),
  );

export const ReadAdmissionOutcomeEndpoint = HttpApiEndpoint.get(
  "readOutcome",
  "/api/admission-outcomes/:applicationId",
  {
    params: { applicationId: PublicApplicationIdSchema },
    headers: ConditionalReadHeaders,
    success: privateConditionalResponses(AdmissionOutcomeResource),
    error: endpointProblemResponses(AdmissionOutcomeProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((e) => annotateAccessSpec(e, access(false)))
  .annotateMerge(
    operationAnnotations(
      "Select admission outcome",
      "Only admission management reads one application's outcome entry.",
    ),
  );

export const RecordAdmissionOutcomeEndpoint = HttpApiEndpoint.post(
  "recordOutcome",
  "/api/admission-outcomes/:applicationId:record",
  {
    params: { applicationId: PublicApplicationIdSchema },
    headers: IdempotencyIfMatchHeaders,
    payload: AdmissionOutcomeCommand,
    success: entityMutationResponse(AdmissionOutcomeResource),
    error: endpointProblemResponses(AdmissionOutcomeCommandProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((e) => annotateAccessSpec(e, access(true)))
  .annotateMerge(
    operationAnnotations(
      "Record admission outcome",
      "Records Admitted, Substitute, or Rejected. Recording the current outcome again changes nothing.",
    ),
  );

export class AdmissionOutcomesApi extends HttpApiGroup.make("admissionOutcomes")
  .add(ListAdmissionOutcomeScopesEndpoint)
  .add(ReadAdmissionOutcomesEndpoint)
  .add(ReadAdmissionOutcomeEndpoint)
  .add(RecordAdmissionOutcomeEndpoint)
  .annotateMerge(
    OpenApi.annotations({
      title: "Admission outcomes",
      description:
        "Recorded admission outcomes and the substitutes on call. People arrange cover outside the system.",
    }),
  ) {}
