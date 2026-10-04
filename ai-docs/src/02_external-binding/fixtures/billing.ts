/** @effect-diagnostics unstableApiUsage:off -- the root is a native Effect HttpApi value. */
import { Schema } from "effect";
import { HttpApi } from "effect/http-api";

// The group's `root` must be an exported, concrete `HttpApi` value with a
// literal identifier. The compiler reads its identifier and symbol, nothing else.
// In a real project this root also `.add(...)`s the group contract that effx
// generates with `--emit=contract`.
export const BillingApi = HttpApi.make("billing");

export const InvoiceId = Schema.String.pipe(Schema.brand("InvoiceId"));

export const GetInvoiceInput = Schema.Struct({ id: InvoiceId });

export const InvoiceResponse = Schema.Struct({
  id: InvoiceId,
  amountCents: Schema.Int,
  status: Schema.Literals(["open", "paid", "void"]),
});

// A command whose path carries the id and whose body carries the rest.
export const VoidInvoiceParams = Schema.Struct({ id: InvoiceId });

export const VoidInvoiceInput = Schema.Struct({ reason: Schema.String });

export class InvoiceNotFound extends Schema.TaggedError<InvoiceNotFound>()("InvoiceNotFound", {
  id: InvoiceId,
}) {}
