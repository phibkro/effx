// Shared domain code for the custom-extension examples. The compiler never executes this module.
import { Context, Effect, Schema } from "effect";

export const RefundInput = Schema.Struct({
  paymentId: Schema.String,
  amountCents: Schema.Int,
});

export const RefundResult = Schema.Struct({ refundId: Schema.String });

export class RefundRejected extends Schema.TaggedError<RefundRejected>()("RefundRejected", {
  reason: Schema.String,
}) {}

export class Payments extends Context.Service<
  Payments,
  {
    readonly refund: (
      input: typeof RefundInput.Type,
    ) => Effect.Effect<typeof RefundResult.Type, RefundRejected>;
  }
>()("docs/custom-extensions/Payments") {}
