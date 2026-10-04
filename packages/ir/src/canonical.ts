import { Crypto, Effect, Schema, flow } from "effect";
import { Hex } from "effect/encoding";
import { ApplicationIR } from "./ApplicationIR.ts";
import { canonicalJson } from "./jcs.ts";
import { ApplicationIRV1, migrate } from "./migrate.ts";
import { normalize } from "./normalize.ts";

export { canonicalJson } from "./jcs.ts";

/** Schema-derived JSON codec for the IR; the only place the wire shape is defined. */
export const JsonCodec = Schema.toCodecJson(ApplicationIR);

export const StringCodec = Schema.fromJsonString(JsonCodec);

/** `ApplicationIR.Type` is the Schema-derived JSON wire shape, so encoding is a pure identity projection. */
export const encode = (ir: ApplicationIR): Schema.Json => ir;

const InputJsonCodec = Schema.toCodecJson(Schema.Union([ApplicationIRV1, ApplicationIR]));

const InputStringCodec = Schema.fromJsonString(InputJsonCodec);

const decodeInput = Schema.decodeUnknownEffect(InputJsonCodec);

const decodeInputString = Schema.decodeUnknownEffect(InputStringCodec);

const validateV2 = Schema.decodeEffect(ApplicationIR);

/** Both persisted JSON versions decode to v2; malformed versions fail as Schema errors. */
export const decode = flow(decodeInput, Effect.map(migrate), Effect.flatMap(validateV2));

/** JSON text in either persisted version (any whitespace/key order). */
export const decodeString = flow(
  decodeInputString,
  Effect.map(migrate),
  Effect.flatMap(validateV2),
);

/** Canonical JSON text of the normalized IR. Idempotent: `canonical(decode(canonical(x))) == canonical(x)`. */
export const canonical = (ir: ApplicationIR): string => canonicalJson(encode(normalize(ir)));

const utf8 = new TextEncoder();

/** Lowercase hex sha-256 of the canonical UTF-8 bytes, via the platform `Crypto` service. */
export const semanticHash = Effect.fn("semanticHash")(function* (ir: ApplicationIR) {
  const crypto = yield* Crypto.Crypto;
  const digest = yield* crypto.digest("SHA-256", utf8.encode(canonical(ir)));

  return Hex.encode(digest);
});
