/**
 * Public HTTP contracts for admission periods and applications.
 *
 * @since 0.1.0
 */
import { AdmissionPeriodId } from "@vektorprogrammet/domain/admission-period";
import {
  ApplicantProgressItemSchema,
  ApplicantProgressResponseSchema,
  ApplicantProgressStateSchema,
  PublicApplicationCatalogSchema,
  PublicApplicationIdSchema,
  ReturningAssistantOptionsSchema,
  ReturningAssistantRegistrationInputSchema,
  ReturningAssistantRegistrationResponseSchema,
  type ApplicantProgressItem,
  type ApplicantProgressResponse,
  type ApplicantProgressState,
} from "@vektorprogrammet/domain/application";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";
import { annotateAccessSpec, anonymousNativeAccess, personNativeAccess } from "./access.js";
import { operationAnnotations, PersonSecurity } from "./common.js";
import {
  AdmissionsCreateAdmissionPeriodProblem,
  AdmissionsListAdmissionPeriodsProblem,
  AdmissionsListApplicationOptionsProblem,
  AdmissionsListOpenAdmissionPeriodsProblem,
  AdmissionsReadApplicantProgressProblem,
  AdmissionsReadApplicationConfirmationProblem,
  AdmissionsReadReturningAssistantOptionsProblem,
  AdmissionsRegisterReturningAssistantProblem,
  AdmissionsReviseAdmissionPeriodProblem,
  AdmissionsSubmitApplicationProblem,
} from "./endpoint-problems.js";
import {
  ConditionalReadHeaders,
  createdMutationResponse,
  dynamicAdmissionConditionalResponses,
  endpointProblemResponses,
  entityMutationResponse,
  IdempotencyHeaders,
  IdempotencyIfMatchHeaders,
  noStoreReadResponse,
  privateConditionalResponses,
  privateReadResponse,
} from "./http-semantics.js";
import {
  AdmissionPeriodManagementItem,
  AdmissionPeriodManagementListResponse,
  AdmissionPeriodMergePatch,
  CreateAdmissionPeriodRequest,
  OpenAdmissionPeriodListResponse,
  PublicApplicationConfirmationSchema,
  SubmitApplicationRequest,
} from "./v2-schemas.js";

export {
  AdmissionPeriodId,
  ApplicantProgressItemSchema,
  ApplicantProgressResponseSchema,
  ApplicantProgressStateSchema,
  PublicApplicationIdSchema,
  ReturningAssistantRegistrationInputSchema,
};

export type { ApplicantProgressItem, ApplicantProgressResponse, ApplicantProgressState };

/** @since 0.1.0 @category Endpoints */
export const ListOpenAdmissionPeriodsEndpoint = HttpApiEndpoint.get(
  "listOpenAdmissionPeriods",
  "/api/open-admission-periods",
  {
    headers: ConditionalReadHeaders,
    success: dynamicAdmissionConditionalResponses(OpenAdmissionPeriodListResponse),
    error: endpointProblemResponses(AdmissionsListOpenAdmissionPeriodsProblem),
  },
)
  .pipe((endpoint) =>
    annotateAccessSpec(endpoint, anonymousNativeAccess("admissions.public-open-periods")),
  )
  .annotateMerge(
    operationAnnotations(
      "List open admission periods",
      "Returns currently open native admission periods.",
    ),
  );

/** @since 0.1.0 @category Endpoints */
export const ReadApplicationCatalogEndpoint = HttpApiEndpoint.get(
  "listApplicationOptions",
  "/api/application-options",
  {
    headers: ConditionalReadHeaders,
    success: dynamicAdmissionConditionalResponses(PublicApplicationCatalogSchema),
    error: endpointProblemResponses(AdmissionsListApplicationOptionsProblem),
  },
)
  .pipe((endpoint) =>
    annotateAccessSpec(endpoint, anonymousNativeAccess("admissions.public-application-options")),
  )
  .annotateMerge(
    operationAnnotations(
      "List application options",
      "Returns departments and fields open to applicants.",
    ),
  );

/** @since 0.1.0 @category Endpoints */
export const SubmitApplicationEndpoint = HttpApiEndpoint.post(
  "submitApplication",
  "/api/applications",
  {
    headers: IdempotencyHeaders,
    payload: SubmitApplicationRequest,
    success: createdMutationResponse(
      PublicApplicationConfirmationSchema.pipe(HttpApiSchema.status(201)),
    ),
    error: endpointProblemResponses(AdmissionsSubmitApplicationProblem),
  },
)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      anonymousNativeAccess("admissions.application-create", "Transaction"),
    ),
  )
  .annotateMerge(
    operationAnnotations("Submit application", "Submits or replays a public applicant command."),
  );

/** @since 0.1.0 @category Endpoints */
export const ReadApplicationConfirmationEndpoint = HttpApiEndpoint.get(
  "readApplicationConfirmation",
  "/api/applications/:applicationId",
  {
    params: { applicationId: PublicApplicationIdSchema },
    success: noStoreReadResponse(PublicApplicationConfirmationSchema),
    error: endpointProblemResponses(AdmissionsReadApplicationConfirmationProblem),
  },
)
  .pipe((endpoint) =>
    annotateAccessSpec(endpoint, anonymousNativeAccess("admissions.public-application-by-id")),
  )
  .annotateMerge(
    operationAnnotations(
      "Read application confirmation",
      "Returns the public confirmation projection.",
    ),
  );

/** @since 0.1.0 @category Endpoints */
export const ReadApplicantProgressEndpoint = HttpApiEndpoint.get(
  "readApplicantProgress",
  "/api/applicant-progress",
  {
    success: privateReadResponse(ApplicantProgressResponseSchema),
    error: endpointProblemResponses(AdmissionsReadApplicantProgressProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "admissions.read-applicant-progress",
        canonicalScopeResolver: "profile.current-person",
        requirements: ["profile.owner"],
        decisionTime: "SnapshotRead",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Read applicant progress",
      "Returns current-semester recruitment progress for the signed-in applicant.",
    ),
  );

/** @since 0.1.0 @category Endpoints */
export const ListAdmissionPeriodsEndpoint = HttpApiEndpoint.get(
  "listAdmissionPeriods",
  "/api/admission-periods",
  {
    headers: ConditionalReadHeaders,
    success: privateConditionalResponses(AdmissionPeriodManagementListResponse),
    error: endpointProblemResponses(AdmissionsListAdmissionPeriodsProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "admissions.read-periods",
        canonicalScopeResolver: "admissions.management-periods",
        decisionTime: "SnapshotRead",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "List admission periods",
      "Returns the management admission-period projection.",
    ),
  );

/** @since 0.1.0 @category Endpoints */
export const CreateAdmissionPeriodEndpoint = HttpApiEndpoint.post(
  "createAdmissionPeriod",
  "/api/admission-periods",
  {
    headers: IdempotencyHeaders,
    payload: CreateAdmissionPeriodRequest,
    success: createdMutationResponse(AdmissionPeriodManagementItem.pipe(HttpApiSchema.status(201))),
    error: endpointProblemResponses(AdmissionsCreateAdmissionPeriodProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "admissions.create-period",
        canonicalScopeResolver: "admissions.period-create",
        decisionTime: "Transaction",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Create admission period",
      "Creates or replays an admission-period command.",
    ),
  );

/** @since 0.1.0 @category Endpoints */
export const ReviseAdmissionPeriodEndpoint = HttpApiEndpoint.patch(
  "reviseAdmissionPeriod",
  "/api/admission-periods/:admissionPeriodId",
  {
    params: { admissionPeriodId: AdmissionPeriodId },
    headers: IdempotencyIfMatchHeaders,
    payload: AdmissionPeriodMergePatch.pipe(
      HttpApiSchema.asJson({ contentType: "application/merge-patch+json" }),
    ),
    success: entityMutationResponse(AdmissionPeriodManagementItem),
    error: endpointProblemResponses(AdmissionsReviseAdmissionPeriodProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "admissions.revise-period",
        canonicalScopeResolver: "admissions.period-by-id",
        decisionTime: "Transaction",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Revise admission period",
      "Revises or replays an admission-period command.",
    ),
  );

/** @since 0.1.0 @category Endpoints */
export const ReadReturningAssistantOptionsEndpoint = HttpApiEndpoint.get(
  "readReturningAssistantOptions",
  "/api/returning-assistant/options",
  {
    success: noStoreReadResponse(ReturningAssistantOptionsSchema),
    error: endpointProblemResponses(AdmissionsReadReturningAssistantOptionsProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "placements.self",
        canonicalScopeResolver: "profile.current-person",
        decisionTime: "SnapshotRead",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Read returning-assistant registration options",
      "Returns current identity, placement, department and admission-period options.",
    ),
  );

/** @since 0.1.0 @category Endpoints */
export const RegisterReturningAssistantEndpoint = HttpApiEndpoint.post(
  "registerReturningAssistant",
  "/api/returning-assistant/registrations",
  {
    headers: IdempotencyHeaders,
    payload: ReturningAssistantRegistrationInputSchema,
    success: createdMutationResponse(
      ReturningAssistantRegistrationResponseSchema.pipe(HttpApiSchema.status(201)),
    ),
    error: endpointProblemResponses(AdmissionsRegisterReturningAssistantProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "placements.self",
        canonicalScopeResolver: "profile.current-person",
        decisionTime: "Transaction",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Register returning assistant",
      "Registers a returning assistant for an admission period with immutable provenance.",
    ),
  );

/**
 * Public applicant and administrative admission endpoints.
 *
 * @since 0.1.0
 * @category Groups
 */
export class AdmissionsApi extends HttpApiGroup.make("admissions")
  .add(
    ListOpenAdmissionPeriodsEndpoint,
    ReadApplicationCatalogEndpoint,
    SubmitApplicationEndpoint,
    ReadApplicationConfirmationEndpoint,
    ReadApplicantProgressEndpoint,
    ListAdmissionPeriodsEndpoint,
    CreateAdmissionPeriodEndpoint,
    ReviseAdmissionPeriodEndpoint,
    ReadReturningAssistantOptionsEndpoint,
    RegisterReturningAssistantEndpoint,
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Admissions",
      description: "Public applicant and administrative admission-period API.",
    }),
  ) {}
