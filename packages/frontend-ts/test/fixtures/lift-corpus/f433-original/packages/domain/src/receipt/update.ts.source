import { Data, Match, flow, Predicate, Effect, Schema, Struct } from "effect";
import { DepartmentId } from "../organization/schema.js";
import {
  InactiveActor,
  InvalidReceiptTransition,
  ReceiptAlreadyExists,
  ReceiptDecodeError,
  ReceiptNotFound,
  ReceiptOwnerDenied,
  ReceiptScopeDenied,
  StaleReceiptRevision,
  type ReceiptFailure,
} from "./errors.js";
import { receiptOutboxRequest, sameReceiptFile, type ReceiptOutboxRequest } from "./effects.js";
import {
  ReceiptActorSchema,
  ReceiptCommandRequestSchema,
  ReceiptDecisionContextSchema,
  ReceiptId,
  ReceiptVisualId,
  type Receipt,
  type ReceiptActor,
  type ReceiptFileSelection,
  type ReceiptObservation,
} from "./schema.js";

export const AuthorizedReceiptCommandSchema = Schema.TaggedUnion({
  SubmitReceipt: {
    ...ReceiptCommandRequestSchema.cases.SubmitReceipt.fields,
    actor: ReceiptActorSchema,
    departmentId: DepartmentId,
    paymentAccountCiphertext: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  },
  RevisePendingReceipt: {
    ...ReceiptCommandRequestSchema.cases.RevisePendingReceipt.fields,
    actor: ReceiptActorSchema,
  },
  WithdrawPendingReceipt: {
    ...ReceiptCommandRequestSchema.cases.WithdrawPendingReceipt.fields,
    actor: ReceiptActorSchema,
  },
  ApproveReceipt: {
    ...ReceiptCommandRequestSchema.cases.ApproveReceipt.fields,
    actor: ReceiptActorSchema,
  },
  RejectReceipt: {
    ...ReceiptCommandRequestSchema.cases.RejectReceipt.fields,
    actor: ReceiptActorSchema,
  },
  ReopenRejectedReceipt: {
    ...ReceiptCommandRequestSchema.cases.ReopenRejectedReceipt.fields,
    actor: ReceiptActorSchema,
  },
});

type AuthorizedReceiptCommand = typeof AuthorizedReceiptCommandSchema.Type;

export interface ReceiptDecisionContext {
  readonly receiptId: string;
  readonly visualId: string;
  readonly now: string;
}

export type { ReceiptOutboxRequest } from "./effects.js";

export interface ReceiptDecision {
  readonly receipt: Receipt;
  readonly observation: ReceiptObservation;
  readonly outbox: ReadonlyArray<ReceiptOutboxRequest>;
  readonly auditAction: string;
}

const activeActor = (actor: ReceiptActor): Effect.Effect<void, InactiveActor> =>
  actor.active ? Effect.void : Effect.fail(new InactiveActor({ personId: actor.personId }));

const requireReceipt = (
  receipt: Receipt | undefined,
  receiptId: string,
): Effect.Effect<Receipt, ReceiptNotFound> =>
  receipt === undefined ? Effect.fail(new ReceiptNotFound({ receiptId })) : Effect.succeed(receipt);

const currentRevision = (
  receipt: Receipt,
  expected: number,
): Effect.Effect<void, StaleReceiptRevision> =>
  receipt.revision === expected
    ? Effect.void
    : Effect.fail(
        new StaleReceiptRevision({
          receiptId: receipt.receiptId,
          expected,
          actual: receipt.revision,
        }),
      );

const pending = (
  receipt: Receipt,
  command: string,
): Effect.Effect<void, InvalidReceiptTransition> =>
  receipt.status === "Pending"
    ? Effect.void
    : Effect.fail(
        new InvalidReceiptTransition({
          receiptId: receipt.receiptId,
          status: receipt.status,
          command,
        }),
      );

const owner = (receipt: Receipt, actor: ReceiptActor): Effect.Effect<void, ReceiptOwnerDenied> =>
  receipt.ownerPersonId === actor.personId
    ? Effect.void
    : Effect.fail(
        new ReceiptOwnerDenied({
          receiptId: receipt.receiptId,
          personId: actor.personId,
        }),
      );

const approver = (
  receipt: Receipt,
  actor: ReceiptActor,
): Effect.Effect<void, ReceiptScopeDenied> => {
  const allowed =
    Predicate.isTagged(actor.approvalScope, "Global") ||
    (Predicate.isTagged(actor.approvalScope, "Department") &&
      actor.approvalScope.departmentId === receipt.departmentId);

  return allowed
    ? Effect.void
    : Effect.fail(
        new ReceiptScopeDenied({
          receiptId: receipt.receiptId,
          departmentId: receipt.departmentId,
        }),
      );
};

const observation = (commandId: string, receipt: Receipt): ReceiptObservation => ({
  commandId,
  receiptId: receipt.receiptId,
  visualId: receipt.visualId,
  status: receipt.status,
  revision: receipt.revision,
  replayed: false,
});

const effect = receiptOutboxRequest;

type KeepCurrentFileSelection = Extract<ReceiptFileSelection, { readonly _tag: "KeepCurrentFile" }>;

const isKeepCurrentFile = (file: ReceiptFileSelection): file is KeepCurrentFileSelection =>
  "_tag" in file && Predicate.isTagged(file, "KeepCurrentFile");

type ReceiptAccessAuthorization = Data.TaggedEnum<{
  SubmitReceipt: { readonly actor: ReceiptActor; readonly departmentId: DepartmentId };
  RevisePendingReceipt: { readonly actor: ReceiptActor; readonly current: Receipt };
  WithdrawPendingReceipt: { readonly actor: ReceiptActor; readonly current: Receipt };
  ApproveReceipt: { readonly actor: ReceiptActor; readonly current: Receipt };
  RejectReceipt: { readonly actor: ReceiptActor; readonly current: Receipt };
  ReopenRejectedReceipt: { readonly actor: ReceiptActor; readonly current: Receipt };
}>;

const ReceiptAccessAuthorization = Data.taggedEnum<ReceiptAccessAuthorization>();

export const authorizeReceiptMutationAccess = (
  authorization: ReceiptAccessAuthorization,
): Effect.Effect<void, ReceiptFailure> =>
  Effect.gen(function* () {
    yield* activeActor(authorization.actor);

    return yield* Match.value(authorization).pipe(
      Match.tag("SubmitReceipt", () => {
        return Effect.void;
      }),
      Match.tag("RevisePendingReceipt", "WithdrawPendingReceipt", (authorization) => {
        return owner(authorization.current, authorization.actor);
      }),
      Match.tag("ApproveReceipt", "RejectReceipt", "ReopenRejectedReceipt", (authorization) => {
        return approver(authorization.current, authorization.actor);
      }),
      Match.exhaustive,
    );
  });

const decideCommand = (
  existing: Receipt | undefined,
  command: AuthorizedReceiptCommand,
  context: ReceiptDecisionContext,
): Effect.Effect<ReceiptDecision, ReceiptFailure> =>
  Effect.gen(function* () {
    yield* authorizeReceiptMutationAccess(
      Predicate.isTagged(command, "SubmitReceipt")
        ? ReceiptAccessAuthorization.SubmitReceipt({
            actor: command.actor,
            departmentId: command.departmentId,
          })
        : ReceiptAccessAuthorization[command._tag]({
            actor: command.actor,
            current: yield* requireReceipt(existing, command.receiptId),
          }),
    );

    return yield* AuthorizedReceiptCommandSchema.match<
      Effect.Effect<ReceiptDecision, ReceiptFailure>
    >(command, {
      SubmitReceipt: (input) =>
        Effect.gen(function* () {
          if (existing !== undefined) {
            return yield* new ReceiptAlreadyExists({ receiptId: context.receiptId });
          }

          const receipt: Receipt = {
            receiptId: ReceiptId.make(context.receiptId),
            visualId: ReceiptVisualId.make(context.visualId),
            ownerPersonId: input.actor.personId,
            departmentId: input.departmentId,
            amountOre: input.amountOre,
            currency: "NOK",
            description: input.description,
            receiptDate: input.receiptDate,
            submittedAt: context.now,
            status: "Pending",
            approvedAt: null,
            paymentAccountCiphertext: input.paymentAccountCiphertext,
            file: input.file,
            revision: 0,
          };

          return {
            receipt,
            observation: observation(input.commandId, receipt),
            outbox: [
              effect(input.commandId, receipt.receiptId, "PromoteReceiptFile", receipt.file),
              effect(input.commandId, receipt.receiptId, "NotifyEconomyReceiptSubmitted"),
              effect(input.commandId, receipt.receiptId, "WriteReceiptAudit"),
            ],
            auditAction: "ReceiptSubmitted",
          };
        }),
      RevisePendingReceipt: (input) =>
        Effect.gen(function* () {
          const current = yield* requireReceipt(existing, input.receiptId);
          yield* currentRevision(current, input.expectedRevision);
          yield* pending(current, input._tag);
          const nextFile = isKeepCurrentFile(input.file) ? current.file : input.file;

          const receipt: Receipt = Struct.assign(current, {
            amountOre: input.amountOre,
            description: input.description,
            receiptDate: input.receiptDate,
            file: nextFile,
            revision: current.revision + 1,
          });

          const outbox: ReceiptOutboxRequest[] = [
            effect(input.commandId, receipt.receiptId, "WriteReceiptAudit"),
          ];

          if (!sameReceiptFile(current.file, nextFile)) {
            outbox.unshift(
              effect(input.commandId, receipt.receiptId, "PromoteReceiptFile", nextFile),
            );
            outbox.push(
              effect(input.commandId, receipt.receiptId, "DeleteReceiptFile", current.file),
            );
          }

          return {
            receipt,
            observation: observation(input.commandId, receipt),
            outbox,
            auditAction: "PendingReceiptRevised",
          };
        }),
      WithdrawPendingReceipt: (input) =>
        Effect.gen(function* () {
          const current = yield* requireReceipt(existing, input.receiptId);
          yield* currentRevision(current, input.expectedRevision);
          yield* pending(current, input._tag);

          const receipt: Receipt = Struct.assign(current, {
            status: "Withdrawn" as const,
            revision: current.revision + 1,
          });

          return {
            receipt,
            observation: observation(input.commandId, receipt),
            outbox: [
              effect(input.commandId, receipt.receiptId, "DeleteReceiptFile", receipt.file),
              effect(input.commandId, receipt.receiptId, "WriteReceiptAudit"),
            ],
            auditAction: "PendingReceiptWithdrawn",
          };
        }),
      ApproveReceipt: (input) =>
        Effect.gen(function* () {
          const current = yield* requireReceipt(existing, input.receiptId);
          yield* currentRevision(current, input.expectedRevision);
          yield* pending(current, input._tag);

          const receipt: Receipt = Struct.assign(current, {
            status: "Approved" as const,
            approvedAt: context.now,
            revision: current.revision + 1,
          });

          return {
            receipt,
            observation: observation(input.commandId, receipt),
            outbox: [
              effect(input.commandId, receipt.receiptId, "NotifyReceiptApproved"),
              effect(input.commandId, receipt.receiptId, "WriteReceiptAudit"),
            ],
            auditAction: "ReceiptApproved",
          };
        }),
      ReopenRejectedReceipt: (input) =>
        Effect.gen(function* () {
          const current = yield* requireReceipt(existing, input.receiptId);
          yield* currentRevision(current, input.expectedRevision);

          if (current.status !== "Rejected") {
            return yield* new InvalidReceiptTransition({
              receiptId: current.receiptId,
              status: current.status,
              command: input._tag,
            });
          }

          const receipt: Receipt = Struct.assign(current, {
            status: "Pending" as const,
            revision: current.revision + 1,
          });

          return {
            receipt,
            observation: observation(input.commandId, receipt),
            outbox: [],
            auditAction: "RejectedReceiptReopened",
          };
        }),
      RejectReceipt: (input) =>
        Effect.gen(function* () {
          const current = yield* requireReceipt(existing, input.receiptId);
          yield* currentRevision(current, input.expectedRevision);
          yield* pending(current, input._tag);

          const receipt: Receipt = Struct.assign(current, {
            status: "Rejected" as const,
            approvedAt: null,
            revision: current.revision + 1,
          });

          return {
            receipt,
            observation: observation(input.commandId, receipt),
            outbox: [
              effect(input.commandId, receipt.receiptId, "NotifyReceiptRejected"),
              effect(input.commandId, receipt.receiptId, "WriteReceiptAudit"),
            ],
            auditAction: "ReceiptRejected",
          };
        }),
    });
  });

const decodeReceiptCommand = flow(
  Schema.decodeUnknownEffect(AuthorizedReceiptCommandSchema, {
    onExcessProperty: "error",
  }),
  Effect.mapError((cause) => new ReceiptDecodeError({ message: String(cause) })),
);

const decodeReceiptDecisionContext = flow(
  Schema.decodeUnknownEffect(ReceiptDecisionContextSchema, {
    onExcessProperty: "error",
  }),
  Effect.mapError((cause) => new ReceiptDecodeError({ message: String(cause) })),
);

export const decideReceipt = (
  existing: Receipt | undefined,
  input: Schema.Json,
  context: ReceiptDecisionContext,
): Effect.Effect<ReceiptDecision, ReceiptFailure> =>
  decodeReceiptCommand(input).pipe(
    Effect.flatMap((command) =>
      decodeReceiptDecisionContext(context).pipe(
        Effect.flatMap((decodedContext) => decideCommand(existing, command, decodedContext)),
      ),
    ),
  );
