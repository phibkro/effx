import { Option, Record, Schema } from "effect";

/** Serializable severity; occurrence policy inputs belong to the factory params. */
export const Severity = Schema.Literals(["error", "warning", "info"]);

export type Severity = typeof Severity.Type;

/** Per-occurrence source position, deliberately absent from registry entries. */
export const Location = Schema.Struct({ file: Schema.String, line: Schema.Int, col: Schema.Int });

export type Location = typeof Location.Type;

const packageName = "(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*";

const codePattern = new RegExp(`^(?:EFFX[0-9]{4}|EFFX\\[${packageName}\\]/[0-9]{4})(?![\\s\\S])`);

/** Numeric distribution codes or canonical lowercase npm package-qualified codes. */
export const DiagnosticCode = Schema.String.check(
  Schema.isPattern(codePattern, { message: "Expected EFFX#### or EFFX[<package>]/####" }),
  Schema.makeFilter(
    (code: string) => {
      if (!code.startsWith("EFFX[")) return true;
      const name = code.slice(5, code.lastIndexOf("]"));
      const localName = name.slice(name.lastIndexOf("/") + 1);

      return name.length <= 214 && localName !== "node_modules" && localName !== "favicon.ico";
    },
    { message: "Expected a canonical npm package name" },
  ),
);

export type DiagnosticCode = typeof DiagnosticCode.Type;

/** Structural wire data; no runtime validation is performed by typed factories. */
export interface Diagnostic {
  readonly code: string;
  readonly severity: Severity;
  readonly message: string;
  readonly location?: Location;
  readonly related?: ReadonlyArray<Diagnostic>;
}

const NonBlank = Schema.String.check(
  Schema.isPattern(/\S/u, { message: "Expected nonempty text" }),
);

/** Fixed severity or a named policy with explicit, unique possible outcomes. */
export const SeverityPolicy = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("fixed") }),
  Schema.Struct({
    kind: Schema.Literal("named"),
    name: NonBlank,
    description: NonBlank,
    allowedSeverities: Schema.NonEmptyArray(Severity).check(Schema.isUnique()),
  }),
]);

export type SeverityPolicy = typeof SeverityPolicy.Type;

/** Examples are inert source text, not programs to execute during rendering. */
export const DiagnosticExample = Schema.Struct({
  before: NonBlank,
  after: NonBlank,
  explanation: NonBlank,
  language: Schema.optionalKey(NonBlank),
});

export type DiagnosticExample = typeof DiagnosticExample.Type;

const numericOwners = {
  "00": "frontend",
  "10": "kernel",
  "11": "annotation",
  "13": "annotation",
  "22": "contracts",
  "23": "contracts",
  "24": "http",
  "25": "access",
  "26": "foldkit",
  "27": "project",
  "28": "surface",
  "30": "lift",
  "31": "lift",
  "32": "lift",
  "34": "persistence",
  "41": "cedar",
};

const grandfatheredOwners = {
  EFFX2901: "example.deprecated",
  EFFX2902: "example.deprecated",
  EFFX9001: "ai-docs",
  EFFX9002: "ai-docs",
  EFFX9101: "ai-docs",
  EFFX9102: "ai-docs",
};

/** Public data schema. Decoding, ownership and collisions are checked at composition. */
export const DiagnosticEntry = Schema.Struct({
  code: DiagnosticCode,
  owner: NonBlank,
  title: NonBlank,
  severity: Severity,
  severityPolicy: SeverityPolicy,
  explanation: NonBlank,
  examples: Schema.NonEmptyArray(DiagnosticExample),
}).check(
  Schema.makeFilter((entry) =>
    entry.severityPolicy.kind === "fixed" ||
    entry.severityPolicy.allowedSeverities.includes(entry.severity)
      ? true
      : `Diagnostic ${entry.code} default severity ${entry.severity} is not an allowed policy outcome`,
  ),
  Schema.makeFilter((entry) => {
    const expected = entry.code.startsWith("EFFX[")
      ? entry.code.slice(5, entry.code.lastIndexOf("]"))
      : entry.code === "EFFX0010"
        ? "registry"
        : (Option.getOrUndefined(Record.get<string, string>(grandfatheredOwners, entry.code)) ??
          Option.getOrUndefined(Record.get<string, string>(numericOwners, entry.code.slice(4, 6))));

    return expected !== undefined && entry.owner === expected
      ? true
      : `Diagnostic ${entry.code} owner ${entry.owner} does not match reserved owner ${expected ?? "(unallocated distribution family)"}`;
  }),
);

export type DiagnosticEntry = typeof DiagnosticEntry.Type;
