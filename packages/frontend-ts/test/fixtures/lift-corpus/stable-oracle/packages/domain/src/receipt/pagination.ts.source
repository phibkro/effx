import { Effect, Result, Schema } from "effect";
import { Base64 } from "effect/encoding";
import { ReceiptDecodeError } from "./errors.js";
import { ReceiptId } from "./schema.js";
import { isRfc3339Instant } from "../time.js";

export const RECEIPT_PAGE_SIZE = 50;

const ReceiptCursorPosition = Schema.Struct({
  timestamp: Schema.String.pipe(
    Schema.check(
      Schema.makeFilter(
        (value) =>
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(value) &&
          isRfc3339Instant(`${value.slice(0, 23)}Z`),
      ),
    ),
  ),
  receiptId: ReceiptId,
});

export type ReceiptCursorPosition = typeof ReceiptCursorPosition.Type;

const CursorTuple = Schema.fromJsonString(
  Schema.Tuple([
    Schema.Literal("receipt-v1"),
    ReceiptCursorPosition.fields.timestamp,
    ReceiptCursorPosition.fields.receiptId,
  ]),
);

export const ReceiptCursor = Schema.String.pipe(
  Schema.check(
    Schema.isMinLength(1),
    Schema.makeFilter((value) => /^[A-Za-z0-9+/]+={0,2}$/u.test(value)),
  ),
);

export type ReceiptPage<A> = {
  readonly items: ReadonlyArray<A>;
  readonly nextCursor?: string;
};

export const encodeReceiptCursor = (position: ReceiptCursorPosition): string =>
  Base64.encode(JSON.stringify(["receipt-v1", position.timestamp, position.receiptId]));

export const decodeReceiptCursor = (
  cursor: string,
): Effect.Effect<ReceiptCursorPosition, ReceiptDecodeError> =>
  Effect.gen(function* () {
    yield* Schema.decodeEffect(ReceiptCursor)(cursor);

    const text = yield* Base64.decodeString(cursor).pipe(
      Result.match({ onSuccess: Effect.succeed, onFailure: Effect.fail }),
    );

    const [, timestamp, receiptId] = yield* Schema.decodeEffect(CursorTuple)(text);

    return { timestamp, receiptId };
  }).pipe(Effect.mapError(() => new ReceiptDecodeError({ message: "invalid receipt cursor" })));

export const receiptPage = <A>(
  rows: ReadonlyArray<A>,
  position: (row: A) => ReceiptCursorPosition,
): ReceiptPage<A> =>
  rows.length <= RECEIPT_PAGE_SIZE
    ? { items: rows }
    : {
        items: rows.slice(0, RECEIPT_PAGE_SIZE),
        nextCursor: encodeReceiptCursor(position(rows[RECEIPT_PAGE_SIZE - 1]!)),
      };
