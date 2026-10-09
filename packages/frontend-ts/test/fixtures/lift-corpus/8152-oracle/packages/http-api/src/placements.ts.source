import {
  Affiliation,
  AffiliationScope,
  CoverageBoard,
  CoverageCommand,
  OwnAffiliationCommand,
  OwnCoverageCommand,
  OwnCoverageView,
  PlacementBoard,
  PlacementDraft,
  PlacementCommand,
  PlacementScope,
  PlacementScopes,
} from "@vektorprogrammet/domain/placements";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";
import { annotateAccessSpec, personNativeAccess } from "./access.js";
import { operationAnnotations, PersonSecurity } from "./common.js";
import {
  StrongETag,
  IdempotencyIfMatchHeaders,
  privateReadResponse,
  entityMutationResponse,
  endpointProblemResponses,
  problemUnion,
} from "./http-semantics.js";

export {
  AffiliationScope,
  CoverageCommand,
  OwnAffiliationCommand,
  OwnCoverageCommand,
  PlacementCommand,
  PlacementScope,
  PlacementScopes,
};

export const OwnAffiliationResource = Schema.Struct({
  ...Affiliation.fields,
  etag: StrongETag,
}).annotate({ identifier: "OwnAffiliationResource" });

export const PlacementBoardResource = Schema.Struct({
  ...PlacementBoard.fields,
  etag: StrongETag,
}).annotate({ identifier: "PlacementBoardResource" });

export const OwnCoverageResource = Schema.Struct({
  ...OwnCoverageView.fields,
  etag: StrongETag,
}).annotate({ identifier: "OwnCoverageResource" });

export const CoverageBoardResource = Schema.Struct({
  ...CoverageBoard.fields,
  etag: StrongETag,
}).annotate({ identifier: "CoverageBoardResource" });

/**
 * A draft is a read. `boardEtag` names the board version it was drafted from, for the
 * `If-Match` of the placement commands that apply it.
 */
export const PlacementDraftResource = Schema.Struct({
  ...PlacementDraft.fields,
  boardEtag: StrongETag,
}).annotate({ identifier: "PlacementDraftResource" });

export const PlacementProblem = problemUnion("PlacementProblem", [
  "request.malformed",
  "request.too-large",
  "precondition.invalid",
  "idempotency-key.invalid",
  "header.malformed",
  "validation.failed",
  "scope.invalid",
  "authority.denied",
  "resource.not-found",
  "affiliation.transition-invalid",
  "affiliation.inactive",
  "placement.overlap",
  "placement.inactive",
  "school-service.proposal-empty",
  "school-service.proposal-inactive",
  "school-service.exception-review-invalid",
  "commitment.target-invalid",
  "commitment.duplicate",
  "commitment.closed",
  "commitment.outcome-invalid",
  "commitment.interval-invalid",
  "absence.target-invalid",
  "absence.duplicate",
  "absence.closed",
  "coverage.owner-invalid",
  "coverage.coverer-ineligible",
  "coverage.coverer-unavailable",
  "coverage.not-recorded",

  "precondition.required",
  "precondition.failed",
  "idempotency.in-flight",
  "idempotency.digest-conflict",
  "idempotency.response-expired",
  "idempotency.unavailable",
  "transaction.conflict",
  "internal.error",
  "media-type.unsupported",
]);

const access = (capability: "placements.self" | "placements.manage", write = false) =>
  personNativeAccess({
    capability,
    canonicalScopeResolver: "placements.explicit-department",
    decisionTime: write ? "Transaction" : "SnapshotRead",
  });

export const ListPlacementScopesEndpoint = HttpApiEndpoint.get(
  "listScopes",
  "/api/placements/scopes",
  {
    success: privateReadResponse(PlacementScopes),
    error: endpointProblemResponses(PlacementProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((e) => annotateAccessSpec(e, access("placements.self")))
  .annotateMerge(
    operationAnnotations(
      "Select placement department and semester",
      "Public department labels and canonical semesters; private candidate names require coordinator authority.",
    ),
  );

export const ReadOwnAffiliationEndpoint = HttpApiEndpoint.get(
  "readOwnAffiliation",
  "/api/placements/affiliation",
  {
    query: AffiliationScope.fields,
    success: privateReadResponse(OwnAffiliationResource),
    error: endpointProblemResponses(PlacementProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((e) => annotateAccessSpec(e, access("placements.self")))
  .annotateMerge(
    operationAnnotations("Read own affiliation", "Authenticated Person only; no person selector."),
  );

export const CommandOwnAffiliationEndpoint = HttpApiEndpoint.post(
  "commandOwnAffiliation",
  "/api/placements/affiliation",
  {
    query: AffiliationScope.fields,
    headers: IdempotencyIfMatchHeaders,
    payload: OwnAffiliationCommand,
    success: entityMutationResponse(OwnAffiliationResource),
    error: endpointProblemResponses(PlacementProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((e) => annotateAccessSpec(e, access("placements.self", true)))
  .annotateMerge(
    operationAnnotations(
      "Request or withdraw own affiliation",
      "Self nomination gives scoped coordinators permission to discover this person.",
    ),
  );

export const ReadPlacementBoardEndpoint = HttpApiEndpoint.get("readBoard", "/api/placements", {
  query: PlacementScope.fields,
  success: privateReadResponse(PlacementBoardResource),
  error: endpointProblemResponses(PlacementProblem),
})
  .middleware(PersonSecurity)
  .pipe((e) => annotateAccessSpec(e, access("placements.manage")))
  .annotateMerge(
    operationAnnotations(
      "Read placement board",
      "Only holders of placement coordination in the department (a board leadership or a delegation) or global administrators.",
    ),
  );

export const CommandPlacementBoardEndpoint = HttpApiEndpoint.post(
  "commandBoard",
  "/api/placements",
  {
    query: PlacementScope.fields,
    headers: IdempotencyIfMatchHeaders,
    payload: PlacementCommand,
    success: entityMutationResponse(PlacementBoardResource),
    error: endpointProblemResponses(PlacementProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((e) => annotateAccessSpec(e, access("placements.manage", true)))
  .annotateMerge(
    operationAnnotations(
      "Manage placement and dated school service",
      "Commands keep demand, proposals, commitments, and placement changes inside one transaction.",
    ),
  );

export const ReadPlacementDraftEndpoint = HttpApiEndpoint.get(
  "readDraft",
  "/api/placements/draft",
  {
    query: PlacementScope.fields,
    success: privateReadResponse(PlacementDraftResource),
    error: endpointProblemResponses(PlacementProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((e) => annotateAccessSpec(e, access("placements.manage")))
  .annotateMerge(
    operationAnnotations(
      "Draft placements",
      "Drafts open school demand for unplaced active assistants from their weekday availability and teaching blocks. Nothing is stored; coordinators apply the draft with placement commands.",
    ),
  );

export const ReadOwnCoverageEndpoint = HttpApiEndpoint.get(
  "readOwnCoverage",
  "/api/placements/coverage/own",
  {
    query: PlacementScope.fields,
    success: privateReadResponse(OwnCoverageResource),
    error: endpointProblemResponses(PlacementProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((e) => annotateAccessSpec(e, access("placements.self")))
  .annotateMerge(
    operationAnnotations(
      "Read own coverage and scheduled service",
      "A person sees only commitments where they are scheduled or cover a recorded absence, and names of possible coverers only while they have an open absence.",
    ),
  );

export const CommandOwnCoverageEndpoint = HttpApiEndpoint.post(
  "commandOwnCoverage",
  "/api/placements/coverage/own",
  {
    query: PlacementScope.fields,
    headers: IdempotencyIfMatchHeaders,
    payload: OwnCoverageCommand,
    success: entityMutationResponse(OwnCoverageResource),
    error: endpointProblemResponses(PlacementProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((e) => annotateAccessSpec(e, access("placements.self", true)))
  .annotateMerge(
    operationAnnotations(
      "Report own absence or record who covers it",
      "The current person must own a scheduled assignment in an open commitment; coverage commands name only that person's own absence.",
    ),
  );

export const ReadCoverageBoardEndpoint = HttpApiEndpoint.get(
  "readCoverageBoard",
  "/api/placements/coverage",
  {
    query: PlacementScope.fields,
    success: privateReadResponse(CoverageBoardResource),
    error: endpointProblemResponses(PlacementProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((e) => annotateAccessSpec(e, access("placements.manage")))
  .annotateMerge(
    operationAnnotations(
      "Read coordinator coverage board",
      "Only a scoped coordinator can read absences, coverage records, possible coverers, per-absence closures, and commitment outcomes.",
    ),
  );

export const CommandCoverageBoardEndpoint = HttpApiEndpoint.post(
  "commandCoverageBoard",
  "/api/placements/coverage",
  {
    query: PlacementScope.fields,
    headers: IdempotencyIfMatchHeaders,
    payload: CoverageCommand,
    success: entityMutationResponse(CoverageBoardResource),
    error: endpointProblemResponses(PlacementProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((e) => annotateAccessSpec(e, access("placements.manage", true)))
  .annotateMerge(
    operationAnnotations(
      "Record coverage and decide dated service",
      "Commands check coordinator scope, record absences and coverage, and derive actual attendance for immutable outcome evidence inside one transaction.",
    ),
  );

export class PlacementsApi extends HttpApiGroup.make("placements")
  .add(ListPlacementScopesEndpoint)
  .add(ReadOwnAffiliationEndpoint)
  .add(CommandOwnAffiliationEndpoint)
  .add(ReadPlacementBoardEndpoint)
  .add(CommandPlacementBoardEndpoint)
  .add(ReadPlacementDraftEndpoint)
  .add(ReadOwnCoverageEndpoint)
  .add(CommandOwnCoverageEndpoint)
  .add(ReadCoverageBoardEndpoint)
  .add(CommandCoverageBoardEndpoint)
  .annotateMerge(
    OpenApi.annotations({
      title: "Volunteer placement",
      description:
        "Explicit affiliation, placement, confirmed roster, dated school commitment, absence, coverage records, and immutable outcomes.",
    }),
  ) {}
