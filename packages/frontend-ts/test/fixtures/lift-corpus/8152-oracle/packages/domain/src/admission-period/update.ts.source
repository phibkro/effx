import { Predicate, Effect, Struct } from "effect";
import type { DepartmentId } from "../organization/schema.js";
import { compareRfc3339Instants, normalizeRfc3339Instant } from "../time.js";
import {
  AdmissionPeriodAlreadyExists,
  AdmissionPeriodNotFound,
  AdmissionScopeDenied,
  AdmissionRoleDenied,
  AdmissionWindowOutsideSemester,
  DepartmentRequired,
  InactiveActor,
  InvalidAdmissionPeriodWindow,
  StaleAdmissionPeriodRevision,
  type AdmissionPeriodFailure,
} from "./errors.js";
import { admissionPeriodOutboxRequest } from "./effects.js";
import type { AdmissionPeriodOutboxRequest } from "./effects.js";
import { admissionPeriodCommandDigest } from "./digest.js";
import {
  AdmissionPeriodObservationSchema,
  AdmissionPeriodCommandId,
  AdmissionPeriodId,
  type AdmissionPeriod,
  type AdmissionPeriodActor,
  type AdmissionPeriodCommand,
  type AdmissionPeriodObservation,
  type AdmissionSemester,
} from "./schema.js";
import { isRfc3339Instant } from "./schema.js";
import type { AdmissionPeriodCommandContext } from "./context.js";

export interface AdmissionPeriodDecisionContext {
  readonly actor: AdmissionPeriodActor;
  readonly semester: AdmissionSemester;
  readonly now: string;
  readonly admissionPeriodId?: AdmissionPeriodId;
}

export interface AdmissionPeriodDecision {
  readonly period: AdmissionPeriod;
  readonly observation: AdmissionPeriodObservation;
  readonly outbox: ReadonlyArray<AdmissionPeriodOutboxRequest>;
  readonly auditAction: "AdmissionPeriodCreated" | "AdmissionPeriodRevised";
}

const activeActor = (actor: AdmissionPeriodActor): Effect.Effect<void, InactiveActor> =>
  actor.active ? Effect.void : Effect.fail(new InactiveActor({ personId: actor.personId }));

const managementActor = (
  actor: AdmissionPeriodActor,
): Effect.Effect<void, AdmissionRoleDenied | InactiveActor> =>
  Effect.gen(function* () {
    yield* activeActor(actor);

    if (
      !Predicate.isTagged(actor, "DepartmentAdministrator") &&
      !Predicate.isTagged(actor, "GlobalAdmin")
    ) {
      return yield* new AdmissionRoleDenied({ personId: actor.personId });
    }
  });

const departmentForCreate = (
  command: Extract<AdmissionPeriodCommand, { readonly _tag: "CreateAdmissionPeriod" }>,
  actor: AdmissionPeriodActor,
): Effect.Effect<DepartmentId, AdmissionPeriodFailure> => {
  if (Predicate.isTagged(actor, "DepartmentAdministrator")) {
    if (command.departmentId !== undefined && command.departmentId !== actor.departmentId) {
      return Effect.fail(
        new AdmissionScopeDenied({
          personId: actor.personId,
          departmentId: command.departmentId,
        }),
      );
    }

    return Effect.succeed(actor.departmentId);
  }

  if (command.departmentId === undefined) return Effect.fail(new DepartmentRequired());

  return Effect.succeed(command.departmentId);
};

const checkWindow = (
  startAt: string,
  endAt: string,
  semester: AdmissionSemester,
): Effect.Effect<void, InvalidAdmissionPeriodWindow | AdmissionWindowOutsideSemester> => {
  const ordering = compareRfc3339Instants(startAt, endAt);

  if (ordering === 0) {
    return Effect.fail(new InvalidAdmissionPeriodWindow({ startAt, endAt, reason: "EqualBounds" }));
  }

  if (ordering > 0) {
    return Effect.fail(
      new InvalidAdmissionPeriodWindow({ startAt, endAt, reason: "ReversedBounds" }),
    );
  }

  if (
    compareRfc3339Instants(startAt, semester.startAt) < 0 ||
    compareRfc3339Instants(endAt, semester.endAt) > 0
  ) {
    return Effect.fail(
      new AdmissionWindowOutsideSemester({
        semesterId: semester.semesterId,
        startAt,
        endAt,
        semesterStartAt: semester.startAt,
        semesterEndAt: semester.endAt,
      }),
    );
  }

  return Effect.void;
};

const normalizedInstant = normalizeRfc3339Instant;

const periodIdForCreate = (
  command: Extract<AdmissionPeriodCommand, { readonly _tag: "CreateAdmissionPeriod" }>,
  context: AdmissionPeriodDecisionContext,
): AdmissionPeriodId =>
  context.admissionPeriodId ??
  AdmissionPeriodId.make(`admission-period-${admissionPeriodCommandDigest(command).slice(0, 32)}`);

const createdObservation = (
  commandId: AdmissionPeriodCommandId,
  period: AdmissionPeriod,
): AdmissionPeriodObservation =>
  AdmissionPeriodObservationSchema.cases.Created.make({ commandId, period });

const revisedObservation = (
  commandId: AdmissionPeriodCommandId,
  period: AdmissionPeriod,
): AdmissionPeriodObservation =>
  AdmissionPeriodObservationSchema.cases.Revised.make({ commandId, period });

export const decideAdmissionPeriod = (
  existing: AdmissionPeriod | undefined,
  command: AdmissionPeriodCommand,
  context: AdmissionPeriodDecisionContext,
): Effect.Effect<AdmissionPeriodDecision, AdmissionPeriodFailure> =>
  Effect.gen(function* () {
    yield* managementActor(context.actor);

    if (!isRfc3339Instant(context.now)) {
      return yield* new InvalidAdmissionPeriodWindow({
        startAt: context.now,
        endAt: context.now,
        reason: "EqualBounds",
      });
    }

    if (Predicate.isTagged(command, "CreateAdmissionPeriod")) {
      const departmentId = yield* departmentForCreate(command, context.actor);
      yield* checkWindow(command.startAt, command.endAt, context.semester);

      if (existing !== undefined) {
        return yield* new AdmissionPeriodAlreadyExists({
          departmentId,
          semesterId: command.semesterId,
        });
      }

      const period: AdmissionPeriod = {
        id: periodIdForCreate(command, context),
        departmentId,
        semesterId: command.semesterId,
        startAt: normalizedInstant(command.startAt),
        endAt: normalizedInstant(command.endAt),
        revision: 0,
        lastCommandId: command.commandId,
      };

      return {
        period,
        observation: createdObservation(command.commandId, period),
        outbox: [admissionPeriodOutboxRequest(command.commandId, period)],
        auditAction: "AdmissionPeriodCreated" as const,
      };
    }

    const current = existing;

    if (current === undefined) {
      return yield* new AdmissionPeriodNotFound({ admissionPeriodId: command.admissionPeriodId });
    }

    const actorDepartment = Predicate.isTagged(context.actor, "DepartmentAdministrator")
      ? context.actor.departmentId
      : current.departmentId;

    if (actorDepartment !== current.departmentId) {
      return yield* new AdmissionScopeDenied({
        personId: context.actor.personId,
        departmentId: current.departmentId,
        admissionPeriodId: current.id,
      });
    }

    if (current.revision !== command.expectedRevision) {
      return yield* new StaleAdmissionPeriodRevision({
        admissionPeriodId: current.id,
        expected: command.expectedRevision,
        actual: current.revision,
      });
    }

    yield* checkWindow(command.startAt, command.endAt, context.semester);

    const period: AdmissionPeriod = Struct.assign(current, {
      startAt: normalizedInstant(command.startAt),
      endAt: normalizedInstant(command.endAt),
      revision: current.revision + 1,
      lastCommandId: command.commandId,
    });

    return {
      period,
      observation: revisedObservation(command.commandId, period),
      outbox: [admissionPeriodOutboxRequest(command.commandId, period)],
      auditAction: "AdmissionPeriodRevised" as const,
    };
  });

export const contextForActor = (
  context: AdmissionPeriodCommandContext,
  semester: AdmissionSemester,
): AdmissionPeriodDecisionContext => ({
  actor: context.actor,
  now: context.now,
  admissionPeriodId: context.admissionPeriodId,
  semester,
});
