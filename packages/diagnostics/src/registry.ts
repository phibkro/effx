import { Effect, Option, Schema } from "effect";
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

const decodeEntries = Schema.decodeUnknownEffect(Schema.Array(DiagnosticEntry));

/**
 * Lazily decodes the supplied declaration array and rejects every collision,
 * including identical entries. Never pre-collapse declarations into a keyed map.
 * Success is Registry, expected failure RegistryError, requirements never.
 * Each execution creates a fresh transient snapshot; there are no resources,
 * background fibers, persistence or retries. Interruption stays interruption.
 */
export const composeRegistry = Effect.fnUntraced(function* (
  entries: readonly unknown[],
): Effect.fn.Return<Registry, RegistryError> {
  const decoded = yield* decodeEntries(entries).pipe(
    Effect.mapError(
      (error) => new RegistryError({ message: `Invalid diagnostic registry: ${error.message}` }),
    ),
  );

  const index = new Map<string, DiagnosticEntry>();

  for (const entry of decoded) {
    const previous = index.get(entry.code);

    if (previous !== undefined) {
      return yield* new RegistryError({
        message: `Duplicate diagnostic ${entry.code}: owners ${previous.owner} and ${entry.owner}`,
      });
    }

    index.set(entry.code, entry);
  }

  const sorted = decoded.toSorted((left, right) =>
    left.code < right.code ? -1 : left.code > right.code ? 1 : 0,
  );

  return {
    entries: sorted,
    get: (code) => Option.fromNullishOr(index.get(code)),
  };
});
