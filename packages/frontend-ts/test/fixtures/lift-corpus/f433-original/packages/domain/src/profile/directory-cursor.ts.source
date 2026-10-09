import { Result, Schema, Encoding, Effect } from "effect";
import { ProfileDecodeError } from "./errors.js";

const DIRECTORY_CURSOR_VERSION = "v1";

const DirectoryCursorTuple = Schema.fromJsonString(
  Schema.Tuple([
    Schema.Literal(DIRECTORY_CURSOR_VERSION),
    Schema.String,
    Schema.String,
    Schema.String,
  ]),
);

/** Encodes the last sort tuple as an opaque, strictly decodable cursor. */
export const encodeDirectoryCursor = (entry: {
  readonly lastName: string;
  readonly firstName: string;
  readonly personId: string;
}): string =>
  Encoding.encodeBase64(
    JSON.stringify([DIRECTORY_CURSOR_VERSION, entry.lastName, entry.firstName, entry.personId]),
  );

/** Decodes a directory cursor into the canonical keyset tuple. */
export const decodeDirectoryCursor = (
  cursor: string,
): Effect.Effect<{ lastName: string; firstName: string; personId: string }, ProfileDecodeError> =>
  Effect.gen(function* () {
    // Preserve the accepted padded, unpadded, and URL-safe encodings without Node Buffer.
    const payload = cursor
      .split("=", 1)[0]!
      .replace(/[^A-Za-z0-9+/_-]/gu, "")
      .replaceAll("-", "+")
      .replaceAll("_", "/");

    const complete = payload.length % 4 === 1 ? payload.slice(0, -1) : payload;

    const text = yield* Encoding.decodeBase64String(
      complete.padEnd(Math.ceil(complete.length / 4) * 4, "="),
    ).pipe(Result.match({ onSuccess: Effect.succeed, onFailure: Effect.fail }));

    const [, lastName, firstName, personId] =
      yield* Schema.decodeEffect(DirectoryCursorTuple)(text);

    return { lastName, firstName, personId };
  }).pipe(
    Effect.mapError(
      () => new ProfileDecodeError({ message: "malformed Profile directory cursor" }),
    ),
  );
