import { Array as Arr, Option, Order, Schema } from "effect";
import { Diagnostic } from "../Diagnostic.ts";
import { SourceRange, locationOf } from "./source.ts";

/*
 * Unsupported source retains every applicable cause (spec 0019 §0.6). Causes are ordered by source file,
 * source offset, then diagnostic code; the first is the primary diagnostic and the rest its related
 * diagnostics. Ordering uses the numeric offset, which `Location` (line/col) does not carry, so the range
 * travels with the cause until the final diagnostic is built.
 */

/** One applicable reason a declaration cannot be lifted: the registered diagnostic and where it applies. */
export const Cause = Schema.Struct({ at: SourceRange, diagnostic: Diagnostic });

export type Cause = typeof Cause.Type;

const byFile = Order.mapInput(Order.String, (cause: Cause) => cause.at.file);

const byStart = Order.mapInput(Order.Number, (cause: Cause) => cause.at.start.offset);

const byEnd = Order.mapInput(Order.Number, (cause: Cause) => cause.at.end.offset);

const byCode = Order.mapInput(Order.String, (cause: Cause) => cause.diagnostic.code);

const byMessage = Order.mapInput(Order.String, (cause: Cause) => cause.diagnostic.message);

/**
 * Total order over every identifying field: file, start offset, diagnostic code (the §0.6 key), then end
 * offset and message as tie-breaks, so any permutation of the same causes orders identically.
 */
export const causeOrder: Order.Order<Cause> = Order.combine(
  Order.combine(byFile, byStart),
  Order.combine(byCode, Order.combine(byEnd, byMessage)),
);

/** A cause becomes a diagnostic carrying the location of its range. */
const located = (cause: Cause): Diagnostic => ({
  ...cause.diagnostic,
  location: locationOf(cause.at),
});

/** An unsupported declaration: its identity, where it starts, and one primary diagnostic with all causes. */
export const UnsupportedSite = Schema.Struct({
  subject: Schema.String,
  range: SourceRange,
  primary: Diagnostic,
});

export type UnsupportedSite = typeof UnsupportedSite.Type;

/**
 * The unsupported site of `subject` built from all its causes, or none when there are no causes. Identical
 * causes (same range, code and message) collapse to one. The primary carries the remaining causes, in order,
 * as related diagnostics; the declaration is not part of any suggestion.
 */
export const unsupportedSite = (
  subject: string,
  range: SourceRange,
  causes: ReadonlyArray<Cause>,
): Option.Option<UnsupportedSite> =>
  Arr.matchLeft(
    Arr.dedupeAdjacentWith(
      causes.toSorted(causeOrder),
      (left, right) => causeOrder(left, right) === 0,
    ),
    {
      onEmpty: () => Option.none(),
      onNonEmpty: (first, rest) =>
        Option.some({
          subject,
          range,
          primary:
            rest.length === 0
              ? located(first)
              : { ...located(first), related: rest.map((cause) => located(cause)) },
        }),
    },
  );
