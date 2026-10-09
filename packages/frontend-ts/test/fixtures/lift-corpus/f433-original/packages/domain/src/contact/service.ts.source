import { Predicate, Context, Data, Effect, Schema } from "effect";
import { Organization } from "../organization/service.js";
import { ContactEmail, type ContactMessage, type ContactVisitorIp } from "./schema.js";

export class ContactFailure extends Data.TaggedError("ContactFailure")<{
  readonly reason: "InvalidRecipient" | "RateLimited" | "Unavailable";
}> {}

export interface ContactEnvelope {
  readonly to: string;
  readonly replyTo: string;
  readonly name: string;
  readonly subject: string;
  readonly message: string;
}

export class ContactDelivery extends Context.Service<
  ContactDelivery,
  {
    readonly send: (envelope: ContactEnvelope) => Effect.Effect<void, ContactFailure>;
  }
>()("@vektorprogrammet/ContactDelivery") {}

export class ContactQuota extends Context.Service<
  ContactQuota,
  {
    readonly consume: (ip: ContactVisitorIp) => Effect.Effect<void, ContactFailure>;
  }
>()("@vektorprogrammet/ContactQuota") {}

/** Quota commits before recipient lookup or delivery, so neither failure refunds an attempt. */
export const submitContact = (message: ContactMessage, ip: ContactVisitorIp) =>
  Effect.gen(function* () {
    const quota = yield* ContactQuota;
    yield* quota.consume(ip);
    const organization = yield* Organization;

    const department = yield* organization.readDepartment(message.departmentId).pipe(
      Effect.mapError(
        (error) =>
          new ContactFailure({
            reason: Predicate.isTagged(error, "DepartmentNotFound")
              ? "InvalidRecipient"
              : "Unavailable",
          }),
      ),
    );

    if (!department.active || !Schema.is(ContactEmail)(department.email)) {
      return yield* new ContactFailure({ reason: "InvalidRecipient" });
    }

    const delivery = yield* ContactDelivery;
    yield* delivery.send({
      to: department.email,
      replyTo: message.email,
      name: message.name,
      subject: message.subject,
      message: message.message,
    });
  });
