import { Context, Effect, Schema } from "effect";

const Mailbox = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));

const DeliveryId = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));

/** Immutable, provider-neutral request for one delivery attempt. */
export const MailDeliveryRequest = Schema.Struct({
  deliveryId: DeliveryId,
  sender: Mailbox,
  recipient: Mailbox,
  replyTo: Schema.optional(Mailbox),
  subject: Schema.String,
  text: Schema.String,
});

export type MailDeliveryRequest = typeof MailDeliveryRequest.Type;

export const MailDeliveryOutcome = Schema.Struct({
  providerReference: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
});

export type MailDeliveryOutcome = typeof MailDeliveryOutcome.Type;

export const MailDeliveryFailureKind = Schema.Literals([
  "permanent-rejection",
  "temporary-unavailability",
  "ambiguous-outcome",
]);

export type MailDeliveryFailureKind = typeof MailDeliveryFailureKind.Type;

export class MailDeliveryError extends Schema.TaggedError<MailDeliveryError>()(
  "MailDeliveryError",
  {
    kind: MailDeliveryFailureKind,
  },
) {}

export interface MailOperations {
  readonly deliver: (
    request: MailDeliveryRequest,
  ) => Effect.Effect<MailDeliveryOutcome, MailDeliveryError>;
}

/** Provider-neutral authority for delivering one complete mail message. */
export class Mail extends Context.Service<Mail, MailOperations>()(
  "@vektorprogrammet/domain/Mail",
) {}
