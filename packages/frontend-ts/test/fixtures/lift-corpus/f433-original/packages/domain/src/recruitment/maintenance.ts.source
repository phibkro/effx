import { Schema } from "effect";
import { DepartmentId, PersonId } from "../organization/schema.js";
import {
  InterviewSchema,
  InterviewSchemaId,
  RecruitmentInterviewId,
  RecruitmentInterviewQuestionSourceSchema,
  RecruitmentInterviewerOptionSchema,
  RecruitmentInstantSchema,
} from "./schema.js";

const CommandId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{22,128}$/u));

const Reason = Schema.String.check(
  Schema.makeFilter((value) => value.trim().length > 0),
  Schema.isMaxLength(2000),
);

const Revision = InterviewSchema.fields.revision;

const definition = {
  name: InterviewSchema.fields.name,
  active: Schema.Boolean,
  questions: RecruitmentInterviewQuestionSourceSchema,
};

const common = { commandId: CommandId, reason: Reason };

export const RecruitmentMaintenanceCommand = Schema.TaggedUnion({
  CreateQuestionnaire: { ...common, ...definition },
  ReviseQuestionnaire: {
    ...common,
    ...definition,
    interviewSchemaId: InterviewSchemaId,
    expectedRevision: Revision,
  },
  ChangeInterviewStaffing: {
    ...common,
    interviewId: RecruitmentInterviewId,
    expectedRevision: Revision,
    interviewerPersonId: PersonId,
    coInterviewerPersonId: Schema.NullOr(PersonId),
  },
});

export type RecruitmentMaintenanceCommand = typeof RecruitmentMaintenanceCommand.Type;

export const RecruitmentMaintenanceResult = Schema.TaggedUnion({
  QuestionnaireSaved: { interviewSchemaId: InterviewSchemaId, revision: Revision },
  InterviewStaffingChanged: { interviewId: RecruitmentInterviewId, revision: Revision },
});

export type RecruitmentMaintenanceResult = typeof RecruitmentMaintenanceResult.Type;

export const ManagedQuestionnaire = Schema.Struct({
  interviewSchemaId: InterviewSchemaId,
  ...definition,
  questionCount: InterviewSchema.fields.questionCount,
  revision: Revision,
  sourceState: Schema.Literals(["Available", "Unavailable"]),
});

export type ManagedQuestionnaire = typeof ManagedQuestionnaire.Type;

const history = {
  commandId: CommandId,
  actorPersonId: PersonId,
  reason: Reason,
  recordedAt: RecruitmentInstantSchema,
  revision: Revision,
};

export const QuestionnaireHistory = Schema.Struct({
  ...history,
  interviewSchemaId: InterviewSchemaId,
  before: Schema.NullOr(ManagedQuestionnaire),
  after: ManagedQuestionnaire,
});

export const QuestionnaireManagement = Schema.Struct({
  questionnaires: Schema.Array(ManagedQuestionnaire),
  history: Schema.Array(QuestionnaireHistory),
});

export type QuestionnaireManagement = typeof QuestionnaireManagement.Type;

export const InterviewStaffing = Schema.Struct({
  interviewId: RecruitmentInterviewId,
  departmentId: DepartmentId,
  applicantName: Schema.String,
  interviewerPersonId: PersonId,
  coInterviewerPersonId: Schema.NullOr(PersonId),
  revision: Revision,
  terminal: Schema.Boolean,
});

export type InterviewStaffing = typeof InterviewStaffing.Type;

export const InterviewStaffingHistory = Schema.Struct({
  ...history,
  interviewId: RecruitmentInterviewId,
  before: InterviewStaffing,
  after: InterviewStaffing,
});

export const InterviewStaffingManagement = Schema.Struct({
  interviews: Schema.Array(InterviewStaffing),
  candidates: Schema.Array(
    Schema.Struct({
      ...RecruitmentInterviewerOptionSchema.fields,
      departmentId: DepartmentId,
    }),
  ),
  history: Schema.Array(InterviewStaffingHistory),
});

export type InterviewStaffingManagement = typeof InterviewStaffingManagement.Type;

export class RecruitmentMaintenanceFailure extends Schema.TaggedError<RecruitmentMaintenanceFailure>()(
  "RecruitmentMaintenanceFailure",
  {
    code: Schema.Literals([
      "Denied",
      "NotFound",
      "Stale",
      "Conflict",
      "Invalid",
      "Ineligible",
      "Terminal",
      "EmptyActiveQuestionnaire",
    ]),
  },
) {}
