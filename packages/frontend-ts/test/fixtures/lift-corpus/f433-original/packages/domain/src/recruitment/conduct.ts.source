import { Predicate, Effect, Schema } from "effect";
import { isRfc3339Instant } from "../time.js";
import {
  RecruitmentConductValidationError,
  RecruitmentInterviewAlreadyCancelled,
  RecruitmentInterviewAlreadyFinalized,
  RecruitmentInterviewNotScheduled,
  RecruitmentInvitationNotAccepted,
  RecruitmentInterviewStaleRevision,
  RecruitmentInactiveActor,
  RecruitmentScopeDenied,
} from "./errors.js";
import {
  interviewRecommendations,
  CancelInterviewObservationSchema,
  FinalizeInterviewObservationSchema,
  RecruitmentInterviewAnswerSchema,
  RecruitmentInterviewConduct,
  RecruitmentInterviewCancellation,
  RecruitmentInterviewScoreSchema,
  CorrectInterviewAssessmentObservationSchema,
  RecruitmentInterviewCorrectionSchema,
  type CancelInterviewObservation,
  type CancelInterviewCommand,
  type FinalizeInterviewCommand,
  type FinalizeInterviewObservation,
  type CorrectInterviewAssessmentCommand,
  type CorrectInterviewAssessmentObservation,
  type RecruitmentConductActor,
  type RecruitmentConductState,
  type RecruitmentInterviewAnswer,
  type RecruitmentInterviewScore,
  type RecruitmentInterviewCorrection,
} from "./schema.js";

export interface FinalizeTransition {
  readonly observation: FinalizeInterviewObservation;
  readonly state: RecruitmentConductState;
}

export interface CancelTransition {
  readonly observation: CancelInterviewObservation;
  readonly state: RecruitmentConductState;
}

type ConductFailure =
  | RecruitmentConductValidationError
  | RecruitmentInterviewAlreadyCancelled
  | RecruitmentInterviewAlreadyFinalized
  | RecruitmentInterviewNotScheduled
  | RecruitmentInvitationNotAccepted
  | RecruitmentInterviewStaleRevision
  | RecruitmentInactiveActor
  | RecruitmentScopeDenied;

const invalid = (state: RecruitmentConductState, message: string) =>
  Effect.fail(
    new RecruitmentConductValidationError({
      interviewId: state.interview.interviewId,
      message,
    }),
  );

const checkActor = (
  state: RecruitmentConductState,
  actor: RecruitmentConductActor,
): Effect.Effect<void, ConductFailure> => {
  if (!actor.active || !actor.membershipActive || !actor.teamActive || !actor.departmentActive) {
    return Effect.fail(new RecruitmentInactiveActor({ personId: actor.personId }));
  }

  if (
    actor.personId !== state.interview.interviewerPersonId ||
    actor.departmentId !== state.interview.departmentId
  ) {
    return Effect.fail(
      new RecruitmentScopeDenied({
        personId: actor.personId,
        departmentId: state.interview.departmentId,
      }),
    );
  }

  return Effect.void;
};

const checkBase = (
  state: RecruitmentConductState,
  actor: RecruitmentConductActor,
  expectedRevision: number,
): Effect.Effect<void, ConductFailure> => {
  if (state.schedule === null) {
    return Effect.fail(
      new RecruitmentInterviewNotScheduled({ interviewId: state.interview.interviewId }),
    );
  }

  if (state.revision !== expectedRevision) {
    return Effect.fail(
      new RecruitmentInterviewStaleRevision({
        interviewId: state.interview.interviewId,
        expectedRevision,
        actualRevision: state.revision,
      }),
    );
  }

  return checkActor(state, actor);
};

const validateQuestions = (state: RecruitmentConductState): string | undefined => {
  const { questions } = state;

  if (questions.length === 0) return "question snapshot is absent";
  const ids = new Set<string>();
  const ordinals = new Set<number>();

  for (const question of questions) {
    if (
      question.interviewId !== state.interview.interviewId ||
      question.interviewId.length === 0 ||
      ids.has(question.questionId) ||
      ordinals.has(question.ordinal)
    ) {
      return "question snapshot contains duplicate or mismatched identities";
    }

    ids.add(question.questionId);
    ordinals.add(question.ordinal);

    if (question.ordinal !== questions.indexOf(question))
      return "question snapshot ordinals are not contiguous";

    if (question.kind === "text" && question.alternatives.length !== 0) {
      return "text questions cannot have alternatives";
    }

    if (question.kind !== "text" && question.alternatives.length === 0) {
      return "choice questions require alternatives";
    }

    if (new Set(question.alternatives).size !== question.alternatives.length) {
      return "question alternatives contain duplicates";
    }
  }

  return undefined;
};

const validateAnswers = (
  state: RecruitmentConductState,
  answers: ReadonlyArray<RecruitmentInterviewAnswer>,
): Effect.Effect<ReadonlyArray<RecruitmentInterviewAnswer>, ConductFailure> => {
  const questionError = validateQuestions(state);

  if (questionError !== undefined) return invalid(state, questionError);

  if (answers.length !== state.questions.length)
    return invalid(state, "answers must cover every question");
  const byId = new Map(state.questions.map((question) => [question.questionId, question]));
  const seen = new Set<string>();
  const canonical: RecruitmentInterviewAnswer[] = [];

  for (const answer of answers) {
    if (seen.has(answer.questionId)) return invalid(state, "duplicate answer question id");
    seen.add(answer.questionId);
    const question = byId.get(answer.questionId);

    if (question === undefined) return invalid(state, "answer references an unknown question");
    const alternatives = new Set(question.alternatives);

    if (question.kind === "text") {
      if (
        !Predicate.isString(answer.answer) ||
        answer.answer.length === 0 ||
        answer.answer.length > 5000
      ) {
        return invalid(state, "text answer must be non-empty and at most 5000 characters");
      }

      canonical.push({ questionId: answer.questionId, answer: answer.answer });
    } else if (question.kind === "check") {
      if (!Array.isArray(answer.answer) || new Set(answer.answer).size !== answer.answer.length) {
        return invalid(state, "check answer must be a unique array");
      }

      if (
        answer.answer.some(
          (value) => !alternatives.has(value) || value.length === 0 || value.length > 5000,
        )
      ) {
        return invalid(state, "check answer contains an invalid alternative");
      }

      canonical.push({ questionId: answer.questionId, answer: [...answer.answer] });
    } else {
      if (
        !Predicate.isString(answer.answer) ||
        answer.answer.length === 0 ||
        !alternatives.has(answer.answer)
      ) {
        return invalid(state, "choice answer must select one alternative");
      }

      canonical.push({ questionId: answer.questionId, answer: answer.answer });
    }
  }

  if (seen.size !== byId.size) return invalid(state, "answers must cover every question");
  canonical.sort((left, right) => {
    const leftQuestion = byId.get(left.questionId);
    const rightQuestion = byId.get(right.questionId);

    return (leftQuestion?.ordinal ?? 0) - (rightQuestion?.ordinal ?? 0);
  });

  return Effect.succeed(canonical);
};

const validateScore = (
  state: RecruitmentConductState,
  score: RecruitmentInterviewScore,
): Effect.Effect<void, ConductFailure> =>
  Schema.decodeEffect(RecruitmentInterviewScoreSchema)(score, {
    onExcessProperty: "error",
  }).pipe(
    Effect.asVoid,
    Effect.mapError(
      () =>
        new RecruitmentConductValidationError({
          interviewId: state.interview.interviewId,
          message: "score values must be integers from 0 to 10",
        }),
    ),
  );

export const finalizeInterview = (
  state: RecruitmentConductState,
  command: FinalizeInterviewCommand,
  actor: RecruitmentConductActor,
  now: string,
): Effect.Effect<FinalizeTransition, ConductFailure> =>
  Effect.gen(function* () {
    if (!isRfc3339Instant(now)) return yield* invalid(state, "invalid finalization instant");
    yield* checkBase(state, actor, command.expectedRevision);

    if (state.invitationResponse !== "Accepted") {
      return yield* new RecruitmentInvitationNotAccepted({
        interviewId: state.interview.interviewId,
        responseState: state.invitationResponse ?? "Absent",
      });
    }

    if (state.conduct !== null)
      return yield* new RecruitmentInterviewAlreadyFinalized({
        interviewId: state.interview.interviewId,
      });

    if (state.cancellation !== null)
      return yield* new RecruitmentInterviewAlreadyCancelled({
        interviewId: state.interview.interviewId,
      });
    const answers = yield* validateAnswers(state, command.answers);
    yield* validateScore(state, command.score);

    if (!interviewRecommendations.includes(command.recommendation))
      return yield* invalid(state, "an explicit interviewer recommendation is required");
    const revision = state.revision + 1;

    const conduct = new RecruitmentInterviewConduct({
      interviewId: state.interview.interviewId,
      answers,
      score: command.score,
      recommendation: command.recommendation,
      finalizedByPersonId: actor.personId,
      finalizedAt: now,
      interviewRevision: revision,
    });

    const observation = yield* Schema.decodeEffect(FinalizeInterviewObservationSchema)(
      FinalizeInterviewObservationSchema.make({
        commandId: command.commandId,
        interviewId: state.interview.interviewId,
        interviewRevision: revision,
        finalizedAt: now,
        completionState: "Completed",
        cancellationState: "NotCancelled",
        notificationState: "Pending",
      }),
      { onExcessProperty: "error" },
    ).pipe(
      Effect.mapError(
        (cause) =>
          new RecruitmentConductValidationError({
            interviewId: state.interview.interviewId,
            message: String(cause),
          }),
      ),
    );

    return { observation, state: { ...state, conduct, revision } };
  });

export const cancelInterview = (
  state: RecruitmentConductState,
  command: CancelInterviewCommand,
  actor: RecruitmentConductActor,
  now: string,
): Effect.Effect<CancelTransition, ConductFailure> =>
  Effect.gen(function* () {
    if (!isRfc3339Instant(now)) return yield* invalid(state, "invalid cancellation instant");
    yield* checkBase(state, actor, command.expectedRevision);

    if (state.conduct !== null)
      return yield* new RecruitmentInterviewAlreadyFinalized({
        interviewId: state.interview.interviewId,
      });

    if (state.cancellation !== null)
      return yield* new RecruitmentInterviewAlreadyCancelled({
        interviewId: state.interview.interviewId,
      });
    const revision = state.revision + 1;

    const cancellation = new RecruitmentInterviewCancellation({
      interviewId: state.interview.interviewId,
      cancelledByPersonId: actor.personId,
      cancelledAt: now,
      interviewRevision: revision,
    });

    const observation = yield* Schema.decodeEffect(CancelInterviewObservationSchema)(
      CancelInterviewObservationSchema.make({
        commandId: command.commandId,
        interviewId: state.interview.interviewId,
        interviewRevision: revision,
        cancelledAt: now,
        completionState: "NotCompleted",
        cancellationState: "Cancelled",
      }),
      { onExcessProperty: "error" },
    ).pipe(
      Effect.mapError(
        (cause) =>
          new RecruitmentConductValidationError({
            interviewId: state.interview.interviewId,
            message: String(cause),
          }),
      ),
    );

    return { observation, state: { ...state, cancellation, revision } };
  });

export interface CorrectionTransition {
  readonly observation: CorrectInterviewAssessmentObservation;
  readonly correction: RecruitmentInterviewCorrection;
  readonly state: RecruitmentConductState;
}

export const correctInterviewAssessment = (
  state: RecruitmentConductState,
  command: CorrectInterviewAssessmentCommand,
  actor: RecruitmentConductActor,
  now: string,
): Effect.Effect<CorrectionTransition, ConductFailure> =>
  Effect.gen(function* () {
    if (!isRfc3339Instant(now)) return yield* invalid(state, "invalid correction instant");
    yield* checkBase(state, actor, command.expectedRevision);

    if (state.cancellation !== null)
      return yield* new RecruitmentInterviewAlreadyCancelled({
        interviewId: state.interview.interviewId,
      });

    if (state.conduct === null)
      return yield* new RecruitmentConductValidationError({
        interviewId: state.interview.interviewId,
        message: "the interview is not completed",
      });
    const answers = yield* validateAnswers(state, command.answers);
    yield* validateScore(state, command.score);

    if (!interviewRecommendations.includes(command.recommendation))
      return yield* invalid(state, "an explicit interviewer recommendation is required");
    const resultingRevision = state.revision + 1;

    const correction = yield* Schema.decodeEffect(RecruitmentInterviewCorrectionSchema)(
      {
        interviewId: state.interview.interviewId,
        predecessorRevision: state.revision,
        resultingRevision,
        answers,
        score: command.score,
        recommendation: command.recommendation,
        correctedByPersonId: actor.personId,
        correctedAt: now,
        commandId: command.commandId,
      },
      { onExcessProperty: "error" },
    ).pipe(
      Effect.mapError(
        (cause) =>
          new RecruitmentConductValidationError({
            interviewId: state.interview.interviewId,
            message: String(cause),
          }),
      ),
    );

    const observation = yield* Schema.decodeEffect(CorrectInterviewAssessmentObservationSchema)(
      CorrectInterviewAssessmentObservationSchema.make({
        commandId: command.commandId,
        interviewId: state.interview.interviewId,
        predecessorRevision: state.revision,
        resultingRevision,
      }),
      { onExcessProperty: "error" },
    ).pipe(
      Effect.mapError(
        (cause) =>
          new RecruitmentConductValidationError({
            interviewId: state.interview.interviewId,
            message: String(cause),
          }),
      ),
    );

    return { observation, correction, state: { ...state, revision: resultingRevision } };
  });

export const recruitmentInterviewAnswerIsValid = (
  value: unknown,
): value is RecruitmentInterviewAnswer => Schema.is(RecruitmentInterviewAnswerSchema)(value);
