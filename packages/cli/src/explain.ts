import { bundledDiagnosticEntries, CompilerFault, DiagnosticDefinitions } from "@effx/compiler";
import { DiagnosticCode, RegistryError, composeRegistry, renderEntry } from "@effx/diagnostics";
import { Effect, FileSystem, Option, Path, Predicate, Runtime, Schema } from "effect";
import { configuredExtensions, loadConfig } from "./commands.ts";
import { printErr, printOut } from "./output.ts";
import { formatDiagnostic } from "./report.ts";

/** A lookup/usage outcome already rendered at the CLI boundary, never a compiler diagnostic. */
export class ExplainFailed extends Schema.TaggedError<ExplainFailed>()("ExplainFailed", {
  exitCode: Schema.Literals([1, 2]),
}) {
  override readonly [Runtime.errorReported] = false;
  override get [Runtime.errorExitCode]() {
    return this.exitCode;
  }
}

export const explainUsage = Effect.fnUntraced(function* (message: string) {
  yield* printErr(`Usage: effx explain <code> [--config <path>]\n${message}`);

  return yield* new ExplainFailed({ exitCode: 2 });
});

const validCode = Schema.is(DiagnosticCode);

/** Explicit config evaluation only: no discovery, project resolution, frontend, or generated writes. */
const selectedRegistry = Effect.fnUntraced(function* (configPath?: string) {
  if (configPath === undefined) return yield* composeRegistry(bundledDiagnosticEntries);

  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const file = path.resolve(configPath);

  const exists = yield* fs
    .exists(file)
    .pipe(
      Effect.mapError(
        (cause) =>
          new CompilerFault({ stage: "collect", message: `${file}: ${cause.message}`, cause }),
      ),
    );

  if (!exists) {
    return yield* new RegistryError({ message: `${file}: config file does not exist` });
  }

  const config = yield* loadConfig(file).pipe(
    Effect.mapError((cause) =>
      cause._tag === "CompilerFault"
        ? cause
        : new CompilerFault({ stage: "collect", message: `${file}: ${cause.message}`, cause }),
    ),
  );

  const extensions = yield* configuredExtensions(file, config);
  const entries: Array<unknown> = [...bundledDiagnosticEntries];
  const ownerNames: Array<string> = [];

  for (const extension of extensions) {
    const declared: unknown = extension.diagnosticEntries;

    if (declared === undefined) continue;

    if (!Array.isArray(declared)) {
      return yield* new RegistryError({
        message: `${file}: extension ${extension.name}: diagnosticEntries must be an array`,
      });
    }

    for (const entry of declared) {
      if (
        Predicate.hasProperty(entry, "code") &&
        Predicate.isString(entry.code) &&
        validCode(entry.code) &&
        !entry.code.startsWith("EFFX[")
      ) {
        return yield* new RegistryError({
          message: `${file}: extension ${extension.name}: numeric diagnostic code ${entry.code} is reserved for the effx distribution`,
        });
      }
    }

    // Preserve duplicates for composition to reject, including repeated extension instances.
    if (declared.length > 0) ownerNames.push(extension.name);

    entries.push(...declared);
  }

  return yield* composeRegistry(entries).pipe(
    Effect.mapError(
      (error) =>
        new RegistryError({
          message: `${file}: extensions ${ownerNames.join(", ")}: ${error.message}`,
        }),
    ),
  );
});

export const explain = Effect.fn("explain")(function* (code: string, configPath?: string) {
  if (!validCode(code)) return yield* explainUsage(`Malformed diagnostic code: ${String(code)}`);

  const registry = yield* selectedRegistry(configPath).pipe(
    Effect.catchTags({
      RegistryError: (error) =>
        Effect.gen(function* () {
          yield* printErr(
            formatDiagnostic(
              DiagnosticDefinitions.EFFX0010.emit({
                _tag: "InvalidRegistry",
                owner: configPath ?? "bundled registry",
                registryIssue: error.message,
              }),
            ),
          );

          return yield* new ExplainFailed({ exitCode: 1 });
        }),
      CompilerFault: (error) =>
        Effect.gen(function* () {
          yield* printErr(error.message);

          return yield* new ExplainFailed({ exitCode: 1 });
        }),
    }),
  );

  const entry = registry.get(code);

  if (Option.isNone(entry)) {
    yield* printErr(
      `Unknown diagnostic code: ${code}${code.startsWith("EFFX[") ? "\nUse --config <path> to load the extension's diagnostic entries." : ""}`,
    );

    return yield* new ExplainFailed({ exitCode: 1 });
  }

  yield* printOut(renderEntry(entry.value).replace(/\n+$/, ""));
});
