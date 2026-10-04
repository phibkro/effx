/**
 * @title Using a custom annotation in source
 *
 * `@Annotate(name, ...args)` (decorator) and `.annotate(name, ...args)` (builder) are the one
 * generic way to attach a custom annotation. The runtime only records the call; the extension
 * that owns the name gives it meaning.
 */
import { Annotate, Command, Operation } from "@effx/runtime";
import { Effect } from "effect";
import { Payments, RefundInput, RefundRejected, RefundResult } from "./fixtures/billing.ts";

// Decorator form. The name must be a string literal and the arguments static literals: the
// compiler reads them from source and never runs this module. A name no registered extension
// owns is EFFX1101, so `Audit` only compiles once `auditExtension` is in `effx.config.ts`.
export class BillingOperations {
  @Command({ name: "Billing.Refund", input: RefundInput, success: RefundResult })
  @Annotate("Audit", { level: "sensitive" })
  static refund(input: typeof RefundInput.Type) {
    return Effect.gen(function* () {
      const payments = yield* Payments;

      return yield* payments.refund(input);
    });
  }
}

// Builder form: the same annotation, so the same kind of IR (spec 0015: for the same operation the
// extension node and its owner edge are identical in both forms; only the authored handler's symbol
// reference differs). It is a different operation here because one project cannot declare the same
// operation name twice (EFFX1001).
export const chargebackBuilder = Operation.command({
  name: "Billing.Chargeback",
  input: RefundInput,
  success: RefundResult,
})
  .annotate("Audit", { level: "sensitive" })
  .errors(RefundRejected)
  .handler((input: typeof RefundInput.Type) =>
    Effect.gen(function* () {
      const payments = yield* Payments;

      return yield* payments.refund(input);
    }),
  );
