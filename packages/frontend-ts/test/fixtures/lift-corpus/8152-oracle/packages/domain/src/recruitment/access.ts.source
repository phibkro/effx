import { Data, Schema } from "effect";
import { PublicApplicationIdSchema } from "../application/schema.js";
import { DepartmentId, PersonId } from "../organization/schema.js";
import {
  RecruitmentInstantSchema,
  RecruitmentInterviewId,
  RecruitmentInvitationId,
  RecruitmentInvitationResponseStateSchema,
  RecruitmentInvitationResponseObservationSchema,
  type RecruitmentInvitationResponseMessage,
} from "./schema.js";

const Revision = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));

export const RecruitmentInvitationHttpSourceSchema = Schema.Struct({
  capabilitySha256: Schema.String,
  invitationId: RecruitmentInvitationId,
  interviewId: RecruitmentInterviewId,
  departmentId: DepartmentId,
  scheduleRevision: Revision,
  responseRevision: Revision,
  responseState: RecruitmentInvitationResponseStateSchema,
  supersededAt: Schema.NullOr(RecruitmentInstantSchema),
});

export type RecruitmentInvitationHttpSource = typeof RecruitmentInvitationHttpSourceSchema.Type;

export const RecruitmentInvitationHttpSnapshotSchema = Schema.Struct({
  source: RecruitmentInvitationHttpSourceSchema,
  observation: RecruitmentInvitationResponseObservationSchema,
});

export type RecruitmentInvitationHttpSnapshot = typeof RecruitmentInvitationHttpSnapshotSchema.Type;

export const RecruitmentApplicationHttpAccessSchema = Schema.Struct({
  applicationId: PublicApplicationIdSchema,
  departmentId: DepartmentId,
  interviewerEligible: Schema.Boolean,
});

export type RecruitmentApplicationHttpAccess = typeof RecruitmentApplicationHttpAccessSchema.Type;

export const RecruitmentAuthorityHttpSourceSchema = Schema.Struct({
  kind: Schema.Literals(["GlobalAdministrator", "Membership"]),
  identity: Schema.String,
  revisions: Schema.Array(Revision),
});

export type RecruitmentAuthorityHttpSource = typeof RecruitmentAuthorityHttpSourceSchema.Type;

export const RecruitmentInterviewHttpSourceSchema = Schema.Struct({
  interviewId: RecruitmentInterviewId,
  departmentId: DepartmentId,
  interviewerPersonId: PersonId,
  coInterviewerPersonId: Schema.NullOr(PersonId),
  interviewRevision: Revision,
  linkedApplicantPersonId: Schema.NullOr(PersonId),
  authority: Schema.Array(RecruitmentAuthorityHttpSourceSchema),
});

export type RecruitmentInterviewHttpSource = typeof RecruitmentInterviewHttpSourceSchema.Type;

export type RecruitmentInvitationTransition =
  | { readonly _tag: "Confirm" }
  | { readonly _tag: "Reject"; readonly message?: RecruitmentInvitationResponseMessage }
  | { readonly _tag: "RequestNewTime"; readonly message: RecruitmentInvitationResponseMessage };

export const RecruitmentInvitationTransition = Data.taggedEnum<RecruitmentInvitationTransition>();
