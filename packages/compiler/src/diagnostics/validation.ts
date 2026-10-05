import { Option, Result, Schema } from "effect";
import {
  composeRegistryResult,
  DiagnosticEntry,
  type EmitOptions,
  type Registry,
} from "@effx/diagnostics";
import { type Diagnostic, Location, Severity, StageResult } from "../Diagnostic.ts";
import type { Extension } from "../Extension.ts";
import { bindingSeverity } from "./core.ts";
import { missingAccessSeverity } from "./http.ts";
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

const decodeRelated = Schema.decodeUnknownOption(
  Schema.Struct({ related: Schema.optionalKey(Schema.Array(Schema.Unknown)) }),
);

const occurrenceOptions = (
  location?: Location,
  related?: ReadonlyArray<Diagnostic>,
): EmitOptions | undefined => {
  if (location === undefined && related === undefined) return undefined;

  const options: { -readonly [K in keyof EmitOptions]: EmitOptions[K] } = {};

  if (location !== undefined) options.location = location;

  if (related !== undefined) options.related = related;

  return options;
};

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
  const invalid = (schemaIssue: string, options?: EmitOptions): Diagnostic =>
    CoreDiagnostics["EFFX0010"].emit({ _tag: "InvalidEntry", owner, schemaIssue }, options);

  const list = decodeList(input);

  if (Result.isFailure(list)) return [invalid(list.failure.message)];

  let ancestors: Set<Diagnostic> | undefined;

  const occurrences = (values: ReadonlyArray<Diagnostic>): ReadonlyArray<Diagnostic> => {
    let changed: Array<Diagnostic> | undefined;

    for (let index = 0; index < values.length; index++) {
      const original = values[index]!;
      const checked = occurrence(original);

      if (changed !== undefined) changed.push(checked);
      else if (checked !== original) {
        changed = values.slice(0, index);
        changed.push(checked);
      }
    }

    return changed ?? values;
  };

  const occurrence = (value: Diagnostic): Diagnostic => {
    if (ancestors?.has(value)) {
      const location = Option.getOrUndefined(decodeLocation(value))?.location;

      return invalid("cyclic related diagnostic", occurrenceOptions(location));
    }

    const decoded = decodeOccurrence(value);
    let sourceRelated: ReadonlyArray<Diagnostic> | undefined;

    // The native decoder establishes the container shape. Walk the declared input itself,
    // not the decoder's copy, so an unchanged related tree keeps its original identities.
    if (Result.isSuccess(decoded) || Option.isSome(decodeRelated(value)))
      sourceRelated = value.related;

    let related = sourceRelated;

    if (sourceRelated !== undefined && sourceRelated.length > 0) {
      ancestors ??= new Set<Diagnostic>();
      ancestors.add(value);
      related = occurrences(sourceRelated);
      ancestors.delete(value);
    }

    if (Result.isFailure(decoded)) {
      const location = Option.getOrUndefined(decodeLocation(value))?.location;

      return invalid(decoded.failure.message, occurrenceOptions(location, related));
    }

    const diagnostic = decoded.success;
    const entry = registry.get(diagnostic.code);

    if (Option.isNone(entry)) {
      return CoreDiagnostics["EFFX0010"].emit(
        { _tag: "UndeclaredCode", owner, code: diagnostic.code },
        occurrenceOptions(diagnostic.location, related),
      );
    }

    const policy = entry.value.severityPolicy;

    let permitted =
      policy.kind === "fixed"
        ? diagnostic.severity === entry.value.severity
        : policy.allowedSeverities.some((severity) => severity === diagnostic.severity);

    const bindingPhase =
      diagnostic.code === CoreDiagnostics["EFFX1106"].entry.code && context.phase !== undefined;

    const expectedBindingSeverity = bindingPhase
      ? bindingSeverity(context.phase === "collect")
      : undefined;

    if (expectedBindingSeverity !== undefined)
      permitted = permitted && diagnostic.severity === expectedBindingSeverity;

    const accessMode =
      diagnostic.code === HttpDiagnostics["EFFX2504"].entry.code &&
      context.strictAccess !== undefined;

    const expectedAccessSeverity = accessMode
      ? missingAccessSeverity(context.strictAccess)
      : undefined;

    if (expectedAccessSeverity !== undefined)
      permitted = permitted && diagnostic.severity === expectedAccessSeverity;

    if (!permitted) {
      let expectedPolicy = policy.kind === "fixed" ? "fixed " + entry.value.severity : policy.name;

      if (expectedBindingSeverity !== undefined)
        expectedPolicy += " (" + context.phase + ": " + expectedBindingSeverity + ")";

      if (expectedAccessSeverity !== undefined)
        expectedPolicy +=
          " (strictAccess=" + context.strictAccess + ": " + expectedAccessSeverity + ")";

      return CoreDiagnostics["EFFX0010"].emit(
        {
          _tag: "SeverityMismatch",
          owner,
          code: diagnostic.code,
          actualSeverity: diagnostic.severity,
          policy: expectedPolicy,
        },
        occurrenceOptions(diagnostic.location, related),
      );
    }

    return related === undefined || related === value.related ? value : { ...value, related };
  };

  return occurrences(input);
};

/** A related contract error also blocks output even when its parent is informational. */
export const hasDiagnosticContractErrors = (diagnostics: ReadonlyArray<Diagnostic>): boolean =>
  diagnostics.some(
    (diagnostic) =>
      diagnostic.code === CoreDiagnostics["EFFX0010"].entry.code ||
      (diagnostic.related !== undefined && hasDiagnosticContractErrors(diagnostic.related)),
  );
