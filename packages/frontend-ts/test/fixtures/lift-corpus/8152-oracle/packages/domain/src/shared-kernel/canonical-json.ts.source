/**
 * Canonical JSON and its SHA-256 digest, shared by every context.
 *
 * Use these wherever a value is hashed, compared, or kept as evidence: command receipts,
 * idempotency keys, lock keys, snapshot and source digests. The encoding sorts object keys and
 * writes non-finite numbers as `null`. It accepts plain data only, so encode a `DateTime`, a
 * `Date`, a class instance, or bytes through its owning schema first.
 */
import { Schema, flow, Match, Predicate } from "effect";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** A datum whose entries, at every depth, are its encoding. */
type PlainData =
  | null
  | string
  | boolean
  | number
  | ReadonlyArray<PlainData>
  | { readonly [key: string]: PlainData };

// Entries of a DateTime, Date, class instance, or byte array are not its encoded value.
const isPlainData = (input: unknown): input is PlainData => {
  if (Array.isArray(input)) return input.every(isPlainData);

  if (!Predicate.isObjectOrArray(input))
    return (
      Predicate.isNull(input) ||
      Predicate.isString(input) ||
      Predicate.isBoolean(input) ||
      Predicate.isNumber(input)
    );

  const prototype = Object.getPrototypeOf(input);

  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.values(input).every(isPlainData)
  );
};

const decodePlainData = Schema.decodeUnknownSync(
  Schema.declare(isPlainData, {
    message: "canonical JSON accepts plain data only; encode through the owning schema",
  }),
);

const canonicalPlainData: (value: PlainData) => Schema.Json = Match.type<PlainData>().pipe(
  Match.when(Predicate.isNull, () => null),
  Match.when(Predicate.isString, (value) => value),
  Match.when(Predicate.isBoolean, (value) => value),
  Match.when(Predicate.isNumber, (value) => (Number.isFinite(value) ? value : null)),
  Match.when(Array.isArray, (values): Schema.Json => values.map(canonicalPlainData)),
  Match.orElse((input): Schema.Json => {
    const output: Record<string, Schema.Json> = {};

    for (const [key, value] of Object.entries(input).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    ))
      output[key] = canonicalPlainData(value);

    return output;
  }),
);

/**
 * The plain JSON value of a datum, with sorted object keys and non-finite numbers as `null`.
 *
 * @remarks
 * It accepts plain data only, at every depth: `null`, strings, booleans, numbers, arrays, and
 * objects whose prototype is `Object.prototype` or `null`. Object keys are sorted by UTF-16 code
 * unit at every depth, and `NaN` and the infinities become `null`, as `JSON.stringify` writes
 * them. The value is what a SQL `json` parameter stores, so a JSON column keeps the canonical form.
 *
 * @throws An `Error` whose cause is the schema issue, when the datum holds anything but plain data
 * at any depth: `undefined`, a `DateTime`, a `Date`, a class instance, or bytes. Encode such a
 * value through its owning schema first.
 *
 * @sideEffects none
 *
 * @example
 * ```ts
 * sql.json(canonicalJsonValue(commandEnvelope));
 * ```
 *
 * @avoid `sql.json(canonicalJson(value))`: `sql.json` encodes its argument again, so the column
 * stores a JSON string, and `anti-slop/no-json-text-parameter` rejects it. Give a JSON parameter
 * `canonicalJsonValue(value)`.
 *
 * @construct digest
 */
export const canonicalJsonValue: <A>(datum: A) => Schema.Json = Match.type<unknown>().pipe(
  Match.orElse((datum): Schema.Json => canonicalPlainData(decodePlainData(datum))),
);

/**
 * The canonical JSON text of a datum, to hash or compare; a SQL `json` parameter takes
 * `canonicalJsonValue` instead.
 *
 * @remarks
 * `JSON.stringify` of `canonicalJsonValue`: sorted object keys at every depth, non-finite numbers
 * as `null`, and no whitespace, so equal data always gives equal text. Command digests, lock keys,
 * and evidence digests hash or embed this text.
 *
 * @throws An `Error` whose cause is the schema issue, when the datum is not plain data, as
 * `canonicalJsonValue` throws.
 *
 * @sideEffects none
 *
 * @example
 * ```ts
 * const commandJson = canonicalJson(payload);
 * ```
 *
 * @avoid Comparing or hashing `JSON.stringify(value)`: its key order follows insertion, so equal
 * data can give different text. Passing this text to `sql.json` stores a JSON string, which
 * `anti-slop/no-json-text-parameter` rejects; a JSON parameter takes `canonicalJsonValue`.
 *
 * @construct digest
 */
export const canonicalJson: <A>(datum: A) => string = flow(canonicalJsonValue, (value): string =>
  JSON.stringify(value),
);

/**
 * The UTF-8 bytes of the canonical JSON text of a datum.
 *
 * @remarks
 * `TextEncoder` output of `canonicalJson`: the input that `sha256Hex` digests for command
 * receipts, idempotency identities, snapshot digests, and evidence hashes.
 *
 * @throws An `Error` whose cause is the schema issue, when the datum is not plain data, as
 * `canonicalJsonValue` throws.
 *
 * @sideEffects none
 *
 * @example
 * ```ts
 * const digest = sha256Hex(canonicalJsonBytes({ actorPersonId, command }));
 * ```
 *
 * @avoid Digesting `new TextEncoder().encode(JSON.stringify(value))`: its key order follows
 * insertion, so equal data can digest differently. Digest `canonicalJsonBytes(value)`.
 *
 * @construct digest
 */
export const canonicalJsonBytes: <A>(datum: A) => Uint8Array<ArrayBuffer> = flow(
  canonicalJson,
  (json) => new TextEncoder().encode(json),
);

/**
 * The lowercase hexadecimal SHA-256 digest of bytes.
 *
 * @remarks
 * `@noble/hashes` computes the digest synchronously in plain JavaScript, so it needs no Web Crypto
 * or Node API and gives the same 64 characters wherever it runs.
 *
 * @sideEffects none
 *
 * @example
 * ```ts
 * const payloadDigest = sha256Hex(canonicalJsonBytes(command));
 * ```
 *
 * @avoid Hashing `JSON.stringify` text, or writing a digest in base64 or upper case: stored
 * digests compare as the lowercase hexadecimal digest of canonical JSON bytes, so any other form
 * never matches. Digest `canonicalJsonBytes(value)` with `sha256Hex`.
 *
 * @construct digest
 */
export const sha256Hex = (bytes: Uint8Array): string => bytesToHex(sha256(bytes));
