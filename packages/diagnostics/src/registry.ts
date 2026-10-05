import { Effect, Option, Result, Schema } from "effect";
import { DiagnosticEntry } from "./model.ts";

/** Expected invalid registry input, not a compiler IO/invariant fault. */
export class RegistryError extends Schema.TaggedError<RegistryError>()("RegistryError", {
  message: Schema.String,
}) {}

/** A validated, serializable data snapshot with an exact full-code lookup. */
export interface Registry {
  readonly entries: ReadonlyArray<DiagnosticEntry>;
  readonly get: (code: string) => Option.Option<DiagnosticEntry>;
}

const decodeEntries = Schema.decodeUnknownResult(Schema.Array(DiagnosticEntry));

/**
 * Synchronous data boundary shared by pure interpreters and the lazy Effect
 * adapter. Decodes every declaration before indexing and rejects every collision,
 * including identical entries. No IO, resources, retries or retained global state.
 */
export const composeRegistryResult = (
  entries: readonly unknown[],
): Result.Result<Registry, RegistryError> => {
  const decoded = decodeEntries(entries);

  if (Result.isFailure(decoded)) {
    return Result.fail(
      new RegistryError({ message: `Invalid diagnostic registry: ${decoded.failure.message}` }),
    );
  }

  const index = new Map<string, DiagnosticEntry>();

  for (const entry of decoded.success) {
    const previous = index.get(entry.code);

    if (previous !== undefined) {
      return Result.fail(
        new RegistryError({
          message: `Duplicate diagnostic ${entry.code}: owners ${previous.owner} and ${entry.owner}`,
        }),
      );
    }

    index.set(entry.code, entry);
  }

  const sorted = decoded.success.toSorted((left, right) =>
    left.code < right.code ? -1 : left.code > right.code ? 1 : 0,
  );

  return Result.succeed({
    entries: sorted,
    get: (code: string) => Option.fromNullishOr(index.get(code)),
  });
};

/**
 * Lazily decodes the supplied declaration array and rejects every collision.
 * Never pre-collapse declarations into a keyed map. Success is Registry,
 * expected failure RegistryError, requirements never. Each execution creates a
 * fresh transient snapshot; no resources, background fibers, persistence or
 * retries. Interruption stays interruption.
 */
export const composeRegistry = Effect.fnUntraced(function* (
  entries: readonly unknown[],
): Effect.fn.Return<Registry, RegistryError> {
  return yield* Effect.fromResult(composeRegistryResult(entries));
});
