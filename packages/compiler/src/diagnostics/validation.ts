import { Option, Result, Schema } from "effect";
import {
  composeRegistryResult,
  DiagnosticEntry,
  type EmitOptions,
  type Registry,
} from "@effx/diagnostics";
import { type Diagnostic, Location, Severity, StageResult } from "../Diagnostic.ts";
import type { Extension } from "../Extension.ts";
import { bundledDiagnosticEntries, CoreDiagnostics, HttpDiagnostics } from "./index.ts";

const decodeEntries = Schema.decodeUnknownResult(Schema.Array(DiagnosticEntry));

const numericCodes = new Set(bundledDiagnosticEntries.map((entry) => entry.code));

/** Pure boundary shared by synchronous stages and both compilation entry points. */
export const registryOf = (
  extensions: ReadonlyArray<Pick<Extension, "name" | "diagnosticEntries">>,
): StageResult<Registry> => {
  const entries: Array<DiagnosticEntry> = [...bundledDiagnosticEntries];

  for (const extension of extensions) {
    if (extension.diagnosticEntries === undefined) continue;

    const decoded = decodeEntries(extension.diagnosticEntries);

    if (Result.isFailure(decoded)) {
      return StageResult.skip([
        CoreDiagnostics["EFFX0010"].emit({
          _tag: "InvalidRegistry",
          owner: extension.name,
          registryIssue: decoded.failure.message,
        }),
      ]);
    }

    for (const entry of decoded.success) {
      if (!entry.code.startsWith("EFFX[") && !numericCodes.has(entry.code)) {
        return StageResult.skip([
          CoreDiagnostics["EFFX0010"].emit({
            _tag: "InvalidEntry",
            owner: extension.name,
            schemaIssue: `numeric code ${entry.code} is reserved for the effx distribution`,
          }),
        ]);
      }

      entries.push(entry);
    }
  }

  return Result.match(composeRegistryResult(entries), {
    onSuccess: (registry) => StageResult.succeed(registry),
    onFailure: (error) =>
      StageResult.skip([
        CoreDiagnostics["EFFX0010"].emit({
          _tag: "InvalidRegistry",
          owner: "selected extensions",
          registryIssue: error.message,
        }),
      ]),
  });
};

const decodeList = Schema.decodeUnknownResult(Schema.Array(Schema.Unknown));

// Decode one level at a time: forged cyclic related data must not recurse inside a codec.
const decodeOccurrence = Schema.decodeUnknownResult(
  Schema.Struct({
    code: Schema.String,
    severity: Severity,
    message: Schema.String,
    location: Schema.optionalKey(Location),
    related: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  }),
);

const decodeLocation = Schema.decodeUnknownOption(
  Schema.Struct({ location: Schema.optionalKey(Location) }),
);

export interface DiagnosticContext {
  readonly phase?: "collect" | "expand" | "interpret" | "analyze";
  readonly strictAccess?: boolean;
}

/**
 * Valid occurrences retain their order, fields and related tree. Each invalid occurrence
 * becomes registered EFFX0010 data at its original position; no callback data escapes unchecked.
 * No effects, resources, retries or runtime ownership are introduced by this boundary.
 */
export const validateDiagnostics = (
  input: ReadonlyArray<Diagnostic>,
  registry: Registry,
  owner: string,
  context: DiagnosticContext = {},
): ReadonlyArray<Diagnostic> => {
  const invalid = (schemaIssue: string, location?: Location): Diagnostic => {
    return CoreDiagnostics["EFFX0010"].emit(
      { _tag: "InvalidEntry", owner, schemaIssue },
      location === undefined ? undefined : { location },
    );
  };

  const list = decodeList(input);

  if (Result.isFailure(list)) return [invalid(list.failure.message)];

  const ancestors = new Set<unknown>();

  return list.success.map(function occurrence(value): Diagnostic {
    const location = Option.getOrUndefined(decodeLocation(value))?.location;

    if (ancestors.has(value)) return invalid("cyclic related diagnostic", location);

    const decoded = decodeOccurrence(value);

    if (Result.isFailure(decoded)) return invalid(decoded.failure.message, location);

    const diagnostic = decoded.success;

    ancestors.add(value);

    const related = diagnostic.related?.map(occurrence);

    ancestors.delete(value);

    const options: { -readonly [K in keyof EmitOptions]: EmitOptions[K] } = {};

    if (diagnostic.location !== undefined) options.location = diagnostic.location;

    if (related !== undefined) options.related = related;

    const entry = registry.get(diagnostic.code);

    if (Option.isNone(entry)) {
      return CoreDiagnostics["EFFX0010"].emit(
        { _tag: "UndeclaredCode", owner, code: diagnostic.code },
        options,
      );
    }

    const policy = entry.value.severityPolicy;

    let permitted =
      policy.kind === "fixed"
        ? diagnostic.severity === entry.value.severity
        : policy.allowedSeverities.some((severity) => severity === diagnostic.severity);

    let expectedPolicy: string =
      policy.kind === "fixed" ? "fixed " + entry.value.severity : policy.name;

    if (diagnostic.code === CoreDiagnostics["EFFX1106"].entry.code && context.phase !== undefined) {
      const expected = context.phase === "collect" ? "warning" : "error";

      permitted = permitted && diagnostic.severity === expected;

      expectedPolicy = `${expectedPolicy} (${context.phase}: ${expected})`;
    }

    if (
      diagnostic.code === HttpDiagnostics["EFFX2504"].entry.code &&
      context.strictAccess !== undefined
    ) {
      const expected = context.strictAccess ? "error" : "warning";

      permitted = permitted && diagnostic.severity === expected;

      expectedPolicy = `${expectedPolicy} (strictAccess=${context.strictAccess}: ${expected})`;
    }

    if (!permitted) {
      return CoreDiagnostics["EFFX0010"].emit(
        {
          _tag: "SeverityMismatch",
          owner,
          code: diagnostic.code,
          actualSeverity: diagnostic.severity,
          policy: expectedPolicy,
        },
        options,
      );
    }

    const checked: Diagnostic = {
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message,
      ...options,
    };

    return checked;
  });
};

/** A related contract error also blocks output even when its parent is informational. */
export const hasDiagnosticContractErrors = (diagnostics: ReadonlyArray<Diagnostic>): boolean =>
  diagnostics.some(
    (diagnostic) =>
      diagnostic.code === CoreDiagnostics["EFFX0010"].entry.code ||
      (diagnostic.related !== undefined && hasDiagnosticContractErrors(diagnostic.related)),
  );
